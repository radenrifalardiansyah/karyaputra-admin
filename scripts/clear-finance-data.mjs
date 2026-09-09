#!/usr/bin/env node
// One-time: hapus seluruh data modul Keuangan (dompet, mutasi, kas, dll).
// material_purchases.wallet_id/expense_id tidak punya FK ke wallets/expenses,
// jadi dikosongkan lebih dulu supaya tidak ada referensi menggantung.
// Urutan hapus mengikuti FK: wallets direferensikan oleh expenses/income/
// capital_entries/wallet_transfers, jadi wallets dihapus paling akhir.
// Usage: node scripts/clear-finance-data.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^"(.*)"$/, '$1');
  }
}

const TABLES_IN_ORDER = [
  'wallet_transfers',
  'capital_entries',
  'income',
  'expenses',
  'cashier_shifts',
  'pos_held_transactions',
  'admin_fee_invoices',
  'admin_fee_rates',
  'wallets',
];

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

  await sql.begin(async (tx) => {
    console.log('-- Kosongkan referensi non-FK di material_purchases --');
    const linkCleared = await tx`
      update material_purchases
      set wallet_id = null, expense_id = null
      where wallet_id is not null or expense_id is not null
    `;
    console.log(`material_purchases.wallet_id/expense_id -> NULL: ${linkCleared.count} baris`);

    console.log('\n-- Hapus data modul Keuangan --');
    for (const table of TABLES_IN_ORDER) {
      const result = await tx.unsafe(`delete from ${table}`);
      console.log(`${table}: ${result.count} baris dihapus`);
    }
  });

  console.log('\nSelesai. Semua perubahan di-commit dalam satu transaksi.');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\nGAGAL — transaksi di-rollback otomatis, tidak ada perubahan yang tersimpan.');
  console.error(err.message);
  process.exit(1);
});
