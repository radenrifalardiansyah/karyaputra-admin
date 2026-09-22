import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';
import { readProductsForDeltasPg, applyStockCostPg, writeStockLedgerEntryPg, stockKey, warehouseStockKey } from '@/lib/stock-pg';

type Ctx = { params: Promise<{ id: string }> };
interface ShipmentItemInput { productId: string; variantId?: string; productName: string; qty: number }
interface ShipmentRow {
  id: string; partner_id: string; partner_name: string | null; warehouse_id: string | null; warehouse_name: string | null;
  direction: string; items: unknown; note: string | null; created_at: Date;
}

function mergeItems(items: ShipmentItemInput[]): ShipmentItemInput[] {
  const merged = new Map<string, ShipmentItemInput>();
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const key = stockKey(it.productId, it.variantId);
    const existing = merged.get(key);
    if (existing) existing.qty += qty;
    else merged.set(key, { ...it, qty });
  }
  return [...merged.values()];
}

// Hapus riwayat Terima/Retur — membalik efek stok (products/product_variants + warehouse_stock)
// yang tercatat saat dibuat, lalu menghapus dokumennya sendiri, dalam SATU transaksi Postgres.
// Ditolak kalau stoknya sudah terpakai (dijual/diretur lagi) sehingga tidak cukup untuk dibalik —
// sama pola dengan consignment/send/[id]/route.ts DELETE (arah keluar).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment-in', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [row] = await sql<ShipmentRow[]>`select * from consignment_in_shipments where id = ${id}`;
  if (!row) return Response.json({ error: 'Riwayat tidak ditemukan.' }, { status: 404 });
  const items = parseJsonb<ShipmentItemInput[]>(row.items as ShipmentItemInput[] | string | null) ?? [];
  const isReceive = row.direction !== 'out';

  try {
    await sql.begin(async pgTx => {
      // Membalik: Terima (in) dihapus → stok berkurang (delta negatif); Retur (out) dihapus → stok
      // bertambah lagi (delta positif). readProductsForDeltasPg otomatis menghitung shortage kalau
      // delta negatif melebihi stok yang tersisa sekarang (artinya sudah terpakai/dijual/diretur lagi).
      const deltas = new Map(items.map(it => [stockKey(it.productId, it.variantId), isReceive ? -it.qty : it.qty]));
      const { products, shortages } = await readProductsForDeltasPg(pgTx, deltas);
      if (shortages.length > 0) {
        throw new Error(`Tidak bisa dihapus — sebagian stok riwayat ini sudah terpakai: ${shortages.join(', ')}`);
      }

      for (const it of items) {
        const key = stockKey(it.productId, it.variantId);
        const product = products.get(key);
        if (!product?.exists) continue;
        const delta = isReceive ? -it.qty : it.qty;
        const newQty = Math.max(0, product.currentQty + delta);
        await applyStockCostPg(pgTx, { product, newQty, newCost: product.costPrice });

        if (row.warehouse_id) {
          const wsId = warehouseStockKey(row.warehouse_id, product.id, product.variantId);
          const wsRows = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${wsId} for update`;
          const oldWsQty = wsRows[0] ? Number(wsRows[0].stock_qty) || 0 : 0;
          const newWsQty = Math.max(0, oldWsQty + delta);
          await pgTx`
            insert into warehouse_stock (id, warehouse_id, product_id, variant_id, product_name, stock_qty, updated_at)
            values (${wsId}, ${row.warehouse_id}, ${product.id}, ${product.variantId}, ${product.name}, ${newWsQty}, now())
            on conflict (id) do update set stock_qty = ${newWsQty}, updated_at = now()
          `;
        }
      }

      await pgTx`delete from consignment_in_shipments where id = ${id}`;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInShipments', entityId: id,
      entityLabel: `${isReceive ? 'Terima Titipan' : 'Retur ke Partner'} — ${row.partner_name ?? ''}`,
      action: 'delete', actor: guard, before: { ...row, items },
    });
  } catch (err) {
    console.error('Failed to write history for consignment-in shipment delete', err);
  }

  revalidateTag('admin-consignment-in-shipments-list', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}

// Edit riwayat Terima/Retur — membalik efek stok lama, memvalidasi & menerapkan efek stok baru,
// lalu menulis ulang dokumennya, dalam SATU transaksi. Partner & arah (Terima/Retur) TIDAK bisa
// diubah lewat edit (kalau salah arah, hapus lalu buat baru) — cuma gudang, produk/qty, catatan,
// dan tanggal. Log gudang lama dibiarkan sebagai riwayat historis, sama seperti consignment/send.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment-in', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    warehouseId: string; warehouseName?: string; note?: string; items: ShipmentItemInput[]; date?: string;
  };
  const newItems = mergeItems(data.items ?? []);
  if (newItems.length === 0) return Response.json({ error: 'Minimal 1 produk.' }, { status: 400 });
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();

  const [row] = await sql<ShipmentRow[]>`select * from consignment_in_shipments where id = ${id}`;
  if (!row) return Response.json({ error: 'Riwayat tidak ditemukan.' }, { status: 404 });
  const oldItems = mergeItems(parseJsonb<ShipmentItemInput[]>(row.items as ShipmentItemInput[] | string | null) ?? []);
  const isReceive = row.direction !== 'out';
  const actionLabel = isReceive ? 'Terima titipan' : 'Retur titipan';
  const newCreatedAt = data.date ? new Date(data.date) : row.created_at;

  const allKeys = [...new Set([...oldItems, ...newItems].map(it => stockKey(it.productId, it.variantId)))];
  const productNameByKey = new Map<string, string>();
  [...oldItems, ...newItems].forEach(it => {
    const key = stockKey(it.productId, it.variantId);
    if (!productNameByKey.has(key)) productNameByKey.set(key, it.productName);
  });

  try {
    await sql.begin(async pgTx => {
      const { products } = await readProductsForDeltasPg(pgTx, new Map(allKeys.map(k => [k, 0])));
      const productQty = new Map(allKeys.map(k => [k, products.get(k)?.currentQty ?? 0]));

      const wsDelta = new Map<string, { warehouseId: string; productId: string; variantId?: string | null; delta: number }>();
      const bumpWs = (warehouseId: string, productId: string, variantId: string | null | undefined, delta: number) => {
        const key = warehouseStockKey(warehouseId, productId, variantId);
        const cur = wsDelta.get(key);
        if (cur) cur.delta += delta;
        else wsDelta.set(key, { warehouseId, productId, variantId, delta });
      };

      // 1) Balik efek lama (di gudang lama)
      for (const it of oldItems) {
        const key = stockKey(it.productId, it.variantId);
        const reverseDelta = isReceive ? -it.qty : it.qty;
        const nextQty = (productQty.get(key) ?? 0) + reverseDelta;
        if (nextQty < 0) {
          throw new Error(`Tidak bisa diubah — sebagian stok riwayat lama sudah terpakai: ${productNameByKey.get(key) ?? it.productName}.`);
        }
        productQty.set(key, nextQty);
        if (row.warehouse_id) bumpWs(row.warehouse_id, it.productId, it.variantId, reverseDelta);
      }

      // 2) Validasi kepemilikan & terapkan efek baru (di gudang baru)
      const mismatches: string[] = [];
      const shortages: string[] = [];
      for (const it of newItems) {
        const key = stockKey(it.productId, it.variantId);
        const product = products.get(key);
        if (!product?.exists) { mismatches.push(`${it.productName} (produk tidak ditemukan)`); continue; }
        if (product.ownerType !== 'consigned_in' || product.consignorId !== row.partner_id) {
          mismatches.push(`${product.name} (bukan produk titipan partner ini)`);
          continue;
        }
        const applyDelta = isReceive ? it.qty : -it.qty;
        const nextQty = (productQty.get(key) ?? 0) + applyDelta;
        if (nextQty < 0) { shortages.push(`${product.name} (stok tidak cukup untuk diretur)`); continue; }
        productQty.set(key, nextQty);
        bumpWs(data.warehouseId, it.productId, it.variantId, applyDelta);
      }
      if (mismatches.length > 0) throw new Error(`Tidak bisa disimpan: ${mismatches.join(', ')}`);
      if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

      // 3) Tulis ulang qty absolut produk yang tersentuh (HPP dipertahankan)
      for (const key of allKeys) {
        const product = products.get(key);
        if (!product?.exists) continue;
        await applyStockCostPg(pgTx, { product, newQty: Math.max(0, productQty.get(key) ?? 0), newCost: product.costPrice });
      }
      // 4) Tulis ulang delta warehouse_stock yang tersentuh
      for (const [key, { warehouseId, productId, variantId, delta }] of wsDelta) {
        if (delta === 0) continue;
        const rows = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${key} for update`;
        const oldQty = rows[0] ? Number(rows[0].stock_qty) || 0 : 0;
        const newQty = Math.max(0, oldQty + delta);
        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, variant_id, product_name, stock_qty, updated_at)
          values (${key}, ${warehouseId}, ${productId}, ${variantId ?? null}, ${productNameByKey.get(stockKey(productId, variantId ?? undefined)) ?? ''}, ${newQty}, now())
          on conflict (id) do update set stock_qty = ${newQty}, updated_at = now()
        `;
      }

      // Log gudang baru untuk item hasil edit — log lama dibiarkan sebagai riwayat historis.
      for (const it of newItems) {
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, variantId: it.variantId, productName: it.productName,
          warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: isReceive ? 'in' : 'out', qty: it.qty,
          note: `${actionLabel} (diedit) – ${row.partner_name ?? ''}${data.note ? `: ${data.note}` : ''}`,
        });
      }

      await pgTx`
        update consignment_in_shipments set
          warehouse_id = ${data.warehouseId}, warehouse_name = ${data.warehouseName ?? ''},
          items = ${JSON.stringify(newItems)}, note = ${data.note ?? ''}, created_at = ${newCreatedAt}
        where id = ${id}
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah riwayat.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInShipments', entityId: id,
      entityLabel: `${actionLabel} — ${row.partner_name ?? ''}${data.date ? ` - ${data.date}` : ''}`,
      action: 'update', actor: guard, before: { ...row, items: oldItems },
      after: { warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '', items: newItems, note: data.note ?? '' },
    });
  } catch (err) {
    console.error('Failed to write history for consignment-in shipment update', err);
  }

  revalidateTag('admin-consignment-in-shipments-list', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
