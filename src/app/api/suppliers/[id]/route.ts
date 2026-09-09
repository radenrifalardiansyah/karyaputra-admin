import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'suppliers', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const sql = getSql();
  await sql`
    update suppliers set name = ${data.name as string}, phone = ${(data.phone as string) ?? ''},
      address = ${(data.address as string) ?? ''}, note = ${(data.note as string) ?? ''}, updated_at = now()
    where id = ${id}
  `;
  revalidateTag('admin-suppliers', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'suppliers', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();

  // Tolak kalau supplier ini masih punya riwayat pembelian bahan baku — kalau dibolehkan,
  // material_purchases.supplier_id jadi menunjuk ke baris yang sudah tidak ada.
  const [{ exists }] = await sql<{ exists: boolean }[]>`select exists(select 1 from material_purchases where supplier_id = ${id}) as exists`;
  if (exists) {
    return Response.json(
      { error: 'Supplier ini masih punya riwayat pembelian bahan baku — tidak bisa dihapus.' },
      { status: 400 },
    );
  }

  await sql`delete from suppliers where id = ${id}`;
  revalidateTag('admin-suppliers', { expire: 0 });
  return Response.json({ ok: true });
}
