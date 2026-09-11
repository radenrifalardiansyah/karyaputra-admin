import { NextRequest, after } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';
import { writeStockLedgerEntryPg, stockLabel } from '@/lib/stock-pg';
import { rowToBatch, mergeMaterialsUsed, mergeOutputs, type ProductionBatchRow, type BatchOutputRow, type BatchMaterialUsedRow } from '@/lib/materials-pg';

type Ctx = { params: Promise<{ id: string }> };

interface MaterialUsedInput { materialId: string; materialName: string; unit: string; qty: number }
interface OutputInput { productId: string; productName: string; yieldQty: number }
interface ProductRow { stock_qty: string; cost_price: string | null; open_po: boolean }

function outputSignature(outputs: { productId: string; yieldQty: number }[]) {
  return outputs.map(o => `${o.productId}:${o.yieldQty}`).sort().join('|');
}

// Reversal & re-terapan untuk bahan baku aman dilakukan kapan pun — avgCost bahan baku TIDAK
// dipengaruhi produksi (hanya stockQty), jadi tambah-balik lalu kurangi-baru selalu tepat secara
// kuantitas berapa pun urutan transaksi lain di antaranya.
//
// Untuk produk hasil, stockQty TIDAK BOLEH dihitung ulang lewat reverse-lalu-apply seperti bahan
// baku — kalau sebagian/semua hasil batch ini sudah terjual/dikirim konsinyasi setelah dibuat,
// curQty saat edit sudah lebih kecil dari yieldQty batch ini; reverse (curQty - yieldQty) akan
// negatif dan ke-clamp jadi 0, lalu apply menaruh yieldQty penuh lagi — diam-diam "mengembalikan"
// stok yang sudah keluar (bug nyata yang pernah kejadian, lihat riwayat edit 2026-09-07 yang
// mengembalikan stok Mie Kremes/Basreng ke angka produksi awal padahal sudah terjual/dikirim).
// Makanya qty HANYA digeser sebesar SELISIH yieldQty lama->baru (0 kalau yieldQty produk itu tidak
// berubah sama sekali) lewat `applyYieldDelta` di bawah — reverseProductState/applyProductState di
// sini cuma dipakai untuk membaurkan HPP (rata-rata tertimbang, boleh sedikit meleset — cek &
// koreksi manual lewat Edit Produk kalau HPP hasil akhirnya terasa tidak pas), bukan untuk qty.
function reverseProductState(curQty: number, curCost: number, yieldQty: number, costPerPcs: number) {
  const newQty = curQty - yieldQty;
  const newCost = newQty > 0 ? (curCost * curQty - yieldQty * costPerPcs) / newQty : 0;
  return { qty: Math.max(0, newQty), cost: Math.max(0, newCost) };
}

function applyYieldDelta(curQty: number, oldYieldQty: number, newYieldQty: number) {
  return Math.max(0, curQty + (newYieldQty - oldYieldQty));
}

