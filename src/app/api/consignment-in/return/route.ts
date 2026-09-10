import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';

// "Retur ke Partner" — barang titipan yang tak laku dikembalikan fisik ke partner, keluar dari
// stok kita (kebalikan "Terima Titipan"). Dipakai stock-pg.ts yang sama seperti kasir/pesanan
// (readProductsForDeltasPg sudah menghitung shortage otomatis kalau stok tidak cukup).
interface ReturnItemInput { productId: string; productName: string; qty: number }

function mergeItems(items: ReturnItemInput[]): ReturnItemInput[] {
  const merged = new Map<string, ReturnItemInput>();
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const existing = merged.get(it.productId);
    if (existing) existing.qty += qty;
    else merged.set(it.productId, { ...it, qty });
  }
  return [...merged.values()];
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    partnerId: string; partnerName: string; warehouseId: string; warehouseName?: string;
    note?: string; items: ReturnItemInput[]; date?: string;
  };
  const items = mergeItems(data.items ?? []);
  if (items.length === 0) return Response.json({ error: 'Minimal 1 produk diretur.' }, { status: 400 });
  if (!data.partnerId) return Response.json({ error: 'Pilih partner.' }, { status: 400 });
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang asal retur.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const shipmentId = randomUUID();
  const createdAt = data.date ? new Date(data.date) : new Date();

  try {
    await sql.begin(async pgTx => {
      const productIds = items.map(it => it.productId);
      const ownerRows = await pgTx<{ id: string; owner_type: string | null; consignor_id: string | null }[]>`
        select id, owner_type, consignor_id from products where id in ${pgTx(productIds)}
      `;
      const ownerById = new Map(ownerRows.map(r => [r.id, r]));
      const mismatches: string[] = [];
      items.forEach(it => {
        const row = ownerById.get(it.productId);
        if (!row || row.owner_type !== 'consigned_in' || row.consignor_id !== data.partnerId) {
          mismatches.push(`${it.productName} (bukan produk titipan partner ini)`);
        }
      });
      if (mismatches.length > 0) throw new Error(`Tidak bisa diretur: ${mismatches.join(', ')}`);

      const deltas = new Map(items.map(it => [it.productId, -it.qty]));
      const { products, shortages } = await readProductsForDeltasPg(pgTx, deltas);
      if (shortages.length > 0) throw new Error(`Stok tidak cukup untuk retur: ${shortages.join(', ')}`);

      for (const it of items) {
        const product = products.get(it.productId)!;
        await applyStockDeltaPg(pgTx, { productId: it.productId, product, warehouseId: data.warehouseId, delta: -it.qty });
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'out', qty: it.qty, note: `Retur titipan – ${data.partnerName}${data.note ? `: ${data.note}` : ''}`,
        });
      }

      await pgTx`
        insert into consignment_in_shipments (id, partner_id, partner_name, warehouse_id, warehouse_name, direction, items, note, created_at)
        values (${shipmentId}, ${data.partnerId}, ${data.partnerName}, ${data.warehouseId}, ${data.warehouseName ?? ''}, 'out', ${JSON.stringify(items)}, ${data.note ?? ''}, ${createdAt})
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan retur titipan.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInShipments', entityId: shipmentId,
      entityLabel: `Retur ke ${data.partnerName ?? ''}${data.date ? ` - ${data.date}` : ''}`,
      action: 'create', actor: guard, after: { ...data, items, direction: 'out' },
    });
  } catch (err) {
    console.error('Failed to write history for consignment-in return create', err);
  }

  revalidateTag('admin-consignment-in-shipments-list', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ id: shipmentId });
}
