import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'suppliers', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();

  // Sama seperti DELETE satuan — lewati id yang masih punya riwayat pembelian bahan baku.
  const linkedRows = await sql<{ supplier_id: string }[]>`
    select distinct supplier_id from material_purchases where supplier_id in ${sql(ids)}
  `;
  const linkedToPurchase = new Set(linkedRows.map(r => r.supplier_id));
  const deletable = ids.filter(id => !linkedToPurchase.has(id));
  const skippedInUse = ids.length - deletable.length;

  if (deletable.length > 0) {
    await sql`delete from suppliers where id in ${sql(deletable)}`;
    revalidateTag('admin-suppliers', { expire: 0 });
  }
  return Response.json({ deleted: deletable.length, skippedInUse });
}
