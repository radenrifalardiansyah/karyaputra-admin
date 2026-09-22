#!/usr/bin/env node
// One-time: skema untuk fitur "Varian Produk" (1 produk bisa punya beberapa varian rasa/ukuran,
// masing-masing dengan harga & stok sendiri sendiri — ala Shopee). Additive/non-breaking: produk
// existing tetap pakai products.price/cost_price/stock_qty seperti sekarang tanpa perubahan
// (products.has_variants default false, semua kolom variant_id baru nullable). Baru benar-benar
// dipakai setelah API/UI kelola varian (Fase 1) jalan.
//
// Usage: node scripts/create-product-variants-tables.mjs
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
    await tx`alter table products add column if not exists has_variants boolean not null default false`;
    await tx`alter table products add column if not exists variant_attributes jsonb not null default '[]'`;
    console.log('OK  columns products.has_variants/variant_attributes');

    await tx`
      create table if not exists product_variants (
        id text primary key,
        product_id text not null,
        options jsonb not null default '{}',
        sku text,
        price numeric not null default 0,
        cost_price numeric not null default 0,
        original_price numeric,
        stock_qty numeric not null default 0,
        min_stock numeric,
        image_url text,
        sort_order int not null default 0,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz
      )
    `;
    console.log('OK  table product_variants');

    await tx`create index if not exists product_variants_product_id_idx on product_variants (product_id)`;
    await tx`create unique index if not exists product_variants_sku_idx on product_variants (sku) where sku is not null`;
    console.log('OK  index product_variants_product_id_idx, product_variants_sku_idx');

    await tx`alter table warehouse_stock add column if not exists variant_id text`;
    await tx`alter table stock_ledger add column if not exists variant_id text`;
    await tx`alter table price_history add column if not exists variant_id text`;
    await tx`alter table consignment_stock add column if not exists variant_id text`;
    console.log('OK  columns variant_id di warehouse_stock/stock_ledger/price_history/consignment_stock (nullable)');

    const existing = await tx`
      select conname from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
    `;
    const existingNames = new Set(existing.map((r) => r.conname));

    // { name, table, column, refTable, refColumn, onDelete }
    // product_variants -> products: CASCADE (hapus produk = hapus definisi variannya; produk yang
    // masih punya riwayat stok/transaksi sudah diblokir hapusnya lebih dulu lewat FK RESTRICT
    // product_id existing di warehouse_stock/stock_ledger/consignment_stock, jadi cascade di sini aman).
    // Sisanya RESTRICT, sama pola dengan *_product_id_fkey existing: varian yang sudah punya
    // riwayat stok/harga tidak boleh dihapus keras, cukup di-nonaktifkan (is_active = false).
    const FKS = [
      { name: 'product_variants_product_id_fkey', table: 'product_variants', column: 'product_id', refTable: 'products', refColumn: 'id', onDelete: 'CASCADE' },
      { name: 'warehouse_stock_variant_id_fkey', table: 'warehouse_stock', column: 'variant_id', refTable: 'product_variants', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'stock_ledger_variant_id_fkey', table: 'stock_ledger', column: 'variant_id', refTable: 'product_variants', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'price_history_variant_id_fkey', table: 'price_history', column: 'variant_id', refTable: 'product_variants', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'consignment_stock_variant_id_fkey', table: 'consignment_stock', column: 'variant_id', refTable: 'product_variants', refColumn: 'id', onDelete: 'RESTRICT' },
    ];

    console.log('\n-- Tambah FK constraint --');
    for (const c of FKS) {
      if (existingNames.has(c.name)) {
        console.log(`SKIP  ${c.table}.${c.column} -> ${c.refTable}.${c.refColumn}  (constraint sudah ada)`);
        continue;
      }
      const ddl = `
        alter table ${c.table}
        add constraint ${c.name}
        foreign key (${c.column}) references ${c.refTable} (${c.refColumn})
        on delete ${c.onDelete}
      `;
      await tx.unsafe(ddl);
      console.log(`OK    ${c.table}.${c.column} -> ${c.refTable}.${c.refColumn}  (ON DELETE ${c.onDelete})`);
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
