#!/usr/bin/env node
// One-time: tambah kolom deskripsi bebas per opsi varian (ala Shopee — field "Tulis penjelasan"
// di layar Tambah Variasi). Additive/non-breaking: nullable, tidak mengubah data yang sudah ada.
//
// Usage: node scripts/add-product-variant-description-column.mjs
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

  await sql`alter table product_variants add column if not exists description text`;
  console.log('OK  column product_variants.description');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\nGAGAL.');
  console.error(err.message);
  process.exit(1);
});
