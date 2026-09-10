import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

// Partner "Titip Masuk" (konsinyasi masuk) — pola sama persis dengan consignment/locations/route.ts
// (arah keluar), hanya kode prefix & field default settlement yang beda. Lihat plan
// snug-sparking-ocean.md.
const PARTNER_CODE_PREFIX = 'TMK';

interface PartnerRow {
  id: string; name: string; code: string | null; contact_name: string | null; contact_phone: string | null;
  address: string | null; note: string | null;
  default_settlement_type: string; default_payout_price: string | null; default_commission_pct: string | null;
  created_at: Date; updated_at: Date | null;
}
function rowToPartner(r: PartnerRow) {
  return {
    id: r.id, name: r.name, code: r.code ?? '', contactName: r.contact_name ?? '', contactPhone: r.contact_phone ?? '',
    address: r.address ?? '', note: r.note ?? '',
    defaultSettlementType: r.default_settlement_type === 'percentage' ? 'percentage' as const : 'fixed' as const,
    defaultPayoutPrice: r.default_payout_price != null ? Number(r.default_payout_price) : null,
    defaultCommissionPct: r.default_commission_pct != null ? Number(r.default_commission_pct) : null,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}

const getCachedPartners = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<PartnerRow[]>`select * from consignment_in_partners order by created_at asc`;
    const partners = rows.map(rowToPartner);

    let maxCode = 0;
    for (const p of partners) {
      const m = new RegExp(`^${PARTNER_CODE_PREFIX}(\\d+)$`, 'i').exec(p.code.trim());
      if (m) maxCode = Math.max(maxCode, parseInt(m[1], 10));
    }
    const missing = partners.filter(p => !p.code.trim());
    for (const p of missing) {
      maxCode += 1;
      const code = `${PARTNER_CODE_PREFIX}${String(maxCode).padStart(3, '0')}`;
      p.code = code;
      await sql`update consignment_in_partners set code = ${code}, updated_at = now() where id = ${p.id}`;
    }
    return partners;
  },
  ['admin-consignment-in-partners'],
  { revalidate: 20, tags: ['admin-consignment-in-partners'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'view');
  if (guard instanceof Response) return guard;
  const partners = await getCachedPartners();
  return Response.json({ partners });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();
  const codeTrim = typeof data.code === 'string' ? data.code.trim() : '';
  if (codeTrim) {
    const [dup] = await sql<{ id: string }[]>`select id from consignment_in_partners where code = ${codeTrim} limit 1`;
    if (dup) return Response.json({ error: `Kode "${codeTrim}" sudah digunakan partner lain.` }, { status: 409 });
  }
  const id = randomUUID();
  const payload = {
    name: (data.name as string) ?? '', code: codeTrim,
    contactName: (data.contactName as string) ?? '', contactPhone: (data.contactPhone as string) ?? '',
    address: (data.address as string) ?? '', note: (data.note as string) ?? '',
    defaultSettlementType: data.defaultSettlementType === 'percentage' ? 'percentage' : 'fixed',
    defaultPayoutPrice: data.defaultPayoutPrice != null ? Number(data.defaultPayoutPrice) : null,
    defaultCommissionPct: data.defaultCommissionPct != null ? Number(data.defaultCommissionPct) : null,
  };
  await sql`
    insert into consignment_in_partners (
      id, name, code, contact_name, contact_phone, address, note,
      default_settlement_type, default_payout_price, default_commission_pct, created_at, updated_at
    ) values (
      ${id}, ${payload.name}, ${payload.code}, ${payload.contactName}, ${payload.contactPhone}, ${payload.address}, ${payload.note},
      ${payload.defaultSettlementType}, ${payload.defaultPayoutPrice}, ${payload.defaultCommissionPct}, now(), now()
    )
  `;
  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInPartners', entityId: id,
      entityLabel: payload.name || id, action: 'create', actor: guard, after: payload,
    });
  } catch {}
  revalidateTag('admin-consignment-in-partners', { expire: 0 });
  return Response.json({ id });
}
