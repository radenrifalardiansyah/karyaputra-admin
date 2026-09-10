import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { revalidateStorefront } from '@/lib/revalidate';
import { applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';

// "Terima Titipan" — partner membawa barang fisik masuk ke gudang kita (kebalikan "Kirim Stok" di
// consignment/send/route.ts arah keluar). Produk yang diterima HARUS sudah ditandai
// owner_type='consigned_in' + consignor_id partner ini (diisi lewat form Produk atau dibuat baru
// di form ini) — lihat plan snug-sparking-ocean.md. Stok masuk ke products/warehouse_stock biasa
// supaya langsung bisa dijual di Kasir tanpa sistem stok terpisah.
interface ReceiveItemInput { productId: string; productName: string; qty: number }

function mergeItems(items: ReceiveItemInput[]): ReceiveItemInput[] {
  const merged = new Map<string, ReceiveItemInput>();
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
    note?: string; items: ReceiveItemInput[]; date?: string;
  };
  const items = mergeItems(data.items ?? []);
  if (items.length === 0) return Response.json({ error: 'Minimal 1 produk diterima.' }, { status: 400 });
  if (!data.partnerId) return Response.json({ error: 'Pilih partner.' }, { status: 400 });
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang tujuan.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const shipmentId = randomUUID();
  const createdAt = data.date ? new Date(data.date) : new Date();

  try {
    await sql.begin(async pgTx => {
      const productIds = items.map(it => it.productId);
      const productRows = await pgTx<{ id: string; name: string; stock_qty: string; open_po: boolean; owner_type: string | null; consignor_id: string | null }[]>`
        select id, name, stock_qty, open_po, owner_type, consignor_id from products where id in ${pgTx(productIds)} order by id for update
      `;
      const productById = new Map(productRows.map(r => [r.id, r]));

      const mismatches: string[] = [];
      items.forEach(it => {
        const row = productById.get(it.productId);
        if (!row) { mismatches.push(`${it.productName} (produk tidak ditemukan)`); return; }
        if (row.owner_type !== 'consigned_in' || row.consignor_id !== data.partnerId) {
          mismatches.push(`${row.name} (bukan produk titipan partner ini — cek pengaturan kepemilikan di menu Produk)`);
        }
      });
      if (mismatches.length > 0) throw new Error(`Tidak bisa diterima: ${mismatches.join(', ')}`);

      for (const it of items) {
        const row = productById.get(it.productId)!;
        const oldQty = Number(row.stock_qty) || 0;
        await applyStockDeltaPg(pgTx, {
          productId: it.productId,
          product: { id: it.productId, exists: true, currentQty: oldQty, name: row.name, openPO: row.open_po, costPrice: 0, ownerType: 'consigned_in', consignorId: row.consignor_id, consignorName: null, settlementType: null, payoutPrice: null, commissionPct: null },
          warehouseId: data.warehouseId, delta: it.qty,
        });
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, productName: row.name, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'in', qty: it.qty, note: `Terima titipan – ${data.partnerName}${data.note ? `: ${data.note}` : ''}`,
        });
      }

      await pgTx`
        insert into consignment_in_shipments (id, partner_id, partner_name, warehouse_id, warehouse_name, direction, items, note, created_at)
        values (${shipmentId}, ${data.partnerId}, ${data.partnerName}, ${data.warehouseId}, ${data.warehouseName ?? ''}, 'in', ${JSON.stringify(items)}, ${data.note ?? ''}, ${createdAt})
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan penerimaan titipan.' }, { status: 400 });
  }

  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInShipments', entityId: shipmentId,
      entityLabel: `${data.partnerName ?? 'Terima Titipan'}${data.date ? ` - ${data.date}` : ''}`,
      action: 'create', actor: guard, after: { ...data, items },
    });
  } catch (err) {
    console.error('Failed to write history for consignment-in receive create', err);
  }
  try {
    await notify(db, {
      type: 'consignment_in_receive',
      title: 'Terima titipan masuk',
      message: `${totalQty} pcs diterima dari ${data.partnerName} — oleh ${guard.username}.`,
      link: 'consignment-in',
      entityCollection: 'consignmentInShipments', entityId: shipmentId, actor: guard,
    });
  } catch (err) {
    console.error('Failed to send notification for consignment-in receive', err);
  }

  revalidateTag('admin-consignment-in-shipments-list', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ id: shipmentId });
}
