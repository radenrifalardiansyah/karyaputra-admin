#!/usr/bin/env node
// One-time: hapus seluruh data modul Operasional (bahan baku, supplier, gudang,
// produksi, pembelian bahan, mutasi & penyesuaian stok) — termasuk master data.
// Urutan hapus mengikuti FK: anak (adjustments/ledger/stock/batches/purchases)
// sebelum induk (raw_materials/suppliers/warehouses).
// Usage: node scripts/clear-operasional-data.mjs
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
  'material_adjustments',
  'stock_ledger',
  'warehouse_stock',
  'production_batches',
  'material_purchases',
  'raw_materials',
  'suppliers',
  'warehouses',
];

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

  await sql.begin(async (tx) => {
    console.log('-- Hapus data modul Operasional --');
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
