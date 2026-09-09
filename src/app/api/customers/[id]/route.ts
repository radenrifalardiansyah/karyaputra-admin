import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToCustomer, type CustomerRow } from '@/lib/customers-pg';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'customers', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [row] = await sql<CustomerRow[]>`select * from customers where id = ${id}`;
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(rowToCustomer(row));
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'customers', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const { name, phone, code, type, email, address, city, notes } =
    await req.json() as {
      name: string; phone: string; code?: string; type?: 'personal' | 'company';
      email?: string; address?: string; city?: string; notes?: string;
    };

  const phoneTrim = phone?.trim() ?? '';
  const codeTrim  = code?.trim() ?? '';

  if (!name?.trim()) {
    return Response.json({ error: 'Nama wajib diisi.' }, { status: 400 });
  }

  const sql = getSql();
  const [phoneDup, codeDup] = await Promise.all([
    phoneTrim ? sql<{ id: string }[]>`select id from customers where phone = ${phoneTrim} and id != ${id} limit 1` : Promise.resolve([]),
    codeTrim ? sql<{ id: string }[]>`select id from customers where code = ${codeTrim} and id != ${id} limit 1` : Promise.resolve([]),
  ]);
  if (phoneDup.length > 0) {
    return Response.json({ error: `No. HP "${phoneTrim}" sudah digunakan pelanggan lain.` }, { status: 409 });
  }
  if (codeDup.length > 0) {
    return Response.json({ error: `Kode "${codeTrim}" sudah digunakan pelanggan lain.` }, { status: 409 });
  }

  await sql`
    update customers set
      name = ${name.trim()}, phone = ${phoneTrim}, code = ${codeTrim},
      type = ${type === 'company' ? 'company' : 'personal'},
      email = ${email?.trim() ?? ''}, address = ${address?.trim() ?? ''}, city = ${city?.trim() ?? ''},
      notes = ${notes?.trim() ?? ''}, updated_at = now()
    where id = ${id}
  `;
  revalidateTag('admin-customers', { expire: 0 });
  revalidateTag('admin-resellers', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'customers', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();

  // Tolak kalau pelanggan ini masih terhubung ke akun reseller — kalau dibolehkan,
  // resellers.customer_id jadi menunjuk ke baris yang sudah tidak ada.
  const [{ exists }] = await sql<{ exists: boolean }[]>`select exists(select 1 from resellers where customer_id = ${id}) as exists`;
  if (exists) {
    return Response.json(
      { error: 'Pelanggan ini masih terhubung ke akun reseller — lepaskan tautannya dulu sebelum menghapus.' },
      { status: 400 },
    );
  }

  await sql`delete from customers where id = ${id}`;
  revalidateTag('admin-customers', { expire: 0 });
  return Response.json({ ok: true });
}
