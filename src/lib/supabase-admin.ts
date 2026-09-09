import { createClient } from '@supabase/supabase-js';

// Supabase Auth (Tahap 7 migrasi, lihat plan gleaming-wondering-quokka.md) — dipakai HANYA untuk
// verifikasi username+password saat login dan operasi admin (buat/ubah password/hapus akun).
// Sesi/token yang dipakai app ini tetap JWT sendiri (jsonwebtoken, header x-admin-auth) seperti
// sebelumnya — Supabase Auth di sini murni "gudang password teraman", bukan pengganti mekanisme
// sesi yang sudah berjalan (requirePermission, sessionsInvalidatedAt, dst di src/lib/rbac.ts
// tetap sama persis, cuma sumber datanya pindah dari Firestore ke Postgres).
let client: ReturnType<typeof createClient> | undefined;

export function getSupabaseAdmin() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

// Supabase Auth's email/password provider requires an email-shaped identifier — admin panel
// hanya login pakai username, jadi ini menurunkan alamat yang stabil & deterministik per username.
export function deriveLoginEmail(username: string): string {
  return `${username}@karyaputra.local`;
}
