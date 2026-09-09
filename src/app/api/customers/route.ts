import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToCustomer, type CustomerRow } from '@/lib/customers-pg';

const getCachedCustomers = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<CustomerRow[]>`select * from customers order by created_at desc`;
    return rows.map(rowToCustomer);
  },
  ['admin-customers'],
  { revalidate: 15, tags: ['admin-customers'] }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'customers', 'view');
  if (guard instanceof Response) return guard;
  const customers = await getCachedCustomers();
  return Response.json({ customers });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'customers', 'create');
  if (guard instanceof Response) return guard;
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
    phoneTrim ? sql<{ id: string }[]>`select id from customers where phone = ${phoneTrim} limit 1` : Promise.resolve([]),
    codeTrim ? sql<{ id: string }[]>`select id from customers where code = ${codeTrim} limit 1` : Promise.resolve([]),
  ]);
  if (phoneDup.length > 0) {
    return Response.json({ error: `No. HP "${phoneTrim}" sudah digunakan pelanggan lain.` }, { status: 409 });
  }
  if (codeDup.length > 0) {
    return Response.json({ error: `Kode "${codeTrim}" sudah digunakan pelanggan lain.` }, { status: 409 });
  }

  const id = randomUUID();
  await sql`
    insert into customers (id, name, phone, code, type, email, address, city, notes, created_at, updated_at)
    values (
      ${id}, ${name.trim()}, ${phoneTrim}, ${codeTrim}, ${type === 'company' ? 'company' : 'personal'},
      ${email?.trim() ?? ''}, ${address?.trim() ?? ''}, ${city?.trim() ?? ''}, ${notes?.trim() ?? ''}, now(), now()
    )
  `;
  revalidateTag('admin-customers', { expire: 0 });
  return Response.json({ id });
}
