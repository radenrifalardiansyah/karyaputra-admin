import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { resolveCustomerId, RESELLER_STATUSES, ManualCustomer, ResellerStatus } from '@/lib/resellers';
import { rowToCustomer, type ResellerRow, type CustomerRow } from '@/lib/customers-pg';
import { toTimestamp } from '@/lib/orders-pg';

type ResellerBody = {
  customerId?: string;
  customer?: ManualCustomer;
  bankName?: string; bankAccount?: string; bankHolder?: string;
  status?: ResellerStatus;
};

const getCachedResellers = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<ResellerRow[]>`select * from resellers order by created_at desc`;

    const customerIds = [...new Set(rows.map(r => r.customer_id).filter((v): v is string => !!v))];
    const customerRows = customerIds.length > 0
      ? await sql<CustomerRow[]>`select * from customers where id in ${sql(customerIds)}`
      : [];
    const customerMap = new Map(customerRows.map(r => [r.id, rowToCustomer(r)]));

    const merged = rows.map(r => {
      const c = r.customer_id ? customerMap.get(r.customer_id) : undefined;
      return {
        id: r.id, customerId: r.customer_id,
        bankName: r.bank_name ?? '', bankAccount: r.bank_account ?? '', bankHolder: r.bank_holder ?? '',
        status: r.status,
        createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
        name: c?.name ?? '(Pelanggan dihapus)',
        phone: c?.phone ?? '',
        code: c?.code ?? '',
        email: c?.email ?? '',
        address: c?.address ?? '',
        city: c?.city ?? '',
        type: c?.type ?? 'personal',
      };
    });
    merged.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    return merged;
  },
  ['admin-resellers'],
  { revalidate: 15, tags: ['admin-resellers'] }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'resellers', 'view');
  if (guard instanceof Response) return guard;
  const resellers = await getCachedResellers();
  return Response.json({ resellers });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'resellers', 'create');
  if (guard instanceof Response) return guard;
  const body = await req.json() as ResellerBody;

  const resolved = await resolveCustomerId(body);
  if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });

  const sql = getSql();
  const [existing] = await sql<{ id: string }[]>`select id from resellers where customer_id = ${resolved.customerId} limit 1`;
  if (existing) {
    return Response.json({ error: 'Pelanggan ini sudah terdaftar sebagai reseller.' }, { status: 409 });
  }

  const status = RESELLER_STATUSES.includes(body.status as ResellerStatus) ? body.status! : 'pending';
  const id = randomUUID();
  await sql`
    insert into resellers (id, customer_id, bank_name, bank_account, bank_holder, status, created_at, updated_at)
    values (${id}, ${resolved.customerId}, ${body.bankName?.trim() ?? ''}, ${body.bankAccount?.trim() ?? ''}, ${body.bankHolder?.trim() ?? ''}, ${status}, now(), now())
  `;
  revalidateTag('admin-resellers', { expire: 0 });
  return Response.json({ id, customerId: resolved.customerId });
}
