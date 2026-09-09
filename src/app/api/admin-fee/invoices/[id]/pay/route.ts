import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requireAdminOrSuperAdmin } from '@/lib/rbac';

// Aksi "Bayar" milik `admin` (pemilik usaha) atas invoice Biaya Admin yang sudah ditagihkan
// superadmin — pembayaran manual (transfer di luar sistem, lalu konfirmasi di sini), bukan
// payment gateway. Sengaja endpoint terpisah dari PATCH /invoices/[id] (yang bebas set status
// apapun tapi superadmin-only): endpoint ini cuma boleh transisi invoiced -> paid, jadi admin
// tidak bisa mengubah status ke draft atau mengarang ulang nominal tagihan.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { note?: string };

  const sql = getSql();
  const [row] = await sql<{ status: string }[]>`select status from admin_fee_invoices where id = ${id}`;
  if (!row) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  if (row.status !== 'invoiced') {
    return Response.json({ error: 'Invoice ini belum ditagihkan atau sudah dibayar.' }, { status: 400 });
  }

  await sql`
    update admin_fee_invoices set
      status = 'paid', paid_at = now(), paid_by = ${guard.username},
      payment_note = ${body.note?.trim() || null}, updated_at = now()
    where id = ${id}
  `;

  revalidateTag('admin-fee-invoices', { expire: 0 });
  return Response.json({ ok: true });
}
