import { NextRequest, after } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { isMaterialLowStock } from '@/lib/stock-helpers';
import { revalidateStorefront } from '@/lib/revalidate';
import { writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { rowToBatch, mergeMaterialsUsed, mergeOutputs, type ProductionBatchRow } from '@/lib/materials-pg';

interface MaterialUsedInput { materialId: string; materialName: string; unit: string; qty: number }
interface OutputInput { productId: string; productName: string; yieldQty: number }

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'production', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const sql = getSql();
  const rows = await sql<ProductionBatchRow[]>`select * from production_batches order by created_at desc limit ${limit}`;
  const batches = rows.map(rowToBatch);

  // "Closed" = stok hasil produksi batch ini di gudang tujuannya dianggap sudah habis. Tidak ada lot
  // tracking per-batch di penulisan stok, jadi dihitung ulang di sini dengan asumsi FIFO: stok yang
  // TERSISA saat ini dianggap berasal dari batch yang PALING BARU dulu (barang lama terjual duluan) —
  // alokasikan stok gudang saat ini ke batch dari yang terbaru ke yang terlama sampai habis; batch yang
  // tidak lagi kebagian jatah dianggap closed. Ini best-effort (asumsi FIFO), bukan pencatatan per-lot
  // yang sesungguhnya, tapi cukup akurat untuk kebutuhan tampilan status di riwayat produksi.
  const wsKeys = new Set<string>();
  batches.forEach(b => {
    if (!b.warehouseId) return;
    b.outputs.forEach(o => wsKeys.add(`${b.warehouseId}_${o.productId}`));
  });
  const wsKeyList = [...wsKeys];
  const wsRows = wsKeyList.length > 0
    ? await sql<{ id: string; stock_qty: string }[]>`select id, stock_qty from warehouse_stock where id in ${sql(wsKeyList)}`
    : [];
  const wsById = new Map(wsRows.map(r => [r.id, Number(r.stock_qty) || 0]));
  const wsStock = new Map<string, number>();
  wsKeyList.forEach(k => wsStock.set(k, wsById.get(k) ?? 0));

  // Kelompokkan tiap output (per productId+warehouseId) jadi "lot", urut dari yang terbaru, lalu
  // alokasikan stok yang tersisa ke lot-lot itu mulai dari yang terbaru sampai stoknya habis dibagi.
  const lotsByKey = new Map<string, { batchId: string; yieldQty: number; createdAt: number }[]>();
  batches.forEach(b => {
    if (!b.warehouseId) return;
    b.outputs.forEach(o => {
      const key = `${b.warehouseId}_${o.productId}`;
      const list = lotsByKey.get(key) ?? [];
      list.push({ batchId: b.id, yieldQty: o.yieldQty, createdAt: b.createdAt?.seconds ?? 0 });
      lotsByKey.set(key, list);
    });
  });
  const remainingByLot = new Map<string, number>(); // key: `${batchId}|${warehouseId}_${productId}`
  lotsByKey.forEach((lots, key) => {
    let pool = wsStock.get(key) ?? 0;
    [...lots].sort((a, b) => b.createdAt - a.createdAt).forEach(lot => {
      const take = Math.min(lot.yieldQty, pool);
      pool -= take;
      remainingByLot.set(`${lot.batchId}|${key}`, take);
    });
  });

  // Per output: "closed" (remaining 0 — habis), "mixed" (0 < remaining < yieldQty — sudah terjual
  // sebagian tapi belum habis, jadi tercampur/tidak murni lagi dari batch ini saja), atau "open"
  // (remaining == yieldQty — belum tersentuh sama sekali). Level batch: ada satu output "mixed" saja
  // sudah cukup bikin status batch jadi "mixed"; baru dianggap "closed" kalau SEMUA output closed.
  const batchesWithStatus = batches.map(b => {
    const outputs = b.outputs;
    if (!b.warehouseId || outputs.length === 0) return { ...b, closed: false, mixed: false };

    const outputStates = outputs.map(o => {
      const remaining = remainingByLot.get(`${b.id}|${b.warehouseId}_${o.productId}`) ?? 0;
      if (remaining <= 0) return 'closed';
      if (remaining < o.yieldQty) return 'mixed';
      return 'open';
    });
    const mixed  = outputStates.includes('mixed');
    const closed = !mixed && outputStates.every(s => s === 'closed');
    return { ...b, closed, mixed };
  });

  return Response.json({ batches: batchesWithStatus });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'production', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    date?: string; note?: string; warehouseId?: string; warehouseName?: string;
    outputs: OutputInput[]; materialsUsed: MaterialUsedInput[]; otherCost?: number;
  };
  const materialsUsed = mergeMaterialsUsed(data.materialsUsed ?? []);
  const outputs = mergeOutputs(data.outputs ?? []).filter(o => o.yieldQty > 0);
  const otherCost = Number(data.otherCost) || 0;
  const date = data.date || new Date().toISOString().slice(0, 10);
  const warehouseId   = data.warehouseId ?? '';
  const warehouseName = data.warehouseName ?? '';
  if (materialsUsed.length === 0) return Response.json({ error: 'Minimal 1 bahan baku dipakai.' }, { status: 400 });
  if (outputs.length === 0) return Response.json({ error: 'Minimal 1 produk hasil dengan jumlah lebih dari 0.' }, { status: 400 });
  if (!warehouseId) return Response.json({ error: 'Pilih gudang tujuan.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const batchId = randomUUID();
  const expenseId = randomUUID();

  // `products`/`warehouse_stock`/`stock_ledger` (Tahap 8-10) DAN `rawMaterials`/`productionBatches`/
  // `expenses` (Tahap 18b) sekarang sama-sama di Postgres, jadi digabung jadi SATU transaksi atomic —
  // tidak ada lagi kompensasi cross-database seperti versi Firestore sebelumnya (lihat pola yang sama
  // di orders/route.ts Tahap 12 & consignment/send/route.ts Tahap 18a).
  const lowStockCrossings: { materialName: string; materialId: string; newQty: number; unit: string; minStock: number }[] = [];
  let batchData: Record<string, unknown> = {};

  try {
    await sql.begin(async pgTx => {
      const materialIds = materialsUsed.map(m => m.materialId);
      const materialRows = await pgTx<{ id: string; stock_qty: string; avg_cost: string; min_stock: string }[]>`
        select id, stock_qty, avg_cost, min_stock from raw_materials where id in ${pgTx(materialIds)} order by id for update
      `;
      const materialById = new Map(materialRows.map(r => [r.id, r]));

      const shortages: string[] = [];
      materialsUsed.forEach(m => {
        const row = materialById.get(m.materialId);
        if (!row) { shortages.push(`${m.materialName} (bahan baku tidak ditemukan)`); return; }
        const stockQty = Number(row.stock_qty) || 0;
        if (stockQty < m.qty) shortages.push(`${m.materialName} (stok ${Math.round(stockQty * 100) / 100} ${m.unit}, butuh ${m.qty} ${m.unit})`);
      });
      if (shortages.length > 0) throw new Error(`Stok bahan baku tidak cukup: ${shortages.join(', ')}`);

      const materialsWithCost = materialsUsed.map(m => {
        const costPerUnit = Number(materialById.get(m.materialId)!.avg_cost) || 0;
        return { ...m, costPerUnit, cost: costPerUnit * m.qty };
      });
      const materialCost  = materialsWithCost.reduce((s, m) => s + m.cost, 0);
      const totalCost     = materialCost + otherCost;
      const totalYieldQty = outputs.reduce((s, o) => s + o.yieldQty, 0);
      // Biaya dari satu batch bahan baku dibagi rata per pcs ke semua produk hasil
      // (mis. Ori & Pedas dari adonan yang sama) — HPP/pcs dianggap seragam antar varian.
      const costPerPcs = totalCost / totalYieldQty;
      const outputsWithCost = outputs.map(o => ({ ...o, costPerPcs }));

      const productRows = await pgTx<{ id: string; stock_qty: string; cost_price: string | null; open_po: boolean }[]>`
        select id, stock_qty, cost_price, open_po from products where id in ${pgTx(outputs.map(o => o.productId))} order by id for update
      `;
      const productById = new Map(productRows.map(r => [r.id, r]));
      outputs.forEach(o => { if (!productById.has(o.productId)) throw new Error(`Produk "${o.productName}" tidak ditemukan.`); });

      for (const o of outputs) {
        const row = productById.get(o.productId)!;
        const oldQty  = Number(row.stock_qty) || 0;
        const oldCost = row.cost_price != null ? Number(row.cost_price) : 0;
        const newQty  = oldQty + o.yieldQty;
        const newCost = newQty > 0 ? (oldQty * oldCost + o.yieldQty * costPerPcs) / newQty : costPerPcs;
        const newStock = row.open_po ? 'open_po' : newQty > 0 ? 'ready' : 'habis';
        await pgTx`update products set stock_qty = ${newQty}, cost_price = ${newCost}, stock = ${newStock}, updated_at = now() where id = ${o.productId}`;

        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
          values (${`${warehouseId}_${o.productId}`}, ${warehouseId}, ${o.productId}, ${o.productName}, ${o.yieldQty}, now())
          on conflict (id) do update set
            stock_qty = warehouse_stock.stock_qty + excluded.stock_qty,
            product_name = excluded.product_name,
            updated_at = now()
        `;
        await writeStockLedgerEntryPg(pgTx, {
          productId: o.productId, productName: o.productName, warehouseId, warehouseName, type: 'in', qty: o.yieldQty,
          note: `Hasil produksi${data.note ? ` - ${data.note}` : ''}`,
        });
      }

      for (const m of materialsUsed) {
        const row = materialById.get(m.materialId)!;
        const oldQty = Number(row.stock_qty) || 0;
        const newQty = oldQty - m.qty;
        const minStock = Number(row.min_stock) || 0;
        await pgTx`update raw_materials set stock_qty = ${newQty}, updated_at = now() where id = ${m.materialId}`;

        // Notifikasi hanya saat baru MELEWATI ambang minimum, bukan tiap kali produksi jalan
        // selagi stoknya sudah rendah — supaya tidak spam.
        if (!isMaterialLowStock({ stockQty: oldQty, minStock }) && isMaterialLowStock({ stockQty: newQty, minStock })) {
          lowStockCrossings.push({ materialName: m.materialName, materialId: m.materialId, newQty, unit: m.unit, minStock });
        }
      }

      batchData = {
        date, outputs: outputsWithCost, materialsUsed: materialsWithCost,
        materialCost, otherCost, totalCost, totalYieldQty, costPerPcs,
        warehouseId, warehouseName, note: data.note ?? '',
        expenseId: otherCost > 0 ? expenseId : null,
      };
      if (otherCost > 0) {
        const productNames = outputs.map(o => o.productName).join(' & ');
        await pgTx`
          insert into expenses (id, category, description, amount, date, note, source_type, source_id, created_at, updated_at)
          values (${expenseId}, 'Produksi', ${`Biaya produksi - ${productNames}`}, ${otherCost}, ${date}, ${`Otomatis dari biaya lain (tenaga kerja/overhead) produksi ${totalYieldQty} pcs (${productNames})`}, 'production', ${batchId}, now(), now())
        `;
      }

      await pgTx`
        insert into production_batches (
          id, date, outputs, materials_used, material_cost, other_cost, total_cost, total_yield_qty, cost_per_pcs,
          warehouse_id, warehouse_name, note, expense_id, created_at
        ) values (
          ${batchId}, ${date}, ${JSON.stringify(outputsWithCost)}, ${JSON.stringify(materialsWithCost)},
          ${materialCost}, ${otherCost}, ${totalCost}, ${totalYieldQty}, ${costPerPcs},
          ${warehouseId}, ${warehouseName}, ${data.note ?? ''}, ${otherCost > 0 ? expenseId : null}, now()
        )
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan produksi.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'production', entityId: batchId,
      entityLabel: `Produksi ${date} - ${outputs.map(o => o.productName).join(' & ') || batchId}`,
      action: 'create', actor: guard, after: batchData,
    });
  } catch (err) {
    console.error('Failed to write history for production create', err);
  }
  await Promise.all(lowStockCrossings.map(m => notify(db, {
    type: 'stock_low',
    title: 'Stok bahan baku menipis',
    message: `${m.materialName} tersisa ${m.newQty} ${m.unit} (batas minimum ${m.minStock} ${m.unit}) — dari produksi oleh ${guard.username}.`,
    link: 'materials',
    entityCollection: 'rawMaterials', entityId: m.materialId,
    actor: guard,
  }))).catch(err => console.error('Failed to send push for low stock', err));

  if (otherCost > 0) revalidateTag('admin-expenses', { expire: 0 });
  after(() => revalidateStorefront('products'));

  return Response.json({ id: batchId });
}
