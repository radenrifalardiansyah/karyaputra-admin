import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { resolveCustomerId, RESELLER_STATUSES, ManualCustomer, ResellerStatus } from '@/lib/resellers';

type Ctx = { params: Promise<{ id: string }> };
type ResellerBody = {
  customerId?: string;
  customer?: ManualCustomer;
  bankName?: string; bankAccount?: string; bankHolder?: string;
  status?: ResellerStatus;
};

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'resellers', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json() as ResellerBody;
  const sql = getSql();

  const [row] = await sql<{ id: string }[]>`select id from resellers where id = ${id}`;
  if (!row) return Response.json({ error: 'Reseller tidak ditemukan.' }, { status: 404 });

  let customerId: string | undefined;
  if (body.customerId || body.customer) {
    const resolved = await resolveCustomerId(body);
    if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });

    const [existing] = await sql<{ id: string }[]>`select id from resellers where customer_id = ${resolved.customerId} and id != ${id} limit 1`;
    if (existing) {
      return Response.json({ error: 'Pelanggan ini sudah terdaftar sebagai reseller.' }, { status: 409 });
    }
    customerId = resolved.customerId;
  }

  const status = body.status && RESELLER_STATUSES.includes(body.status) ? body.status : undefined;

  await sql`
    update resellers set
      customer_id = coalesce(${customerId ?? null}, customer_id),
      bank_name = coalesce(${body.bankName !== undefined ? body.bankName.trim() : null}, bank_name),
      bank_account = coalesce(${body.bankAccount !== undefined ? body.bankAccount.trim() : null}, bank_account),
      bank_holder = coalesce(${body.bankHolder !== undefined ? body.bankHolder.trim() : null}, bank_holder),
      status = coalesce(${status ?? null}, status),
      updated_at = now()
    where id = ${id}
  `;
  revalidateTag('admin-resellers', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'resellers', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  await sql`delete from resellers where id = ${id}`;
  revalidateTag('admin-resellers', { expire: 0 });
  return Response.json({ ok: true });
}
