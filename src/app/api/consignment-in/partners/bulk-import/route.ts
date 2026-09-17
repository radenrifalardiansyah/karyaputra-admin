import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

// Pola sama dengan products/bulk-import/route.ts — dedup by code, baris tidak lengkap dilewati
// (bukan gagal seluruh batch). Kode kosong dibiarkan kosong (sama seperti create satu-satu di
// partners/route.ts POST) — auto-diisi TMK### oleh getCachedPartners saat GET berikutnya.
interface ImportRow {
  code?: string; name: string; contactName?: string; contactPhone?: string; address?: string; note?: string;
  defaultSettlementType?: 'fixed' | 'percentage'; defaultPayoutPrice?: number | null; defaultCommissionPct?: number | null;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'create');
  if (guard instanceof Response) return guard;
  const { partners } = await req.json() as { partners: ImportRow[] };
  if (!Array.isArray(partners) || partners.length === 0) {
    return Response.json({ error: 'Tidak ada data partner untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const sql = getSql();
  const existingRows = await sql<{ code: string | null }[]>`select code from consignment_in_partners`;
  const existingCodes = new Set(existingRows.map(r => (r.code ?? '').trim()).filter(Boolean));
  const seenCodes = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;

  for (const row of partners) {
    const name = (row.name ?? '').toString().trim();
    const code = (row.code ?? '').toString().trim();
    if (!name) { skippedInvalid++; continue; }
    if (code && (existingCodes.has(code) || seenCodes.has(code))) { skippedDuplicate++; continue; }
    if (code) seenCodes.add(code);

    const id = randomUUID();
    const payload = {
      name, code,
      contactName: (row.contactName ?? '').toString().trim(), contactPhone: (row.contactPhone ?? '').toString().trim(),
      address: (row.address ?? '').toString().trim(), note: (row.note ?? '').toString().trim(),
      defaultSettlementType: row.defaultSettlementType === 'percentage' ? 'percentage' : 'fixed',
      defaultPayoutPrice: row.defaultPayoutPrice != null ? Number(row.defaultPayoutPrice) : null,
      defaultCommissionPct: row.defaultCommissionPct != null ? Number(row.defaultCommissionPct) : null,
    };

    try {
      await sql`
        insert into consignment_in_partners (
          id, name, code, contact_name, contact_phone, address, note,
          default_settlement_type, default_payout_price, default_commission_pct, created_at, updated_at
        ) values (
          ${id}, ${payload.name}, ${payload.code}, ${payload.contactName}, ${payload.contactPhone}, ${payload.address}, ${payload.note},
          ${payload.defaultSettlementType}, ${payload.defaultPayoutPrice}, ${payload.defaultCommissionPct}, now(), now()
        )
      `;
      created++;
      try {
        await logHistory(db, {
          entity: 'consignment-in', entityCollection: 'consignmentInPartners', entityId: id,
          entityLabel: payload.name, action: 'create', actor: guard, after: payload,
        });
      } catch {}
    } catch (err) {
      console.error('Bulk import partner: gagal menyimpan baris', name, err);
      skippedInvalid++;
    }
  }

  if (created > 0) revalidateTag('admin-consignment-in-partners', { expire: 0 });
  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
