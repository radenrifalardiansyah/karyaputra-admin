#!/usr/bin/env node
// One-time: skema untuk fitur "Titip Masuk" (konsinyasi MASUK — partner luar menitipkan barang
// ke toko kita, kebalikan dari fitur "Mitra"/consignment existing yang arahnya toko kita menitip
// ke lokasi lain). Lihat plan snug-sparking-ocean.md.
//
// Barang titipan tetap jadi row `products` biasa (kena stok/warehouse_stock/stock_ledger existing
// di stock-pg.ts tanpa perubahan) — kolom baru di `products` hanya menandai kepemilikan +
// aturan settlement-nya. `consignment_in_ledger` mendenormalisasi payout per baris penjualan
// (ditulis dari orders/route.ts) supaya "berapa yang belum dibayar ke partner X" bisa dihitung
// tanpa query jsonb `orders.items`, sama alasan `stock_ledger` mendenormalisasi dari transaksi lain.
//
// Usage: node scripts/create-consignment-in-tables.mjs
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
    await tx`
      create table if not exists consignment_in_partners (
        id text primary key,
        name text not null default '',
        code text,
        contact_name text default '',
        contact_phone text default '',
        address text default '',
        note text default '',
        default_settlement_type text not null default 'fixed',
        default_payout_price numeric,
        default_commission_pct numeric,
        created_at timestamptz not null default now(),
        updated_at timestamptz
      )
    `;
    console.log('OK  table consignment_in_partners');

    await tx`alter table products add column if not exists owner_type text not null default 'own'`;
    await tx`alter table products add column if not exists consignor_id text`;
    await tx`alter table products add column if not exists settlement_type text`;
    await tx`alter table products add column if not exists payout_price numeric`;
    await tx`alter table products add column if not exists commission_pct numeric`;
    console.log('OK  columns products.owner_type/consignor_id/settlement_type/payout_price/commission_pct');

    await tx`create index if not exists products_consignor_id_idx on products (consignor_id)`;
    console.log('OK  index products_consignor_id_idx');

    await tx`
      create table if not exists consignment_in_shipments (
        id text primary key,
        partner_id text not null,
        partner_name text default '',
        warehouse_id text,
        warehouse_name text default '',
        direction text not null,
        items jsonb not null default '[]',
        note text default '',
        created_at timestamptz not null default now()
      )
    `;
    console.log('OK  table consignment_in_shipments');
    await tx`create index if not exists consignment_in_shipments_partner_idx on consignment_in_shipments (partner_id)`;

    await tx`
      create table if not exists consignment_in_settlements (
        id text primary key,
        partner_id text not null,
        partner_name text default '',
        items jsonb not null default '[]',
        total_payable numeric not null default 0,
        wallet_id text,
        note text default '',
        expense_id text,
        created_at timestamptz not null default now()
      )
    `;
    console.log('OK  table consignment_in_settlements');
    await tx`create index if not exists consignment_in_settlements_partner_idx on consignment_in_settlements (partner_id)`;

    await tx`
      create table if not exists consignment_in_ledger (
        id text primary key,
        order_id text,
        product_id text not null,
        product_name text default '',
        consignor_id text not null,
        consignor_name text default '',
        qty numeric not null default 0,
        payout_amount numeric not null default 0,
        status text not null default 'unsettled',
        settlement_id text,
        created_at timestamptz not null default now(),
        settled_at timestamptz
      )
    `;
    console.log('OK  table consignment_in_ledger');
    await tx`create index if not exists consignment_in_ledger_consignor_status_idx on consignment_in_ledger (consignor_id, status)`;
    await tx`create index if not exists consignment_in_ledger_order_idx on consignment_in_ledger (order_id)`;

    const existing = await tx`
      select conname from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
    `;
    const existingNames = new Set(existing.map((r) => r.conname));

    // { name, table, column, refTable, refColumn, onDelete }
    const FKS = [
      { name: 'products_consignor_id_fkey', table: 'products', column: 'consignor_id', refTable: 'consignment_in_partners', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'consignment_in_shipments_partner_id_fkey', table: 'consignment_in_shipments', column: 'partner_id', refTable: 'consignment_in_partners', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'consignment_in_shipments_warehouse_id_fkey', table: 'consignment_in_shipments', column: 'warehouse_id', refTable: 'warehouses', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'consignment_in_settlements_partner_id_fkey', table: 'consignment_in_settlements', column: 'partner_id', refTable: 'consignment_in_partners', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'consignment_in_settlements_wallet_id_fkey', table: 'consignment_in_settlements', column: 'wallet_id', refTable: 'wallets', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'consignment_in_settlements_expense_id_fkey', table: 'consignment_in_settlements', column: 'expense_id', refTable: 'expenses', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'consignment_in_ledger_product_id_fkey', table: 'consignment_in_ledger', column: 'product_id', refTable: 'products', refColumn: 'id', onDelete: 'RESTRICT' },
      { name: 'consignment_in_ledger_consignor_id_fkey', table: 'consignment_in_ledger', column: 'consignor_id', refTable: 'consignment_in_partners', refColumn: 'id', onDelete: 'RESTRICT' },
      // order_id/settlement_id: SET NULL, bukan RESTRICT — order boleh dihapus keras (lihat DELETE
      // /api/orders/[id]) dan baris ledger (jejak keuangan payout ke partner) tetap harus bertahan
      // sebagai riwayat meski order sumbernya sudah tidak ada, sama alasan price_history.product_id.
      { name: 'consignment_in_ledger_order_id_fkey', table: 'consignment_in_ledger', column: 'order_id', refTable: 'orders', refColumn: 'id', onDelete: 'SET NULL' },
      { name: 'consignment_in_ledger_settlement_id_fkey', table: 'consignment_in_ledger', column: 'settlement_id', refTable: 'consignment_in_settlements', refColumn: 'id', onDelete: 'SET NULL' },
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