function applyProductState(curQty: number, curCost: number, yieldQty: number, costPerPcs: number) {
  const newQty = curQty + yieldQty;
  const newCost = newQty > 0 ? (curCost * curQty + yieldQty * costPerPcs) / newQty : costPerPcs;
  return { qty: newQty, cost: newCost };
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'production', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    date?: string; note?: string; warehouseId?: string; warehouseName?: string;
    outputs: OutputInput[]; materialsUsed: MaterialUsedInput[]; otherCost?: number;
  };
  const newMaterialsUsed = mergeMaterialsUsed(data.materialsUsed ?? []);
  const newOutputs = mergeOutputs(data.outputs ?? []).filter(o => (Number(o.yieldQty) || 0) > 0);
  const newOtherCost = Number(data.otherCost) || 0;
  const date = data.date || new Date().toISOString().slice(0, 10);
  const newWarehouseId   = data.warehouseId ?? '';
  const newWarehouseName = data.warehouseName ?? '';
  if (newMaterialsUsed.length === 0) return Response.json({ error: 'Minimal 1 bahan baku dipakai.' }, { status: 400 });
  if (newOutputs.length === 0) return Response.json({ error: 'Minimal 1 produk hasil dengan jumlah lebih dari 0.' }, { status: 400 });
  if (!newWarehouseId) return Response.json({ error: 'Pilih gudang tujuan.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const newExpenseId = randomUUID();

  // `products`/`warehouse_stock`/`stock_ledger`/`rawMaterials`/`productionBatches`/`expenses` semuanya
  // Postgres sekarang (Tahap 18b) — digabung jadi SATU transaksi atomic, tidak perlu lagi kompensasi
  // cross-database seperti versi Firestore sebelumnya.
  let before: ReturnType<typeof rowToBatch>;
  let batchUpdate: Record<string, unknown>;
  let expenseChanged: boolean;

  try {
    ({ before, batchUpdate, expenseChanged } = await sql.begin(async pgTx => {
      const [row] = await pgTx<ProductionBatchRow[]>`select * from production_batches where id = ${id} for update`;
      if (!row) throw new Error('Batch produksi tidak ditemukan.');
      const batch = rowToBatch(row);
      let expenseChangedLocal = false;
      const oldOutputs = batch.outputs;
      const oldMaterialsUsed = batch.materialsUsed;
      const oldExpenseId = batch.expenseId;
      const oldWarehouseId = batch.warehouseId ?? '';
      const oldWarehouseName = batch.warehouseName;

      const productIds = [...new Set([...oldOutputs.map(o => o.productId), ...newOutputs.map(o => o.productId)])];
      const outputsChanged   = outputSignature(oldOutputs) !== outputSignature(newOutputs);
      const warehouseChanged = oldWarehouseId !== newWarehouseId;

      // Perbandingan lewat subquery (bukan JS Date yang dibaca balik dari `row.created_at`) supaya
      // presisi mikrodetik asli `timestamptz` tidak hilang — lihat komentar sama di
      // material-purchases/[id]/route.ts.
      const laterBatchRows = await pgTx<{ outputs: unknown }[]>`select outputs from production_batches where created_at > (select created_at from production_batches where id = ${id}) and id != ${id}`;
      const laterTouched = new Set<string>();
      laterBatchRows.forEach(r => {
        ((parseJsonb(r.outputs) as BatchOutputRow[] | null) ?? []).forEach(o => laterTouched.add(o.productId));
      });
      const blockedByLaterProduction = productIds.filter(pid => laterTouched.has(pid));
      if (blockedByLaterProduction.length > 0) {
        const names = [...oldOutputs, ...newOutputs].filter(o => blockedByLaterProduction.includes(o.productId)).map(o => o.productName);
        throw new Error(`Tidak bisa diedit — produk sudah diproduksi lagi setelah batch ini: ${[...new Set(names)].join(', ')}.`);
      }

      if (outputsChanged || warehouseChanged) {
        const consumedRows = await pgTx<{ product_id: string }[]>`
          select distinct product_id from stock_ledger
          where created_at > (select created_at from production_batches where id = ${id}) and type = 'out'
            and note not like 'Koreksi edit produksi%' and note <> 'Hapus batch produksi'
        `;
        const consumedSince = new Set(consumedRows.map(r => r.product_id));
        const blockedByConsumption = productIds.filter(pid => consumedSince.has(pid));
        if (blockedByConsumption.length > 0) {
          const names = [...oldOutputs, ...newOutputs].filter(o => blockedByConsumption.includes(o.productId)).map(o => o.productName);
          throw new Error(`Tidak bisa mengubah jumlah produk atau gudang tujuan — sebagian stok hasil produksi ini sudah terjual/keluar dari gudang: ${[...new Set(names)].join(', ')}. Tanggal, catatan, dan biaya lain tetap bisa diedit tanpa mengubah jumlah/gudang.`);
        }
      }

      const materialIds = [...new Set([...oldMaterialsUsed.map(m => m.materialId), ...newMaterialsUsed.map(m => m.materialId)])];
      const materialRows = await pgTx<{ id: string; stock_qty: string; avg_cost: string }[]>`
        select id, stock_qty, avg_cost from raw_materials where id in ${pgTx(materialIds)} order by id for update
      `;
      const materialById = new Map(materialRows.map(r => [r.id, r]));
      newMaterialsUsed.forEach(m => { if (!materialById.has(m.materialId)) throw new Error(`Bahan baku "${m.materialName}" tidak ditemukan.`); });

      // Bahan baku: kembalikan dulu qty batch lama, lalu cek kecukupan stok memakai qty batch baru.
      const materialState = new Map<string, number>();
      materialIds.forEach(mid => materialState.set(mid, Number(materialById.get(mid)?.stock_qty) || 0));
      oldMaterialsUsed.forEach(m => materialState.set(m.materialId, (materialState.get(m.materialId) ?? 0) + m.qty));

      const shortages: string[] = [];
      newMaterialsUsed.forEach(m => {
        const stockQty = materialState.get(m.materialId) ?? 0;
        if (stockQty < m.qty) shortages.push(`${m.materialName} (stok ${Math.round(stockQty * 100) / 100} ${m.unit}, butuh ${m.qty} ${m.unit})`);
      });
      if (shortages.length > 0) throw new Error(`Stok bahan baku tidak cukup: ${shortages.join(', ')}`);

      const materialsWithCost: BatchMaterialUsedRow[] = newMaterialsUsed.map(m => {
        const costPerUnit = Number(materialById.get(m.materialId)!.avg_cost) || 0;
        return { ...m, costPerUnit, cost: costPerUnit * m.qty };
      });
      const materialCost  = materialsWithCost.reduce((s, m) => s + m.cost, 0);
      const totalCost     = materialCost + newOtherCost;
      const totalYieldQty = newOutputs.reduce((s, o) => s + o.yieldQty, 0);
      const costPerPcs    = totalCost / totalYieldQty;

      materialIds.forEach(mid => materialState.set(mid, materialState.get(mid)! - (newMaterialsUsed.find(m => m.materialId === mid)?.qty ?? 0)));
      for (const mid of materialIds) {
        await pgTx`update raw_materials set stock_qty = ${Math.max(0, materialState.get(mid) ?? 0)}, updated_at = now() where id = ${mid}`;
      }

      const productRows = await pgTx<(ProductRow & { id: string })[]>`
        select id, stock_qty, cost_price, open_po from products where id in ${pgTx(productIds)} order by id for update
      `;
      const byId = new Map(productRows.map(r => [r.id, r]));
      newOutputs.forEach(o => { if (!byId.has(o.productId)) throw new Error(`Produk "${o.productName}" tidak ditemukan.`); });

      // Produk hasil: HPP dibaurkan lewat reverse-lalu-apply (rata-rata tertimbang bersifat
      // asosiatif), TAPI qty digeser terpisah lewat selisih yieldQty lama->baru saja — lihat
      // komentar di applyYieldDelta di atas untuk alasan kenapa qty tidak boleh direkonstruksi
      // ulang dari yieldQty batch begitu saja.
      const oldByProduct = new Map(oldOutputs.map(o => [o.productId, o]));
      const newByProduct = new Map(newOutputs.map(o => [o.productId, o]));
      const productState = new Map<string, { qty: number; cost: number }>();
      productIds.forEach(pid => {
        const row2 = byId.get(pid);
        const qty = row2 ? Number(row2.stock_qty) || 0 : 0;
        const cost = row2?.cost_price != null ? Number(row2.cost_price) : 0;
        productState.set(pid, { qty, cost });
      });
      const outputsWithCost: BatchOutputRow[] = [];
      for (const pid of productIds) {
        const st = productState.get(pid)!;
        const oldO = oldByProduct.get(pid);
        const newO = newByProduct.get(pid);
        let costState = { qty: st.qty, cost: st.cost };
        if (oldO) costState = reverseProductState(costState.qty, costState.cost, oldO.yieldQty, oldO.costPerPcs);
        if (newO) costState = applyProductState(costState.qty, costState.cost, newO.yieldQty, costPerPcs);
        const qty = applyYieldDelta(st.qty, oldO?.yieldQty ?? 0, newO?.yieldQty ?? 0);
        productState.set(pid, { qty, cost: costState.cost });
        if (newO) outputsWithCost.push({ ...newO, costPerPcs });
      }
      for (const pid of productIds) {
        const st = productState.get(pid)!;
        const openPO = byId.get(pid)?.open_po ?? false;
        await pgTx`update products set stock_qty = ${st.qty}, cost_price = ${st.cost}, stock = ${stockLabel(openPO, st.qty)}, updated_at = now() where id = ${pid}`;
      }

      // Stok gudang: kembalikan efek batch lama di gudang lama, lalu terapkan output batch baru di
      // gudang baru — hanya kalau produk hasil/jumlah atau gudang tujuan benar-benar berubah.
      if (outputsChanged || warehouseChanged) {
        if (oldWarehouseId) {
          for (const o of oldOutputs) {
            await pgTx`
              update warehouse_stock set stock_qty = greatest(0, stock_qty - ${o.yieldQty}), updated_at = now()
              where id = ${`${oldWarehouseId}_${o.productId}`}
            `;
            await writeStockLedgerEntryPg(pgTx, {
              productId: o.productId, productName: o.productName, warehouseId: oldWarehouseId, warehouseName: oldWarehouseName,
              type: 'out', qty: o.yieldQty, note: 'Koreksi edit produksi (batch lama)',
            });
          }
        }
        for (const o of newOutputs) {
          await pgTx`
            insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
            values (${`${newWarehouseId}_${o.productId}`}, ${newWarehouseId}, ${o.productId}, ${o.productName}, ${o.yieldQty}, now())
            on conflict (id) do update set stock_qty = warehouse_stock.stock_qty + excluded.stock_qty, product_name = excluded.product_name, updated_at = now()
          `;
          await writeStockLedgerEntryPg(pgTx, {
            productId: o.productId, productName: o.productName, warehouseId: newWarehouseId, warehouseName: newWarehouseName,
            type: 'in', qty: o.yieldQty, note: 'Koreksi edit produksi (batch baru)',
          });
        }
      }

      // Sinkronkan Pengeluaran otomatis biaya lain dengan nilai terbaru.
      const [oldExpenseRow] = oldExpenseId ? await pgTx<{ id: string }[]>`select id from expenses where id = ${oldExpenseId}` : [];
      const oldExpenseExists = !!oldExpenseRow;
      let expenseIdToStore: string | null = oldExpenseExists ? (oldExpenseId ?? null) : null;
      let expenseIdToDelete: string | null = null;
      const productNames = newOutputs.map(o => o.productName).join(' & ');
      if (newOtherCost > 0) {
        expenseChangedLocal = true;
        if (oldExpenseExists && oldExpenseId) {
          await pgTx`update expenses set description = ${`Biaya produksi - ${productNames}`}, amount = ${newOtherCost}, date = ${date}, updated_at = now() where id = ${oldExpenseId}`;
        } else {
          expenseIdToStore = newExpenseId;
          await pgTx`
            insert into expenses (id, category, description, amount, date, note, source_type, source_id, created_at, updated_at)
            values (${newExpenseId}, 'Produksi', ${`Biaya produksi - ${productNames}`}, ${newOtherCost}, ${date}, ${`Otomatis dari biaya lain (tenaga kerja/overhead) produksi ${totalYieldQty} pcs (${productNames})`}, 'production', ${id}, now(), now())
          `;
        }
      } else if (oldExpenseExists && oldExpenseId) {
        // Baris `expenses` baru boleh dihapus SETELAH `production_batches.expense_id` dilepas
        // (di bawah) — FK-nya RESTRICT & non-deferrable, jadi delete di sini (selagi masih
        // direferensikan) langsung ditolak Postgres. Lihat riwayat bug expense_id_fkey di POST.
        expenseChangedLocal = true;
        expenseIdToDelete = oldExpenseId;
        expenseIdToStore = null;
      }

      const batchUpdateLocal = {
        date, outputs: outputsWithCost, materialsUsed: materialsWithCost,
        materialCost, otherCost: newOtherCost, totalCost, totalYieldQty, costPerPcs,
        warehouseId: newWarehouseId, warehouseName: newWarehouseName,
        note: data.note ?? '', expenseId: expenseIdToStore,
      };
      await pgTx`
        update production_batches set
          date = ${date}, outputs = ${JSON.stringify(outputsWithCost)}, materials_used = ${JSON.stringify(materialsWithCost)},
          material_cost = ${materialCost}, other_cost = ${newOtherCost}, total_cost = ${totalCost},
          total_yield_qty = ${totalYieldQty}, cost_per_pcs = ${costPerPcs},
          warehouse_id = ${newWarehouseId}, warehouse_name = ${newWarehouseName}, note = ${data.note ?? ''},
          expense_id = ${expenseIdToStore}, updated_at = now()
        where id = ${id}
      `;
      if (expenseIdToDelete) {
        await pgTx`delete from expenses where id = ${expenseIdToDelete}`;
      }
      return { before: batch, batchUpdate: batchUpdateLocal, expenseChanged: expenseChangedLocal };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'production', entityId: id,
      entityLabel: `Produksi ${date} - ${newOutputs.map(o => o.productName).join(' & ') || id}`,
      action: 'update', actor: guard, before, after: batchUpdate,
    });
  } catch (err) {
    console.error('Failed to write history for production update', err);
  }
  if (expenseChanged) revalidateTag('admin-expenses', { expire: 0 });

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'production', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  let before: ReturnType<typeof rowToBatch>;
  let expenseDeleted: boolean;

  try {
    ({ before, expenseDeleted } = await sql.begin(async pgTx => {
      const [row] = await pgTx<ProductionBatchRow[]>`select * from production_batches where id = ${id} for update`;
      if (!row) throw new Error('Batch produksi tidak ditemukan.');
      const batch = rowToBatch(row);
      let deleted = false;
      const outputs = batch.outputs;
      const materialsUsed = batch.materialsUsed;
      const warehouseId = batch.warehouseId ?? '';
      const warehouseName = batch.warehouseName;

      const productIds = outputs.map(o => o.productId);

      // Perbandingan lewat subquery (bukan JS Date yang dibaca balik dari `row.created_at`) supaya
      // presisi mikrodetik asli `timestamptz` tidak hilang — lihat komentar sama di
      // material-purchases/[id]/route.ts.
      const laterBatchRows = await pgTx<{ outputs: unknown }[]>`select outputs from production_batches where created_at > (select created_at from production_batches where id = ${id}) and id != ${id}`;
      const laterTouched = new Set<string>();
      laterBatchRows.forEach(r => {
        ((parseJsonb(r.outputs) as BatchOutputRow[] | null) ?? []).forEach(o => laterTouched.add(o.productId));
      });
      const blockedByLaterProduction = productIds.filter(pid => laterTouched.has(pid));
      if (blockedByLaterProduction.length > 0) {
        const names = outputs.filter(o => blockedByLaterProduction.includes(o.productId)).map(o => o.productName);
        throw new Error(`Tidak bisa dihapus — produk sudah diproduksi lagi setelah batch ini: ${[...new Set(names)].join(', ')}.`);
      }

      const consumedRows = await pgTx<{ product_id: string }[]>`
        select distinct product_id from stock_ledger
        where created_at > (select created_at from production_batches where id = ${id}) and type = 'out'
          and note not like 'Koreksi edit produksi%' and note <> 'Hapus batch produksi'
      `;
      const consumedSince = new Set(consumedRows.map(r => r.product_id));
      const blockedByConsumption = productIds.filter(pid => consumedSince.has(pid));
      if (blockedByConsumption.length > 0) {
        const names = outputs.filter(o => blockedByConsumption.includes(o.productId)).map(o => o.productName);
        throw new Error(`Tidak bisa dihapus — sebagian stok hasil produksi ini sudah terjual/keluar dari gudang: ${[...new Set(names)].join(', ')}.`);
      }

      const productRows = await pgTx<(ProductRow & { id: string })[]>`
        select id, stock_qty, cost_price, open_po from products where id in ${pgTx(productIds)} order by id for update
      `;
      const byId = new Map(productRows.map(r => [r.id, r]));

      for (const o of outputs) {
        const row2 = byId.get(o.productId);
        if (!row2) continue;
        const curQty  = Number(row2.stock_qty) || 0;
        const curCost = row2.cost_price != null ? Number(row2.cost_price) : 0;
        const { qty, cost } = reverseProductState(curQty, curCost, o.yieldQty, o.costPerPcs);
        await pgTx`update products set stock_qty = ${qty}, cost_price = ${cost}, stock = ${stockLabel(row2.open_po, qty)}, updated_at = now() where id = ${o.productId}`;
      }

      // Kembalikan stok gudang tujuan batch ini (batch lama sebelum fitur ini tidak punya warehouseId).
      if (warehouseId) {
        for (const o of outputs) {
          await pgTx`
            update warehouse_stock set stock_qty = greatest(0, stock_qty - ${o.yieldQty}), updated_at = now()
            where id = ${`${warehouseId}_${o.productId}`}
          `;
          await writeStockLedgerEntryPg(pgTx, {
            productId: o.productId, productName: o.productName, warehouseId, warehouseName,
            type: 'out', qty: o.yieldQty, note: 'Hapus batch produksi',
          });
        }
      }

      const materialIds = materialsUsed.map(m => m.materialId);
      if (materialIds.length > 0) {
        const materialRows = await pgTx<{ id: string; stock_qty: string }[]>`
          select id, stock_qty from raw_materials where id in ${pgTx(materialIds)} order by id for update
        `;
        const materialById = new Map(materialRows.map(r => [r.id, r]));
        for (const m of materialsUsed) {
          const mrow = materialById.get(m.materialId);
          if (!mrow) continue;
          const stockQty = Number(mrow.stock_qty) || 0;
          await pgTx`update raw_materials set stock_qty = ${stockQty + m.qty}, updated_at = now() where id = ${m.materialId}`;
        }
      }

      // `production_batches` harus dihapus DULU sebelum `expenses` — FK expense_id-nya RESTRICT &
      // non-deferrable, jadi delete `expenses` selagi masih direferensikan langsung ditolak Postgres.
      await pgTx`delete from production_batches where id = ${id}`;

      if (batch.expenseId) {
        const [expenseRow] = await pgTx<{ id: string }[]>`select id from expenses where id = ${batch.expenseId}`;
        if (expenseRow) {
          await pgTx`delete from expenses where id = ${batch.expenseId}`;
          deleted = true;
        }
      }

      return { before: batch, expenseDeleted: deleted };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus batch produksi.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'production', entityId: id,
      entityLabel: `Produksi ${before.date} - ${before.outputs.map(o => o.productName).join(' & ') || id}`,
      action: 'delete', actor: guard, before,
    });
  } catch (err) {
    console.error('Failed to write history for production delete', err);
  }
  if (expenseDeleted) revalidateTag('admin-expenses', { expire: 0 });

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
