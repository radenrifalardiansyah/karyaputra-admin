import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { voidConsignmentInLedgerForOrderPg } from '@/lib/consignment-in';

// Versi Postgres dari src/lib/order-stock.ts (Tahap 9 migrasi Fase 2). Dokumen `orders` itu
// sendiri MASIH di Firestore untuk sementara (lihat plan) — fungsi ini hanya mengurus sisi
// stoknya, dipanggil setelah (atau sebagai bagian dari) alur pembatalan/penghapusan order yang
// masih hidup di src/app/api/orders/[id]/route.ts.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgTx = postgres.ISql<{}>;

export interface RestorableOrderItem { productId?: string; name: string; qty: number }
export interface RestorableOrder {
  items?: RestorableOrderItem[];
  source?: string;
  invoiceNo?: string;
  stockCut?: boolean;
  stockRestored?: boolean;
  warehouseId?: string;
  warehouseName?: string;
}

// Sama seperti restoreOrderStockInTx (Firestore) — kembalikan stok satu pesanan yang stoknya
// sudah pernah dipotong. `pgTx` WAJIB diisi (dari `sql.begin(...)` milik caller) supaya jadi satu
// transaksi dengan penguncian baris produk yang sama seperti checkout/edit.
//
// Item lama tanpa `productId` (dicocokkan lewat nama) — beda dari versi Firestore yang query
// `where('name','==',...)` di dalam transaksi, di sini dilakukan SEBELUM `pgTx` (baca biasa via
// getSql(), bukan pgTx) karena bukan bagian yang perlu dikunci (cuma resolusi nama->id, bukan
// baca stok) — cek ambiguitas (>1 produk nama sama) tetap sama: kalau ambigu, lewati item itu.
export async function restoreOrderStockInTxPg(pgTx: PgTx, orderId: string, order: RestorableOrder): Promise<void> {
  // Baris consignment_in_ledger yang belum dibayar untuk order ini dibatalkan juga (tidak ikut
  // ditagih ke partner) — baris yang SUDAH dibayar (status 'settled') sengaja dibiarkan, lihat
  // catatan di voidConsignmentInLedgerForOrderPg. Dijalankan lepas dari wasStockCut di bawah,
  // supaya order PO yang stoknya belum sempat dipotong pun ledgernya tetap dibersihkan kalau ada.
  await voidConsignmentInLedgerForOrderPg(pgTx, orderId);

  const wasStockCut = order.stockCut === true || (order.source === 'kasir' && order.stockCut === undefined);
  if (!wasStockCut || order.stockRestored) return;
  const items = (order.items ?? []).filter(i => i.qty > 0);
  if (items.length === 0) return;

  const sql = getSql();
  const resolved = await Promise.all(items.map(async item => {
    if (item.productId) return item;
    const rows = await sql<{ id: string }[]>`select id from products where name = ${item.name} limit 2`;
    if (rows.length !== 1) return null;
    return { ...item, productId: rows[0].id };
  }));

  const deltas = new Map<string, number>();
  for (const item of resolved) {
    if (!item?.productId) continue;
    deltas.set(item.productId, (deltas.get(item.productId) ?? 0) + item.qty);
  }
  if (deltas.size === 0) return;

  const { products } = await readProductsForDeltasPg(pgTx, deltas);
  for (const [productId, delta] of deltas) {
    const product = products.get(productId)!;
    await applyStockDeltaPg(pgTx, { productId, product, warehouseId: order.warehouseId, delta });
    await writeStockLedgerEntryPg(pgTx, {
      productId, productName: product.name, warehouseId: order.warehouseId, warehouseName: order.warehouseName,
      type: 'in', qty: delta,
      note: `Restore stok — pesanan ${order.invoiceNo ?? ''} dibatalkan/dihapus`,
    });
  }
}
