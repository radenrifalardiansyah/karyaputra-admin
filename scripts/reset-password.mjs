#!/usr/bin/env node
// Reset password Supabase Auth untuk username yang SUDAH ADA di tabel profiles.
// Tidak menyentuh role/profil sama sekali — beda dari bootstrap-superadmin.mjs yang
// juga memaksa role='super-admin' (makanya tidak aman dipakai untuk akun non-superadmin).
//
// Usage: node scripts/reset-password.mjs <username> <password>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^"(.*)"$/, '$1');
  }
}

async function findUserByEmail(supabase, email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) ?? null;
}

async function main() {
  loadEnvLocal();
  const [, , usernameArg, password] = process.argv;
  if (!usernameArg || !password) {
    console.error('Usage: node scripts/reset-password.mjs <username> <password>');
    process.exit(1);
  }

  const username = usernameArg.trim().toLowerCase();
  const loginEmail = `${username}@karyaputra.local`;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL, { prepare: false, max: 1 });

  try {
    const [profile] = await sql`select username, role from profiles where username = ${username}`;
    if (!profile) throw new Error(`Username "${username}" tidak ditemukan di tabel profiles — tidak melakukan apa-apa.`);

    const authUser = await findUserByEmail(supabase, loginEmail);
    if (!authUser) throw new Error(`Akun Supabase Auth "${loginEmail}" tidak ditemukan — tidak melakukan apa-apa.`);

    const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password });
    if (error) throw new Error(`Gagal update password: ${error.message}`);

    console.log(`Password untuk "${username}" (role=${profile.role}) berhasil direset.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
