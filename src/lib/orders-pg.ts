import type postgres from 'postgres';
import { parseJsonb } from '@/lib/db';

// Versi Postgres dari dokumen `orders` (Tahap 12 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md). Shape JSON yang dikembalikan ke frontend dipertahankan sama
// persis seperti dokumen Firestore lama (camelCase, createdAt/updatedAt sebagai
// {seconds,nanoseconds}) supaya UI tidak perlu berubah — pola sama seperti toTransfer() di
// wallet-transfers/route.ts.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgTx = postgres.ISql<{}>;

export interface OrderRow {
  id: string;
  invoice_no: string | null;
  date: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_id: string | null;
  items: unknown;
  subtotal: string;
  discount: unknown;
  total: string;
  pdf_url: string | null;
  status: string;
  source: string;
  delivery_method: string | null;
  address: string | null;
  note: string | null;
  payment_method: string | null;
  payment_status: string;
  amount_paid: string | null;
  change_amount: string | null;
  transfer_bank: string | null;
  transfer_amount: string | null;
  transfer_proof_url: string | null;
  stock_cut: boolean;
  stock_restored: boolean;
  warehouse_id: string | null;
  warehouse_name: string | null;
  wallet_id: string | null;
  shift_id: string | null;
  created_at: Date;
  updated_at: Date | null;
}

export function toTimestamp(d: Date | null | undefined) {
  if (!d) return null;
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
}

export function rowToOrder(r: OrderRow) {
  return {
    id: r.id,
    invoiceNo: r.invoice_no ?? '',
    date: r.date ?? '',
    customerName: r.customer_name,
    customerPhone: r.customer_phone ?? '',
    customerId: r.customer_id ?? undefined,
    items: parseJsonb(r.items) ?? [],
    subtotal: Number(r.subtotal),
    discount: parseJsonb(r.discount),
    total: Number(r.total),
    pdfUrl: r.pdf_url ?? undefined,
    status: r.status,
    source: r.source,
    deliveryMethod: r.delivery_method ?? undefined,
    address: r.address ?? undefined,
    note: r.note ?? undefined,
    paymentMethod: r.payment_method ?? undefined,
    paymentStatus: r.payment_status,
    amountPaid: r.amount_paid != null ? Number(r.amount_paid) : undefined,
    changeAmount: r.change_amount != null ? Number(r.change_amount) : undefined,
    transferBank: r.transfer_bank ?? undefined,
    transferAmount: r.transfer_amount != null ? Number(r.transfer_amount) : undefined,
    transferProofUrl: r.transfer_proof_url ?? undefined,
    stockCut: r.stock_cut,
    stockRestored: r.stock_restored,
    warehouseId: r.warehouse_id ?? undefined,
    warehouseName: r.warehouse_name ?? undefined,
    walletId: r.wallet_id,
    shiftId: r.shift_id ?? undefined,
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}

// invoiceNo dibuat di klien dengan resolusi menit, tanpa detik/counter — dua transaksi kasir
// yang selesai dalam menit yang sama bisa kirim invoiceNo identik. Kalau bentrok, tambahkan
// sufiks alih-alih menolak (checkout yang sudah selesai tidak boleh gagal karena ini) — sama
// seperti pengecekan yang dulu jalan di dalam db.runTransaction Firestore.
export async function resolveUniqueInvoiceNo(pgTx: PgTx, invoiceNo: string | undefined): Promise<string | undefined> {
  if (!invoiceNo) return invoiceNo;
  // Advisory lock supaya dua checkout dengan invoiceNo dasar yang sama (klien generate per-menit,
  // tanpa detik/counter) tidak bisa lolos cek-SELECT-lalu-INSERT bersamaan (race) dan berakhir jadi
  // invoice_no duplikat — dipegang sampai transaksi ini commit/rollback (xact-scoped), jadi
  // checkout kedua otomatis menunggu lalu melihat baris yang baru saja di-insert checkout pertama.
  await pgTx`select pg_advisory_xact_lock(hashtext(${invoiceNo}))`;
  let candidate = invoiceNo;
  for (let suffix = 2; suffix <= 20; suffix++) {
    const [dupe] = await pgTx<{ id: string }[]>`select id from orders where invoice_no = ${candidate} limit 1`;
    if (!dupe) break;
    candidate = `${invoiceNo}-${suffix}`;
  }
  return candidate;
}
