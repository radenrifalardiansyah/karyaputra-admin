import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await requirePermission(req, 'pos', 'create');
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const sql = getSql();
  await sql`delete from pos_held_transactions where id = ${id}`;
  return Response.json({ ok: true });
}
