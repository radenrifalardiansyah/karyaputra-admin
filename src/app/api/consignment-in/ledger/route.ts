import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Daftar baris consignment_in_ledger — dasar tampilan "Belum Dibayar" per partner di tab Titip
// Masuk. TIDAK di-cache (sama alasan orders/consignment_recaps: dibaca ulang tiap ada transaksi
// baru, cache basi gampang salah tampil "sudah dibayar padahal belum" atau sebaliknya).
interface LedgerRow {
  id: string; order_id: string | null; product_id: string; product_name: string | null;
  consignor_id: string; consignor_name: string | null; qty: string; payout_amount: string;
  status: string; settlement_id: string | null; created_at: Date; settled_at: Date | null;
}
function rowToLedger(r: LedgerRow) {
  return {
    id: r.id, orderId: r.order_id, productId: r.product_id, productName: r.product_name ?? '',
    consignorId: r.consignor_id, consignorName: r.consignor_name ?? '',
    qty: Number(r.qty) || 0, payoutAmount: Number(r.payout_amount) || 0,
    status: r.status as 'unsettled' | 'settled' | 'voided', settlementId: r.settlement_id,
    createdAt: { seconds: Math.floor(r.created_at.getTime() / 1000) },
    settledAt: r.settled_at ? { seconds: Math.floor(r.settled_at.getTime() / 1000) } : null,
  };
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');
  const status = searchParams.get('status'); // 'unsettled' | 'settled' | 'voided' — default 'unsettled'
  const sql = getSql();

  const rows = await sql<LedgerRow[]>`
    select * from consignment_in_ledger
    where (${partnerId}::text is null or consignor_id = ${partnerId})
      and status = ${status ?? 'unsettled'}
    order by created_at asc
  `;
  const entries = rows.map(rowToLedger);

  const summaryMap = new Map<string, { productId: string; productName: string; qty: number; payoutAmount: number }>();
  for (const e of entries) {
    const existing = summaryMap.get(e.productId);
    if (existing) { existing.qty += e.qty; existing.payoutAmount += e.payoutAmount; }
    else summaryMap.set(e.productId, { productId: e.productId, productName: e.productName, qty: e.qty, payoutAmount: e.payoutAmount });
  }

  return Response.json({ entries, summary: [...summaryMap.values()], total: entries.reduce((s, e) => s + e.payoutAmount, 0) });
}
