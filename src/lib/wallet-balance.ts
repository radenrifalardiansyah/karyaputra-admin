import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';

// ISql: interface bersama Sql (koneksi pool) & TransactionSql (di dalam sql.begin(...)) — dipakai
// supaya computeWalletBalance bisa menerima keduanya, tanpa butuh .begin()/.end() yang cuma ada
// di Sql penuh.
// `{}` cocok dengan default generik `ISql`/`Sql`/`TransactionSql` milik postgres.js —
// `Record<string, unknown>` bikin TransactionSql (dari sql.begin(...)) tidak lagi assignable ke tipe ini.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type PgClient = postgres.ISql<{}>;

// `capitalEntries`, `walletTransfers`, `income`, `expenses`, `orders`, `consignmentRecaps` &
// `materialPurchases` semuanya sudah di Postgres (Tahap 2-5, 12, 13 & 18b migrasi, lihat plan
// gleaming-wondering-quokka.md) — `db` (Firestore) di bawah dipertahankan di signature untuk
// kompatibilitas pemanggil lama, tapi tidak lagi dipakai untuk membaca apa pun di sini.

// Dipakai oleh DELETE satuan dan bulk-delete dompet — dompet dengan riwayat transaksi (termasuk
// jadi asal/tujuan transfer) tidak boleh dihapus permanen, harus dinonaktifkan saja, supaya
// dokumen lama yang masih menyimpan walletId ini tidak jadi anak yatim.
export async function walletHasReferences(db: Firestore, walletId: string): Promise<boolean> {
  void db;
  const sql = getSql();
  const [row] = await sql<{ exists: boolean }[]>`
    select
      exists(select 1 from capital_entries where wallet_id = ${walletId})
      or exists(select 1 from wallet_transfers where from_wallet_id = ${walletId} or to_wallet_id = ${walletId})
      or exists(select 1 from income where wallet_id = ${walletId})
      or exists(select 1 from expenses where wallet_id = ${walletId})
      or exists(select 1 from orders where wallet_id = ${walletId})
      or exists(select 1 from consignment_recaps where wallet_id = ${walletId})
      or exists(select 1 from material_purchases where wallet_id = ${walletId})
      or exists(select 1 from consignment_in_settlements where wallet_id = ${walletId})
      as exists
  `;
  return Boolean(row.exists);
}

// Satu-satunya tempat menghitung saldo dompet di server — dipakai untuk validasi Transfer
// Antar Dompet (supaya tidak bisa transfer melebihi saldo yang benar-benar ada).
//
// `pgTx`: bila diberikan (dari `sql.begin(...)` di caller), seluruh query dijalankan di dalam
// transaksi Postgres itu alih-alih koneksi pool biasa — dipakai wallet-transfers route untuk
// mengunci baris (`pg_advisory_xact_lock`) supaya dua transfer keluar yang tiba bersamaan dari
// dompet yang sama tidak lolos validasi berdasarkan saldo yang sama (TOCTOU).
//
// `tx`/`db` (Firestore) dipertahankan di signature untuk kompatibilitas pemanggil lama, tapi
// sejak Tahap 13 tidak lagi dipakai untuk membaca apa pun di sini — semua sumber saldo
// (capital/transfer/income/expenses/orders/consignmentRecaps) sudah di Postgres.
export async function computeWalletBalance(
  db: Firestore,
  walletId: string,
  initialBalance: number,
  excludeTransferId?: string,
  tx?: Transaction,
  pgTx?: PgClient,
  // Dipakai saat mengedit sebuah entri Modal/Prive atau Pengeluaran — supaya kontribusi lama entri
  // itu sendiri dikeluarkan dulu dari total sebelum divalidasi ulang dengan nilai barunya (kalau
  // tidak, edit yang cuma mengubah catatan pun bisa keblokir oleh kontribusinya sendiri).
  excludeCapitalEntryId?: string,
  excludeExpenseId?: string,
): Promise<number> {
  void tx;
  const sql = pgTx ?? getSql();
  const [pgTotals] = await sql<{ total_modal: string; total_prive: string; total_in: string; total_out: string; total_income: string; total_expenses: string; total_orders: string; total_recaps: string }[]>`
    select
      coalesce((select sum(amount) from capital_entries where wallet_id = ${walletId} and type = 'modal'), 0) as total_modal,
      coalesce((select sum(amount) from capital_entries where wallet_id = ${walletId} and type = 'prive' and id != ${excludeCapitalEntryId ?? ''}), 0) as total_prive,
      coalesce((select sum(amount) from wallet_transfers where to_wallet_id = ${walletId} and id != ${excludeTransferId ?? ''}), 0) as total_in,
      coalesce((select sum(amount) from wallet_transfers where from_wallet_id = ${walletId} and id != ${excludeTransferId ?? ''}), 0) as total_out,
      coalesce((select sum(amount) from income where wallet_id = ${walletId}), 0) as total_income,
      coalesce((select sum(amount) from expenses where wallet_id = ${walletId} and id != ${excludeExpenseId ?? ''}), 0) as total_expenses,
      coalesce((select sum(total) from orders where wallet_id = ${walletId} and status != 'baru' and payment_status != 'belum_lunas' and status != 'dibatalkan'), 0) as total_orders,
      coalesce((select sum(total_revenue) from consignment_recaps where wallet_id = ${walletId} and payment_status != 'belum_lunas'), 0) as total_recaps
  `;

  const totalIncome = Number(pgTotals.total_income) || 0;
  const totalExpenses = Number(pgTotals.total_expenses) || 0;
  const totalModal = Number(pgTotals.total_modal) || 0;
  const totalPrive = Number(pgTotals.total_prive) || 0;
  const totalOrders = Number(pgTotals.total_orders) || 0;
  const totalRecaps = Number(pgTotals.total_recaps) || 0;
  const totalTransfersIn = Number(pgTotals.total_in) || 0;
  const totalTransfersOut = Number(pgTotals.total_out) || 0;

  return initialBalance + totalIncome + totalOrders + totalRecaps + totalModal + totalTransfersIn
    - totalExpenses - totalPrive - totalTransfersOut;
}
