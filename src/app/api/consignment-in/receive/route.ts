import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { revalidateStorefront } from '@/lib/revalidate';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg, stockKey } from '@/lib/stock-pg';

// "Terima Titipan" — partner membawa barang fisik masuk ke gudang kita (kebalikan "Kirim Stok" di
// consignment/send/route.ts arah keluar). Produk yang diterima HARUS sudah ditandai
// owner_type='consigned_in' + consignor_id partner ini (diisi lewat form Produk atau dibuat baru
// di form ini) — lihat plan snug-sparking-ocean.md. Stok masuk ke products/warehouse_stock biasa
// supaya langsung bisa dijual di Kasir tanpa sistem stok terpisah. `variantId` opsional — kalau
// diisi, stok masuk ke varian tertentu (bukan agregat produk induk); kepemilikan/settlement tetap
// dibaca dari produk induk (lihat catatan di stock-pg.ts).
interface ReceiveItemInput { productId: string; variantId?: string; productName: string; qty: number }

function mergeItems(items: ReceiveItemInput[]): ReceiveItemInput[] {
  const merged = new Map<string, ReceiveItemInput>();
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const key = stockKey(it.productId, it.variantId);
    const existing = merged.get(key);
    if (existing) existing.qty += qty;
    else merged.set(key, { ...it, qty });
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
      const deltas = new Map(items.map(it => [stockKey(it.productId, it.variantId), it.qty]));
      const { products } = await readProductsForDeltasPg(pgTx, deltas);

      const mismatches: string[] = [];
      items.forEach(it => {
        const product = products.get(stockKey(it.productId, it.variantId));
        if (!product?.exists) { mismatches.push(`${it.productName} (produk tidak ditemukan)`); return; }
        if (product.ownerType !== 'consigned_in' || product.consignorId !== data.partnerId) {
          mismatches.push(`${product.name} (bukan produk titipan partner ini — cek pengaturan kepemilikan di menu Produk)`);
        }
      });
      if (mismatches.length > 0) throw new Error(`Tidak bisa diterima: ${mismatches.join(', ')}`);

      for (const it of items) {
        const product = products.get(stockKey(it.productId, it.variantId))!;
        await applyStockDeltaPg(pgTx, { product, warehouseId: data.warehouseId, delta: it.qty });
        await writeStockLedgerEntryPg(pgTx, {
          productId: product.id, variantId: product.variantId, productName: product.name,
          warehouseId: data.warehouseId, warehouseName: data.warehouseName,
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
