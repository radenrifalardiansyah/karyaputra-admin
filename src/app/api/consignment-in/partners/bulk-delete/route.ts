import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

interface PartnerRow {
  name: string; code: string | null; contact_name: string | null; contact_phone: string | null; address: string | null; note: string | null;
  default_settlement_type: string; default_payout_price: string | null; default_commission_pct: string | null;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  // Satu per satu (bukan satu statement) — sama alasan dengan products/bulk-delete: tiap partner
  // punya beberapa guard independen (produk titipan, ledger belum settle, riwayat kirim/settlement,
  // lihat DELETE di partners/[id]/route.ts), jadi satu partner yang gagal dihapus tidak boleh
  // menggagalkan partner lain dalam batch yang sama.
  let deleted = 0;
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const [{ count: productCount }] = await sql<{ count: string }[]>`select count(*)::int as count from products where consignor_id = ${id}`;
      if (Number(productCount) > 0) throw new Error('masih punya produk titipan terdaftar');
      const [{ count: unsettledCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_in_ledger where consignor_id = ${id} and status = 'unsettled'`;
      if (Number(unsettledCount) > 0) throw new Error('masih punya tagihan belum dibayar');
      const [{ count: shipmentCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_in_shipments where partner_id = ${id}`;
      if (Number(shipmentCount) > 0) throw new Error('masih punya riwayat terima/retur titipan');
      const [{ count: settlementCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_in_settlements where partner_id = ${id}`;
      if (Number(settlementCount) > 0) throw new Error('masih punya riwayat settlement');

      const [before] = await sql<PartnerRow[]>`select name, code, contact_name, contact_phone, address, note, default_settlement_type, default_payout_price, default_commission_pct from consignment_in_partners where id = ${id}`;
      await sql`delete from consignment_in_partners where id = ${id}`;
      deleted++;
      try {
        await logHistory(db, {
          entity: 'consignment-in', entityCollection: 'consignmentInPartners', entityId: id,
          entityLabel: before?.name || id, action: 'delete', actor: guard, before,
        });
      } catch {}
    } catch (err) {
      const message = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503'
        ? 'masih direferensikan data lain'
        : (err instanceof Error ? err.message : 'gagal dihapus');
      failed.push({ id, error: message });
    }
  }

  if (deleted > 0) revalidateTag('admin-consignment-in-partners', { expire: 0 });
  if (failed.length > 0) return Response.json({ deleted, failed }, { status: 400 });
  return Response.json({ deleted, failed });
}
