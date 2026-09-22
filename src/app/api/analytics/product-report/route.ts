import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';

interface OrderItemDoc { productId?: string; variantId?: string; name?: string; qty: number; price?: number; subtotal?: number }
interface OrderDoc {
  source?: 'kasir' | 'portal'; status?: string; paymentStatus?: 'lunas' | 'belum_lunas'; items?: OrderItemDoc[];
  subtotal?: number; total?: number; createdAtSeconds: number | null;
}
interface RecapItemDoc { productId?: string; variantId?: string; productName?: string; qtySold: number; revenue?: number; hargaTitip?: number }
interface RecapDoc { paymentStatus?: 'lunas' | 'belum_lunas'; items?: RecapItemDoc[]; createdAtSeconds: number | null }

interface ProductRow {
  key: string; productId: string; variantId: string | null; name: string;
  qtyPos: number; qtyOnline: number; qtyConsignment: number;
  revenue: number;
}

// Semua tanggal kalender dari `from` s/d `to` (inklusif) — dipakai supaya sumbu tanggal grafik tren
// tidak bolong di hari tanpa transaksi (beda dari dailyTrend di analytics/overview yang cuma
// mencatat hari yang ada aktivitasnya).
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return days;
}

// Raw Firestore reads untuk satu rentang tanggal — cached 3 menit, sama seperti getRawAnalytics
// di analytics/overview/route.ts, supaya ganti-ganti periode/refresh di Laporan Produk tidak
// query Firestore fresh tiap kali (endpoint ini dulu tidak di-cache sama sekali).
const getRawProductReport = unstable_cache(
  async (from: string, to: string) => {
    const sql = getSql();
    const [orderRows, recapRows] = await Promise.all([
      // `orders` pindah ke Postgres (Tahap 12 migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md).
      sql<{ source: string; status: string; payment_status: string; items: unknown; subtotal: string; total: string; created_at: Date }[]>`
        select source, status, payment_status, items, subtotal, total, created_at from orders
        where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
      `,
      // `consignment_recaps` pindah ke Postgres (Tahap 13 migrasi Fase 2).
      sql<{ payment_status: string; items: unknown; created_at: Date }[]>`
        select payment_status, items, created_at from consignment_recaps
        where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
      `,
    ]);
    return {
      orders: orderRows.map((r): OrderDoc => ({
        source: r.source as 'kasir' | 'portal', status: r.status, paymentStatus: r.payment_status as 'lunas' | 'belum_lunas',
        items: (parseJsonb(r.items) as OrderDoc['items']) ?? [],
        subtotal: Number(r.subtotal), total: Number(r.total),
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
      })),
      recaps: recapRows.map((r): RecapDoc => ({
        paymentStatus: r.payment_status as 'lunas' | 'belum_lunas',
        items: (parseJsonb(r.items) as RecapDoc['items']) ?? [],
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
      })),
    };
  },
  ['admin-analytics-product-report'],
  { revalidate: 180 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) {
    return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  }

  const { orders, recaps } = await getRawProductReport(from, to);

  // Sama seperti Laporan Keuangan: order/rekap "Belum Lunas" atau yang belum dikonfirmasi
  // (pesanan "baru"/dibatalkan) tidak dihitung sebagai penjualan.
  const countedOrders = orders.filter(o => (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
  const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');

  // Key gabungan productId+variantId — dua varian dari produk yang sama HARUS jadi baris
  // terpisah (rasa/ukuran mana yang paling laku), bukan tergabung diam-diam ke satu baris
  // "produk induk" dengan nama yang kebetulan diambil dari item pertama yang diproses.
  const keyOf = (productId: string | undefined, variantId: string | undefined, name: string | undefined) =>
    productId ? `${productId}${variantId ? `::${variantId}` : ''}` : `__noid__${name ?? '(tanpa nama)'}`;
  const rows = new Map<string, ProductRow>();
  const rowFor = (productId: string | undefined, variantId: string | undefined, name: string | undefined): ProductRow => {
    const key = keyOf(productId, variantId, name);
    let r = rows.get(key);
    if (!r) {
      r = { key, productId: productId ?? '', variantId: variantId ?? null, name: name || '(tanpa nama)', qtyPos: 0, qtyOnline: 0, qtyConsignment: 0, revenue: 0 };
      rows.set(key, r);
    }
    return r;
  };

  // Qty per hari (WIB) per produk — dipakai grafik tren, dibatasi ke top 4 produk sesudah
  // agregasi total selesai (lihat trendProducts di bawah), supaya payload-nya tetap kecil.
  const dailyQty = new Map<string, Map<string, number>>();
  const addDaily = (seconds: number | null, key: string, qty: number) => {
    if (seconds == null) return;
    const dayKey = wibDateKey(new Date(seconds * 1000));
    let byProduct = dailyQty.get(dayKey);
    if (!byProduct) { byProduct = new Map(); dailyQty.set(dayKey, byProduct); }
    byProduct.set(key, (byProduct.get(key) ?? 0) + qty);
  };

  countedOrders.forEach(o => {
    // Diskon di POS dipotong dari TOTAL order, bukan dari subtotal tiap item — prorata di sini
    // (scale = total / subtotal) supaya jumlah omzet per produk tetap identik dengan
    // "Penjualan Kasir/Online" di Laporan Keuangan (yang pakai order.total, sudah net diskon).
    const itemsSubtotal = (o.items ?? []).reduce((s, it) => s + (it.subtotal ?? (it.price ?? 0) * it.qty), 0);
    const scale = (o.total != null && itemsSubtotal > 0) ? o.total / itemsSubtotal : 1;
    (o.items ?? []).forEach(it => {
      // Item bebas input di POS (mis. "Ongkir JNE", "Bungkus kado") tidak punya productId —
      // sama seperti /api/orders yang skip pemotongan stok & HPP untuk item ini, laporan produk
      // juga harus skip supaya item non-produk ini tidak nyasar jadi baris produk.
      if (!it.productId) return;
      const r = rowFor(it.productId, it.variantId, it.name);
      if (o.source === 'portal') r.qtyOnline += it.qty; else r.qtyPos += it.qty;
      r.revenue += (it.subtotal ?? (it.price ?? 0) * it.qty) * scale;
      addDaily(o.createdAtSeconds, r.key, it.qty);
    });
  });
  countedRecaps.forEach(rec => {
    (rec.items ?? []).forEach(it => {
      const r = rowFor(it.productId, it.variantId, it.productName);
      r.qtyConsignment += it.qtySold;
      r.revenue += it.revenue ?? (it.hargaTitip ?? 0) * it.qtySold;
      addDaily(rec.createdAtSeconds, r.key, it.qtySold);
    });
  });

  const products = [...rows.values()]
    // Math.round karena prorata diskon di atas menghasilkan pecahan rupiah.
    .map(r => ({ ...r, revenue: Math.round(r.revenue), qtyTotal: r.qtyPos + r.qtyOnline + r.qtyConsignment }))
    .filter(r => r.qtyTotal > 0)
    .sort((a, b) => b.qtyTotal - a.qtyTotal);

  const totalQty = products.reduce((s, p) => s + p.qtyTotal, 0);
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);

  // Grafik tren — dibatasi ke 4 produk terlaris supaya tetap terbaca (bukan spaghetti chart) dan
  // warnanya bisa dipetakan tetap 1:1 per produk di client (lihat ProductReportTab).
  const trendProducts = products.slice(0, 4).map(p => ({ key: p.key, name: p.name }));
  const dailyTrend = eachDay(from, to).map(date => {
    const byProduct = dailyQty.get(date);
    const row: Record<string, string | number> = { date };
    trendProducts.forEach(p => { row[p.key] = byProduct?.get(p.key) ?? 0; });
    return row;
  });

  return Response.json({ period: { from, to }, products, totalQty, totalRevenue, trendProducts, dailyTrend });
}
