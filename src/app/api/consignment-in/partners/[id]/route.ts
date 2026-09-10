import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };
interface PartnerRow {
  name: string; code: string | null; contact_name: string | null; contact_phone: string | null; address: string | null; note: string | null;
  default_settlement_type: string; default_payout_price: string | null; default_commission_pct: string | null;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment-in', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();
  const codeTrim = typeof data.code === 'string' ? data.code.trim() : '';
  if (codeTrim) {
    const [dup] = await sql<{ id: string }[]>`select id from consignment_in_partners where code = ${codeTrim} limit 1`;
    if (dup && dup.id !== id) return Response.json({ error: `Kode "${codeTrim}" sudah digunakan partner lain.` }, { status: 409 });
  }
  const [before] = await sql<PartnerRow[]>`select name, code, contact_name, contact_phone, address, note, default_settlement_type, default_payout_price, default_commission_pct from consignment_in_partners where id = ${id}`;
  const payload = {
    name: (data.name as string) ?? '', code: codeTrim,
    contactName: (data.contactName as string) ?? '', contactPhone: (data.contactPhone as string) ?? '',
    address: (data.address as string) ?? '', note: (data.note as string) ?? '',
    defaultSettlementType: data.defaultSettlementType === 'percentage' ? 'percentage' : 'fixed',
    defaultPayoutPrice: data.defaultPayoutPrice != null ? Number(data.defaultPayoutPrice) : null,
    defaultCommissionPct: data.defaultCommissionPct != null ? Number(data.defaultCommissionPct) : null,
  };
  await sql`
    update consignment_in_partners set
      name = ${payload.name}, code = ${payload.code}, contact_name = ${payload.contactName}, contact_phone = ${payload.contactPhone},
      address = ${payload.address}, note = ${payload.note}, default_settlement_type = ${payload.defaultSettlementType},
      default_payout_price = ${payload.defaultPayoutPrice}, default_commission_pct = ${payload.defaultCommissionPct}, updated_at = now()
    where id = ${id}
  `;
  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInPartners', entityId: id,
      entityLabel: payload.name || before?.name || id, action: 'update', actor: guard, before, after: { ...before, ...payload },
    });
  } catch {}
  revalidateTag('admin-consignment-in-partners', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment-in', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  // Tolak kalau partner ini masih punya jejak apapun — produk yang menandainya sebagai pemilik,
  // riwayat terima/retur fisik, ledger belum dibayar, atau riwayat settlement. Sama alasan dengan
  // guard DELETE di consignment/locations/[id]/route.ts (arah keluar): kalau dibolehkan, jejak itu
  // jadi yatim permanen karena partnernya sudah tidak bisa dipilih lagi.
  const [{ count: productCount }] = await sql<{ count: string }[]>`select count(*)::int as count from products where consignor_id = ${id}`;
  if (Number(productCount) > 0) {
    return Response.json({ error: 'Partner ini masih punya produk titipan terdaftar — pindahkan atau hapus dulu produknya.' }, { status: 400 });
  }
  const [{ count: unsettledCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_in_ledger where consignor_id = ${id} and status = 'unsettled'`;
  if (Number(unsettledCount) > 0) {
    return Response.json({ error: 'Partner ini masih punya tagihan belum dibayar — selesaikan settlement dulu.' }, { status: 400 });
  }
  const [{ count: shipmentCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_in_shipments where partner_id = ${id}`;
  if (Number(shipmentCount) > 0) {
    return Response.json({ error: 'Partner ini masih punya riwayat terima/retur titipan — tidak bisa dihapus.' }, { status: 400 });
  }
  const [{ count: settlementCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_in_settlements where partner_id = ${id}`;
  if (Number(settlementCount) > 0) {
    return Response.json({ error: 'Partner ini masih punya riwayat settlement — tidak bisa dihapus.' }, { status: 400 });
  }

  const [before] = await sql<PartnerRow[]>`select name, code, contact_name, contact_phone, address, note, default_settlement_type, default_payout_price, default_commission_pct from consignment_in_partners where id = ${id}`;
  try {
    await sql`delete from consignment_in_partners where id = ${id}`;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
      return Response.json({ error: 'Tidak bisa dihapus — partner ini masih direferensikan data lain.' }, { status: 400 });
    }
    throw err;
  }
  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInPartners', entityId: id,
      entityLabel: before?.name || id, action: 'delete', actor: guard, before,
    });
  } catch {}
  revalidateTag('admin-consignment-in-partners', { expire: 0 });
  return Response.json({ ok: true });
}
