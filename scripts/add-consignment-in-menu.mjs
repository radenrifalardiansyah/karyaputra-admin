#!/usr/bin/env node
// One-time: daftarkan menu sidebar "Titip Masuk" (featureKey consignment-in) di modul yang sama
// dengan "Mitra" (consignment) — menu di aplikasi ini digerakkan dari tabel modules/menus
// (Struktur Menu), bukan array hardcode, jadi featureKey baru tidak otomatis muncul di sidebar
// sampai barisnya ada di sini.
// Usage: node scripts/add-consignment-in-menu.mjs
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

  const [existing] = await sql`select id from menus where feature_key = 'consignment-in'`;
  if (existing) {
    console.log('SKIP  menu consignment-in sudah ada, tidak ada perubahan.');
  } else {
    await sql`
      insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
      values ('consignment-in', 'manajemen', null, 'consignment-in', 'Titip Masuk', 'Boxes', 5, true, now(), now())
    `;
    console.log('OK    menu consignment-in ditambahkan ke modul manajemen (label "Titip Masuk").');
  }

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
