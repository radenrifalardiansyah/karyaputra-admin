#!/usr/bin/env node
// One-time: hapus seluruh data menu Mitra (consignment) — lokasi mitra, stok titip,
// riwayat kirim, dan rekap. Dijalankan sekali lewat DIRECT_URL dalam satu transaksi.
// Usage: node scripts/clear-consignment-data.mjs
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

// Urutan hapus mengikuti FK: shipments/recaps/stock mereferensikan consignment_locations.
const TABLES_IN_ORDER = [
  'consignment_shipments',
  'consignment_recaps',
  'consignment_stock',
  'consignment_locations',
];

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

  await sql.begin(async (tx) => {
    console.log('-- Hapus data menu Mitra (consignment) --');
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
