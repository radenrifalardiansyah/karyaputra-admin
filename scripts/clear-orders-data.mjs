#!/usr/bin/env node
// One-time: hapus seluruh data menu Pesanan (orders). Tidak ada tabel anak
// dan tidak ada tabel lain yang mereferensikan orders lewat FK (lihat
// scripts/fk-candidates.mjs), jadi cukup satu DELETE dalam satu transaksi.
// Usage: node scripts/clear-orders-data.mjs
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

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

  await sql.begin(async (tx) => {
    console.log('-- Hapus data menu Pesanan (orders) --');
    const result = await tx.unsafe('delete from orders');
    console.log(`orders: ${result.count} baris dihapus`);
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
