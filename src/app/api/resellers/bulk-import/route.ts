import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { RESELLER_STATUSES, ResellerStatus } from '@/lib/resellers';

interface ImportRow {
  phone: string; name: string; city?: string; address?: string;
  bankName?: string; bankAccount?: string; bankHolder?: string; status?: ResellerStatus;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'resellers', 'create');
  if (guard instanceof Response) return guard;
  const { resellers } = await req.json() as { resellers: ImportRow[] };
  if (!Array.isArray(resellers) || resellers.length === 0) {
    return Response.json({ error: 'Tidak ada data reseller untuk diimpor.' }, { status: 400 });
  }

  const sql = getSql();
  const customerRows = await sql<{ id: string; phone: string }[]>`select id, phone from customers`;
  const customerIdByPhone = new Map(
    customerRows.map(r => [(r.phone ?? '').trim(), r.id] as const).filter(([phone]) => phone),
  );

  const resellerRows = await sql<{ customer_id: string | null }[]>`select customer_id from resellers`;
  const existingResellerCustomerIds = new Set(resellerRows.map(r => r.customer_id).filter((v): v is string => !!v));
  const seenCustomerIds = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;

  for (const row of resellers) {
    const phone = (row.phone ?? '').toString().trim();
    const name  = (row.name  ?? '').toString().trim();
    if (!phone && !name) { skippedInvalid++; continue; }

    let customerId = phone ? customerIdByPhone.get(phone) : undefined;
    if (!customerId) {
      if (!name) { skippedInvalid++; continue; }
      customerId = randomUUID();
      await sql`
        insert into customers (id, name, phone, code, type, email, address, city, notes, created_at, updated_at)
        values (${customerId}, ${name}, ${phone}, '', 'personal', '', ${(row.address ?? '').toString().trim()}, ${(row.city ?? '').toString().trim()}, '', now(), now())
      `;
      if (phone) customerIdByPhone.set(phone, customerId);
    }

    if (existingResellerCustomerIds.has(customerId) || seenCustomerIds.has(customerId)) {
      skippedDuplicate++; continue;
    }
    seenCustomerIds.add(customerId);

    const status = row.status && RESELLER_STATUSES.includes(row.status) ? row.status : 'pending';
    await sql`
      insert into resellers (id, customer_id, bank_name, bank_account, bank_holder, status, created_at, updated_at)
      values (${randomUUID()}, ${customerId}, ${(row.bankName ?? '').toString().trim()}, ${(row.bankAccount ?? '').toString().trim()}, ${(row.bankHolder ?? '').toString().trim()}, ${status}, now(), now())
    `;
    created++;
  }

  if (created > 0) revalidateTag('admin-resellers', { expire: 0 });
  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
