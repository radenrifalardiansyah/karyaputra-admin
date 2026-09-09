import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

interface ImportRow {
  name: string; phone: string; code?: string; type?: 'personal' | 'company';
  email?: string; address?: string; city?: string; notes?: string;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'customers', 'create');
  if (guard instanceof Response) return guard;
  const { customers } = await req.json() as { customers: ImportRow[] };
  if (!Array.isArray(customers) || customers.length === 0) {
    return Response.json({ error: 'Tidak ada data pelanggan untuk diimpor.' }, { status: 400 });
  }

  const sql = getSql();
  const existingRows = await sql<{ phone: string; code: string | null }[]>`select phone, code from customers`;
  const existingPhones = new Set(existingRows.map(r => (r.phone ?? '').trim()).filter(Boolean));
  const existingCodes = new Set(existingRows.map(r => (r.code ?? '').trim()).filter(Boolean));
  const seenPhones = new Set<string>();
  const seenCodes  = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;

  for (const row of customers) {
    const name  = (row.name  ?? '').toString().trim();
    const phone = (row.phone ?? '').toString().trim();
    const code  = (row.code  ?? '').toString().trim();
    if (!name) { skippedInvalid++; continue; }
    if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) { skippedDuplicate++; continue; }
    if (code && (existingCodes.has(code) || seenCodes.has(code))) { skippedDuplicate++; continue; }

    seenPhones.add(phone);
    if (code) seenCodes.add(code);
    try {
      await sql`
        insert into customers (id, name, phone, code, type, email, address, city, notes, created_at, updated_at)
        values (
          ${randomUUID()}, ${name}, ${phone}, ${code}, ${row.type === 'company' ? 'company' : 'personal'},
          ${(row.email ?? '').toString().trim()}, ${(row.address ?? '').toString().trim()},
          ${(row.city ?? '').toString().trim()}, ${(row.notes ?? '').toString().trim()}, now(), now()
        )
      `;
      created++;
    } catch (err) {
      console.error('Bulk import pelanggan: gagal menyimpan baris', name, err);
      skippedInvalid++;
    }
  }

  if (created > 0) revalidateTag('admin-customers', { expire: 0 });
  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
