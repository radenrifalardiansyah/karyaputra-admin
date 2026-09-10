import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';

interface ShipmentRow {
  id: string; partner_id: string; partner_name: string | null; warehouse_id: string | null; warehouse_name: string | null;
  direction: string; items: unknown; note: string | null; created_at: Date;
}
function rowToShipment(r: ShipmentRow) {
  return {
    id: r.id, partnerId: r.partner_id, partnerName: r.partner_name ?? '',
    warehouseId: r.warehouse_id ?? undefined, warehouseName: r.warehouse_name ?? '',
    direction: r.direction === 'out' ? 'out' as const : 'in' as const,
    items: parseJsonb(r.items) ?? [], note: r.note ?? '',
    createdAt: { seconds: Math.floor(r.created_at.getTime() / 1000) },
  };
}

// Riwayat gabungan "Terima Titipan" (direction='in') & "Retur ke Partner" (direction='out') — TTL
// pendek sama seperti daftar shipment/recap konsinyasi keluar (dibaca berulang tiap tab dibuka).
const getCachedShipments = unstable_cache(
  async (from: string | null, to: string | null, limit: number) => {
    const sql = getSql();
    let rows: ShipmentRow[];
    if (from && to) {
      rows = await sql<ShipmentRow[]>`select * from consignment_in_shipments where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
    } else if (from) {
      rows = await sql<ShipmentRow[]>`select * from consignment_in_shipments where created_at >= ${wibDayStart(from).toDate()} order by created_at desc`;
    } else if (to) {
      rows = await sql<ShipmentRow[]>`select * from consignment_in_shipments where created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
    } else {
      rows = await sql<ShipmentRow[]>`select * from consignment_in_shipments order by created_at desc limit ${limit}`;
    }
    return rows.map(rowToShipment);
  },
  ['admin-consignment-in-shipments-list'],
  { revalidate: 15, tags: ['admin-consignment-in-shipments-list'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const limit = parseInt(searchParams.get('limit') ?? '50');

  const shipments = await getCachedShipments(from, to, limit);
  return Response.json({ shipments });
}
