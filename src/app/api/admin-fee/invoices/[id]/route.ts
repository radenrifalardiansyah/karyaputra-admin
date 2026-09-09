import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requireSuperAdmin, requireAdminOrSuperAdmin } from '@/lib/rbac';
import { serializeInvoiceRow, type AdminFeeInvoiceRow } from '@/lib/admin-fee';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const sql = getSql();
  const [row] = await sql<AdminFeeInvoiceRow[]>`select * from admin_fee_invoices where id = ${id}`;
  if (!row) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  const invoice = serializeInvoiceRow(row);
  // Draft belum "ditagihkan" & invoice yang dibatalkan bukan lagi tagihan aktif —
  // jangan bocorkan ke `admin` walau tahu ID-nya.
  if (guard.role !== 'super-admin' && (invoice.status === 'draft' || invoice.status === 'cancelled')) {
    return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  }
  return Response.json({ invoice });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const data = await req.json() as { status?: 'draft' | 'invoiced' | 'paid' | 'cancelled' };
  if (!data.status || !['draft', 'invoiced', 'paid', 'cancelled'].includes(data.status)) {
    return Response.json({ error: 'Status tidak valid.' }, { status: 400 });
  }

  const sql = getSql();
  if (data.status === 'cancelled') {
    const [row] = await sql<{ status: string }[]>`select status from admin_fee_invoices where id = ${id}`;
    if (!row) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
    // Invoice yang sudah lunas tidak boleh dibatalkan begitu saja — uangnya sudah diterima,
    // koreksi seharusnya lewat pembukuan/refund, bukan menghapus jejak tagihan yang sudah dibayar.
    if (row.status === 'paid') {
      return Response.json({ error: 'Invoice yang sudah lunas tidak bisa dibatalkan.' }, { status: 400 });
    }
  }

  // Superadmin bisa langsung menandai lunas manual (mis. bayar tunai/transfer langsung ke
  // RMedia di luar alur "Bayar" milik admin) — tetap dicatat siapa & kapan agar konsisten
  // dengan riwayat pembayaran yang dibuat lewat endpoint /pay.
  const result = await sql`
    update admin_fee_invoices set
      status = ${data.status},
      updated_at = now(),
      paid_at = case when ${data.status} = 'paid' then now() else paid_at end,
      paid_by = case when ${data.status} = 'paid' then ${guard.username} else paid_by end,
      cancelled_at = case when ${data.status} = 'cancelled' then now() else cancelled_at end,
      cancelled_by = case when ${data.status} = 'cancelled' then ${guard.username} else cancelled_by end
    where id = ${id}
  `;
  if (result.count === 0) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  revalidateTag('admin-fee-invoices', { expire: 0 });
  return Response.json({ ok: true });
}
