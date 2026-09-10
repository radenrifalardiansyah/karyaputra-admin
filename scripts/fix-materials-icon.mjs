#!/usr/bin/env node
// One-time: ganti icon menu "Bahan Baku" (feature_key materials) dari 'Boxes' ke 'Archive'
// supaya beda dengan icon menu "Titip Masuk" (feature_key consignment-in) yang juga 'Boxes'.
// Usage: node scripts/fix-materials-icon.mjs
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

  const [row] = await sql`select id, icon from menus where feature_key = 'materials'`;
  if (!row) {
    console.log('SKIP  menu materials tidak ditemukan.');
  } else if (row.icon === 'Archive') {
    console.log('SKIP  menu materials sudah pakai icon Archive.');
  } else {
    await sql`update menus set icon = 'Archive', updated_at = now() where feature_key = 'materials'`;
    console.log(`OK    menu materials: icon diganti dari '${row.icon}' -> 'Archive'.`);
  }

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
