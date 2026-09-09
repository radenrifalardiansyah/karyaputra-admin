#!/usr/bin/env node
// One-time bootstrap untuk akun pertama pasca migrasi Tahap 7 (Supabase Auth + Postgres).
// scripts/seed-admin.mjs lama nulis ke Firestore — sudah tidak dibaca sama sekali oleh
// /api/login (lihat src/app/api/login/route.ts), makanya superadmin gagal login: akunnya
// memang belum pernah dibuat di Supabase Auth / tabel profiles.
//
// Script ini meniru persis apa yang dilakukan POST /api/users (src/app/api/users/route.ts),
// tapi tanpa syarat sudah login — dipakai HANYA untuk bikin/reset akun super-admin pertama.
//
// Usage: node scripts/bootstrap-superadmin.mjs <username> <password> [email]
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
  // supabase-js admin API tidak punya getUserByEmail langsung — jumlah akun admin di panel ini
  // kecil (segelintir), jadi cukup halaman sekali dengan perPage besar alih-alih paginasi penuh.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) ?? null;
}

async function main() {
  loadEnvLocal();
  const [, , usernameArg, password, emailArg] = process.argv;
  if (!usernameArg || !password) {
    console.error('Usage: node scripts/bootstrap-superadmin.mjs <username> <password> [email]');
    process.exit(1);
  }

  const username = usernameArg.trim().toLowerCase();
  const loginEmail = `${username}@karyaputra.local`;
  const profileEmail = emailArg ? emailArg.trim().toLowerCase() : null;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL, { prepare: false, max: 1 });

  try {
    let authUser = await findUserByEmail(supabase, loginEmail);

    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: loginEmail,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`Gagal membuat akun Supabase Auth: ${error?.message ?? 'unknown_error'}`);
      authUser = data.user;
      console.log(`Akun Supabase Auth "${loginEmail}" dibuat (id=${authUser.id}).`);
    } else {
      const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password });
      if (error) throw new Error(`Gagal update password: ${error.message}`);
      console.log(`Akun Supabase Auth "${loginEmail}" sudah ada (id=${authUser.id}) — password direset.`);
    }

    await sql`
      insert into roles (id, name, description, is_system, created_at, updated_at)
      values ('super-admin', 'Super Admin', 'Akses penuh ke seluruh fitur.', true, now(), now())
      on conflict (id) do nothing
    `;

    const [existingProfile] = await sql`select id, username from profiles where id = ${authUser.id} or username = ${username}`;
    if (existingProfile) {
      await sql`
        update profiles
        set id = ${authUser.id}, username = ${username}, role = 'super-admin', must_change_password = false
        where username = ${existingProfile.username}
      `;
      console.log(`Baris profiles untuk "${username}" diperbarui (role=super-admin).`);
    } else {
      await sql`
        insert into profiles (id, username, email, role, must_change_password, created_at)
        values (${authUser.id}, ${username}, ${profileEmail}, 'super-admin', false, now())
      `;
      console.log(`Baris profiles untuk "${username}" dibuat (role=super-admin).`);
    }

    console.log(`\nSelesai. Login dengan username="${username}" dan password yang baru saja diset.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('\nGAGAL:', err.message);
  process.exit(1);
});
