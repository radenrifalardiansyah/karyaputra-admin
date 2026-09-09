import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { nextSupplierCode } from '@/lib/suppliers-pg';

interface ImportRow { name: string; phone?: string; address?: string; note?: string }

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'suppliers', 'create');
  if (guard instanceof Response) return guard;
  const { suppliers } = await req.json() as { suppliers: ImportRow[] };
  if (!Array.isArray(suppliers) || suppliers.length === 0) {
    return Response.json({ error: 'Tidak ada data supplier untuk diimpor.' }, { status: 400 });
  }

  const sql = getSql();
  const existingRows = await sql<{ phone: string; code: string | null }[]>`select phone, code from suppliers`;
  const existingPhones = new Set(existingRows.map(r => (r.phone ?? '').trim()).filter(Boolean));
  const seenPhones = new Set<string>();
  const codePool = existingRows.map(r => r.code ?? '').filter(Boolean);

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;

  for (const row of suppliers) {
    const name  = (row.name  ?? '').toString().trim();
    const phone = (row.phone ?? '').toString().trim();
    if (!name) { skippedInvalid++; continue; }
    if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) { skippedDuplicate++; continue; }

    if (phone) seenPhones.add(phone);
    const code = nextSupplierCode(codePool);
    codePool.push(code);
    try {
      await sql`
        insert into suppliers (id, code, name, phone, address, note, created_at, updated_at)
        values (${randomUUID()}, ${code}, ${name}, ${phone}, ${(row.address ?? '').toString().trim()}, ${(row.note ?? '').toString().trim()}, now(), now())
      `;
      created++;
    } catch (err) {
      console.error('Bulk import supplier: gagal menyimpan baris', name, err);
      skippedInvalid++;
    }
  }

  if (created > 0) revalidateTag('admin-suppliers', { expire: 0 });
  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
