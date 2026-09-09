import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToSupplier, nextSupplierCode, type SupplierRow } from '@/lib/suppliers-pg';

const getCachedSuppliers = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<SupplierRow[]>`select * from suppliers order by created_at asc`;

    // Backfill kode utk baris lama (mis. hasil impor Firestore) yang belum punya `code`.
    let maxCode = 0;
    for (const r of rows) {
      const m = /^SUP(\d+)$/i.exec((r.code ?? '').trim());
      if (m) maxCode = Math.max(maxCode, parseInt(m[1], 10));
    }
    const missing = rows.filter(r => !(r.code ?? '').trim());
    for (const r of missing) {
      maxCode += 1;
      r.code = `SUP${String(maxCode).padStart(3, '0')}`;
      await sql`update suppliers set code = ${r.code} where id = ${r.id}`;
    }

    return rows.map(rowToSupplier);
  },
  ['admin-suppliers'],
  { revalidate: 20, tags: ['admin-suppliers'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'suppliers', 'view');
  if (guard instanceof Response) return guard;
  const suppliers = await getCachedSuppliers();
  return Response.json({ suppliers });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'suppliers', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const sql = getSql();
  const existingRows = await sql<{ code: string | null }[]>`select code from suppliers`;
  const code = nextSupplierCode(existingRows.map(r => r.code ?? '').filter(Boolean));
  const id = randomUUID();
  await sql`
    insert into suppliers (id, code, name, phone, address, note, created_at, updated_at)
    values (${id}, ${code}, ${data.name as string}, ${(data.phone as string) ?? ''}, ${(data.address as string) ?? ''}, ${(data.note as string) ?? ''}, now(), now())
  `;
  revalidateTag('admin-suppliers', { expire: 0 });
  return Response.json({ id, code });
}
