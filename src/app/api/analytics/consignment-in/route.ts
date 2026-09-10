import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';

// Analitik "Titip Masuk" (konsinyasi MASUK) — kebalikan arah dari /api/analytics/consignment.
// Beda penting dari versi outbound: `consignment_in_shipments` (terima/retur fisik) TIDAK punya
// harga (payout baru ditentukan saat produk itu benar-benar TERJUAL, bisa persentase — bukan
// harga titip tetap yang sudah dikunci sejak kirim seperti arah keluar), jadi metrik dari situ
// dilaporkan dalam PCS, bukan Rupiah. Semua metrik uang (payout ke partner, sudah/belum dibayar)
// berasal dari `consignment_in_ledger` (ditulis tiap penjualan, lihat consignment-in.ts) &
// `consignment_in_settlements`. Lihat plan snug-sparking-ocean.md.
const CONSIGNMENT_IN_ANALYTICS_VIEW_KEYS = ['consignment-in', 'dashboard'];

interface ShipmentDoc { partnerId: string | null; direction: string; createdAtSeconds: number; items: { qty: number }[] }
interface LedgerDoc {
  consignorId: string; productId: string; productName: string; qty: number; payoutAmount: number;
  status: string; createdAtSeconds: number;
}
interface SettlementDoc { partnerId: string; totalPayable: number; createdAtSeconds: number }

