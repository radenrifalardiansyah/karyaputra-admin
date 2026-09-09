import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';

// Dipanggil saat user klik "Keluar" (lihat AppShell.tsx handleLogout). Tanpa ini, presence
// tetap "hidup" sampai window last_seen (lihat lib/chat.ts) habis, jadi login ulang di
// browser yang sama dalam waktu dekat malah dikira "sudah aktif di perangkat lain" oleh
// /api/login (lihat komentar di sana) dan diarahkan ke layar persetujuan yang seharusnya
// tidak perlu.
export async function POST(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return Response.json({ ok: true });

  const sql = getSql();
  await sql`delete from presence where username = ${authUser.username}`;
  return Response.json({ ok: true });
}
