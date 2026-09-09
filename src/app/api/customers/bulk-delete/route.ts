import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'customers', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();

  // Sama seperti DELETE satuan — lewati id yang masih terhubung ke akun reseller.
  const linkedRows = await sql<{ customer_id: string }[]>`
    select distinct customer_id from resellers where customer_id in ${sql(ids)}
  `;
  const linkedToReseller = new Set(linkedRows.map(r => r.customer_id));
  const deletable = ids.filter(id => !linkedToReseller.has(id));
  const skippedInUse = ids.length - deletable.length;

  if (deletable.length > 0) {
    await sql`delete from customers where id in ${sql(deletable)}`;
    revalidateTag('admin-customers', { expire: 0 });
  }
  return Response.json({ deleted: deletable.length, skippedInUse });
}