const getRawConsignmentInAnalytics = unstable_cache(
  async (from: string, to: string) => {
    const sql = getSql();
    const fromDate = wibDayStart(from).toDate();
    const toDate = wibDayEnd(to).toDate();
    const [partnerRows, shipRows, ledgerRows, settlementRows] = await Promise.all([
      sql<{ id: string; name: string }[]>`select id, name from consignment_in_partners`,
      sql<{ partner_id: string | null; direction: string; created_at: Date; items: unknown }[]>`
        select partner_id, direction, created_at, items from consignment_in_shipments
        where created_at >= ${fromDate} and created_at <= ${toDate}
      `,
      // Ledger dibaca TANPA batas tanggal untuk status='unsettled' (dipakai hitung "belum
      // dibayar saat ini" — snapshot, bukan per periode, sama pola dengan stockValue di analitik
      // Mitra) sekaligus DENGAN batas tanggal untuk baris lain (tren/top list per periode) —
      // paling murah baca semua sekali lalu difilter di JS, jumlah baris masih kecil.
      sql<{ consignor_id: string; product_id: string; product_name: string | null; qty: string; payout_amount: string; status: string; created_at: Date }[]>`
        select consignor_id, product_id, product_name, qty, payout_amount, status, created_at from consignment_in_ledger
      `,
      sql<{ partner_id: string; total_payable: string; created_at: Date }[]>`
        select partner_id, total_payable, created_at from consignment_in_settlements
        where created_at >= ${fromDate} and created_at <= ${toDate}
      `,
    ]);

    return {
      partners: partnerRows,
      shipments: shipRows.map((r): ShipmentDoc => ({
        partnerId: r.partner_id, direction: r.direction,
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
        items: (parseJsonb(r.items) as ShipmentDoc['items']) ?? [],
      })),
      ledger: ledgerRows.map((r): LedgerDoc => ({
        consignorId: r.consignor_id, productId: r.product_id, productName: r.product_name ?? '',
        qty: Number(r.qty) || 0, payoutAmount: Number(r.payout_amount) || 0, status: r.status,
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
      })),
      settlements: settlementRows.map((r): SettlementDoc => ({
        partnerId: r.partner_id, totalPayable: Number(r.total_payable) || 0,
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
      })),
    };
  },
  ['admin-analytics-consignment-in'],
  { revalidate: 180 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, CONSIGNMENT_IN_ANALYTICS_VIEW_KEYS, 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) {
    return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  }
  const fromSeconds = Math.floor(wibDayStart(from).toDate().getTime() / 1000);
  const toSeconds = Math.floor(wibDayEnd(to).toDate().getTime() / 1000);

  const { partners, shipments, ledger, settlements } = await getRawConsignmentInAnalytics(from, to);
  const partnerName = new Map(partners.map(p => [p.id, p.name]));

  // ── Belum dibayar saat ini — snapshot lintas waktu (bukan per periode), sama peran dengan
  // stockValue di analitik Mitra: "berapa yang masih jadi tanggungan sekarang". ──
  const unsettledAll = ledger.filter(l => l.status === 'unsettled');
  const totalOutstanding = unsettledAll.reduce((s, l) => s + l.payoutAmount, 0);
  const outstandingCount = unsettledAll.length;

  // ── Ledger & shipment yang jatuh di periode terpilih ──
  const ledgerInPeriod = ledger.filter(l => l.createdAtSeconds >= fromSeconds && l.createdAtSeconds <= toSeconds);
  const nonVoidedInPeriod = ledgerInPeriod.filter(l => l.status !== 'voided');
  const shipmentsInPeriod = shipments; // sudah difilter di query

  const totalReceivedQty = shipmentsInPeriod.filter(s => s.direction === 'in').reduce((s, sh) => s + sh.items.reduce((q, it) => q + (it.qty ?? 0), 0), 0);
  const totalReturnedQty = shipmentsInPeriod.filter(s => s.direction === 'out').reduce((s, sh) => s + sh.items.reduce((q, it) => q + (it.qty ?? 0), 0), 0);
  const totalPayout = nonVoidedInPeriod.reduce((s, l) => s + l.payoutAmount, 0);
  const totalSoldQty = nonVoidedInPeriod.reduce((s, l) => s + l.qty, 0);
  const totalSettled = settlements.reduce((s, st) => s + st.totalPayable, 0);
  const totalUnsettledInPeriod = ledgerInPeriod.filter(l => l.status === 'unsettled').reduce((s, l) => s + l.payoutAmount, 0);
  const totalSettledStatusInPeriod = ledgerInPeriod.filter(l => l.status === 'settled').reduce((s, l) => s + l.payoutAmount, 0);

  // ── Per partner ──
  interface PartnerAgg { payout: number; qty: number; receivedQty: number; returnedQty: number }
  const partnerAgg = new Map<string, PartnerAgg>();
  const getPartnerAgg = (id: string): PartnerAgg => {
    let a = partnerAgg.get(id);
    if (!a) { a = { payout: 0, qty: 0, receivedQty: 0, returnedQty: 0 }; partnerAgg.set(id, a); }
    return a;
  };
  nonVoidedInPeriod.forEach(l => { const a = getPartnerAgg(l.consignorId); a.payout += l.payoutAmount; a.qty += l.qty; });
  shipmentsInPeriod.forEach(s => {
    if (!s.partnerId) return;
    const a = getPartnerAgg(s.partnerId);
    const qty = s.items.reduce((q, it) => q + (it.qty ?? 0), 0);
    if (s.direction === 'in') a.receivedQty += qty; else a.returnedQty += qty;
  });
  const outstandingByPartner = new Map<string, number>();
  unsettledAll.forEach(l => outstandingByPartner.set(l.consignorId, (outstandingByPartner.get(l.consignorId) ?? 0) + l.payoutAmount));

  const topPartners = [...partnerAgg.entries()]
    .map(([id, a]) => ({
      id, name: partnerName.get(id) ?? '(Partner dihapus)',
      payout: a.payout, qty: a.qty, receivedQty: a.receivedQty, returnedQty: a.returnedQty,
      outstanding: outstandingByPartner.get(id) ?? 0,
    }))
    .sort((a, b) => b.payout - a.payout);

  // ── Per produk ──
  const productAgg = new Map<string, { productId: string; productName: string; qty: number; payout: number }>();
  nonVoidedInPeriod.forEach(l => {
    let p = productAgg.get(l.productId);
    if (!p) { p = { productId: l.productId, productName: l.productName, qty: 0, payout: 0 }; productAgg.set(l.productId, p); }
    p.qty += l.qty; p.payout += l.payoutAmount;
  });
  const topProducts = [...productAgg.values()].sort((a, b) => b.payout - a.payout).slice(0, 8);

  // ── Tren harian: payout (terjual) vs settled (dibayar) ──
  interface DayBucket { payout: number; settled: number }
  const dailyMap = new Map<string, DayBucket>();
  const bucket = (key: string): DayBucket => {
    let b = dailyMap.get(key);
    if (!b) { b = { payout: 0, settled: 0 }; dailyMap.set(key, b); }
    return b;
  };
  nonVoidedInPeriod.forEach(l => { bucket(wibDateKey(new Date(l.createdAtSeconds * 1000))).payout += l.payoutAmount; });
  settlements.forEach(st => { bucket(wibDateKey(new Date(st.createdAtSeconds * 1000))).settled += st.totalPayable; });
  const dailyTrend = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, b]) => ({ date, ...b }));

  return Response.json({
    period: { from, to },
    summary: {
      totalPartners: partners.length,
      totalReceivedQty, totalReturnedQty, totalSoldQty,
      totalPayout, totalSettled,
      totalOutstanding, outstandingCount,
      unsettled: { amount: totalUnsettledInPeriod }, settled: { amount: totalSettledStatusInPeriod },
    },
    topPartners,
    topProducts,
    paymentStatus: [
      { status: 'settled' as const, label: 'Sudah Dibayar', amount: totalSettledStatusInPeriod },
      { status: 'unsettled' as const, label: 'Belum Dibayar', amount: totalUnsettledInPeriod },
    ],
    dailyTrend,
  });
}
