import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import type { ProductStockInfoPg } from '@/lib/stock-pg';

// Helper bersama untuk fitur "Titip Masuk" (konsinyasi MASUK — partner luar menitip barang ke
// toko kita, kebalikan arah dari fitur "Mitra" existing). Dipakai oleh orders/route.ts (checkout
// kasir), orders/[id]/route.ts ("Jual sebagai PO" yang baru dipotong stoknya saat status jadi
// Selesai), dan endpoint /api/consignment-in/*. Lihat plan snug-sparking-ocean.md.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/stock-pg.ts
type PgTx = postgres.ISql<{}>;

// `commissionPct` adalah komisi TOKO (bagian yang toko simpan) dari harga jual, sisanya jadi hak
// partner — jadi payout ke partner = hargaJual * qty * (1 - commissionPct/100). Untuk mode
// 'fixed', partner sudah sepakat harga beli-titip tetap per unit terlepas dari harga jual toko.
export function computeConsignmentPayout(product: ProductStockInfoPg, qty: number, unitPrice: number): number {
  if (product.ownerType !== 'consigned_in') return 0;
  if (product.settlementType === 'percentage') {
    const commissionPct = product.commissionPct ?? 0;
    return Math.round(unitPrice * qty * (1 - commissionPct / 100));
  }
  // Default ke 'fixed' kalau settlementType belum diisi — payoutPrice kosong dianggap 0 (bukan
  // dilempar error) supaya checkout tidak macet gara-gara data produk belum lengkap; produk yang
  // datanya kurang lengkap akan terlihat jelas dari payout Rp0 di riwayat "Titip Masuk".
  return (product.payoutPrice ?? 0) * qty;
}

export interface ConsignmentInLedgerEntry {
  orderId: string; productId: string; productName: string;
  consignorId: string; consignorName: string; qty: number; payoutAmount: number;
}

export async function writeConsignmentInLedgerEntryPg(pgTx: PgTx, entry: ConsignmentInLedgerEntry): Promise<void> {
  const id = randomUUID();
  await pgTx`
    insert into consignment_in_ledger (
      id, order_id, product_id, product_name, consignor_id, consignor_name, qty, payout_amount, status, created_at
    ) values (
      ${id}, ${entry.orderId}, ${entry.productId}, ${entry.productName},
      ${entry.consignorId}, ${entry.consignorName}, ${entry.qty}, ${entry.payoutAmount}, 'unsettled', now()
    )
  `;
}

// Dipanggil saat order dibatalkan/dihapus (restoreOrderStockInTxPg) — baris ledger yang belum
// dibayar dibatalkan (tidak ikut jadi tagihan ke partner), sedangkan yang SUDAH dibayar (status
// 'settled') SENGAJA dibiarkan: uang sudah keluar ke partner, pembatalan order setelah settlement
// perlu direkonsiliasi manual (retur fisik ke partner lewat menu Titip Masuk), bukan otomatis
// dihapus diam-diam.
export async function voidConsignmentInLedgerForOrderPg(pgTx: PgTx, orderId: string): Promise<void> {
  await pgTx`
    update consignment_in_ledger set status = 'voided'
    where order_id = ${orderId} and status = 'unsettled'
  `;
}

// Dipanggil dari PUT /api/orders/[id] saat admin mengedit item pesanan yang stoknya SUDAH
// dipotong (order.stockCut) — qty produk titipan yang berubah harus ikut mengubah tagihan ke
// partner, bukan diam-diam melenceng dari stok yang sebenarnya bergerak.
//
// Pendekatan: hitung ulang dari nol tiap kali dipanggil (bukan menambah/mengurangi baris lama
// secara parsial) — semua baris 'unsettled' untuk (order, produk) ini dibatalkan, lalu satu baris
// baru ditulis untuk sisa qty yang belum disettle, dihitung dari harga & aturan settlement produk
// TERKINI. Ini menghindari matematika pecahan per baris (harga/komisi bisa saja sudah berubah
// sejak baris lama ditulis) dan tetap aman terhadap qty yang SUDAH disettle — settled tidak pernah
// disentuh, dan qty baru tidak boleh turun sampai di bawah yang sudah dibayar (lihat error di bawah).
export async function reconcileConsignmentInLedgerForOrderItemPg(
  pgTx: PgTx,
  opts: { orderId: string; product: ProductStockInfoPg; newQty: number; unitPrice: number },
): Promise<void> {
  const { orderId, product, newQty, unitPrice } = opts;
  if (product.ownerType !== 'consigned_in' || !product.consignorId) return;

  const rows = await pgTx<{ id: string; qty: string; status: string }[]>`
    select id, qty, status from consignment_in_ledger
    where order_id = ${orderId} and product_id = ${product.id} and status in ('unsettled', 'settled')
    order by id for update
  `;
  const settledQty = rows.filter(r => r.status === 'settled').reduce((s, r) => s + (Number(r.qty) || 0), 0);
  if (newQty < settledQty) {
    throw new Error(
      `Qty "${product.name}" tidak bisa dikurangi sampai di bawah ${settledQty} pcs — sebagian sudah disettle ke partner. ` +
      `Retur fisik ke partner dulu lewat menu Titip Masuk kalau memang barangnya berkurang.`,
    );
  }

  const unsettledIds = rows.filter(r => r.status === 'unsettled').map(r => r.id);
  if (unsettledIds.length > 0) {
    await pgTx`update consignment_in_ledger set status = 'voided' where id in ${pgTx(unsettledIds)}`;
  }

  const remainingQty = newQty - settledQty;
  if (remainingQty > 0) {
    await writeConsignmentInLedgerEntryPg(pgTx, {
      orderId, productId: product.id, productName: product.name,
      consignorId: product.consignorId, consignorName: product.consignorName ?? '',
      qty: remainingQty, payoutAmount: computeConsignmentPayout(product, remainingQty, unitPrice),
    });
  }
}
