import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'storefront-customers', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();

  const [{ count }] = await sql<{ count: string }[]>`select count(*)::int as count from reviews where customer_id = ${id}`;
  if (Number(count) > 0) {
    return Response.json({ error: 'Customer ini masih punya ulasan (review) produk — tidak bisa dihapus.' }, { status: 400 });
  }

  try {
    await sql`delete from storefront_customers where id = ${id}`;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
      return Response.json({ error: 'Tidak bisa dihapus — customer ini masih direferensikan data lain.' }, { status: 400 });
    }
    throw err;
  }
  revalidateTag('admin-storefront-customers', { expire: 0 });
  return Response.json({ ok: true });
}
