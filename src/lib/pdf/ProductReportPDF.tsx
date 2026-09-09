import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface ProductReportPDFRow {
  no: number;
  productName: string;
  category?: string;
  qtyPos: number;
  qtyOnline: number;
  qtyConsignment: number;
  qtyTotal: number;
  revenue: number;
}

export interface ProductReportPDFData {
  periodLabel: string;
  from: string;
  to: string;
  totalQty: number;
  totalRevenue: number;
  jenisProduk: number;
  rows: ProductReportPDFRow[];
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const C = {
  accent:   THEME_COLOR,
  accentBg: '#F0FDF4',
  dark:     '#1E1008',
  muted:    '#A08468',
  border:   '#E6DDD0',
  white:    '#FFFFFF',
  green:    '#15803D',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 32, fontSize: 9 },

  topBar: { height: 7, backgroundColor: C.accent, marginTop: -32, marginHorizontal: -32, marginBottom: 18 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 44, height: 44, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
  storeName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeTagline: { fontSize: 8, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8, color: C.muted, marginTop: 1 },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5 },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 3 },
  docMetaLabel: { fontSize: 8, color: C.muted },
  docMetaValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 10, marginBottom: 12 },

  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryBox: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: C.border, padding: 7 },
  summaryLabel: { fontSize: 6.8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.2, marginBottom: 2 },
  summaryValue: { fontSize: 11.5, fontFamily: 'Helvetica-Bold' },

  table: { marginTop: 14, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 4 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 8, paddingVertical: 4.5, paddingHorizontal: 4, color: C.dark },

  colNo:      { width: '5%' },
  colProduk:  { width: '27%' },
  colKat:     { width: '15%' },
  colKasir:   { width: '11%', textAlign: 'right' },
  colOnline:  { width: '11%', textAlign: 'right' },
  colKons:    { width: '11%', textAlign: 'right' },
  colTotal:   { width: '10%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  colOmzet:   { width: '15%', textAlign: 'right' },

  totalsRow: { flexDirection: 'row', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border },
  totalsCell: { fontSize: 8, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 4, color: C.dark },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: C.muted },
});

export default function ProductReportPDF({ data, store }: { data: ProductReportPDFData; store: StoreHeader }) {
  const totalKasir = data.rows.reduce((sum, r) => sum + r.qtyPos, 0);
  const totalOnline = data.rows.reduce((sum, r) => sum + r.qtyOnline, 0);
  const totalKons = data.rows.reduce((sum, r) => sum + r.qtyConsignment, 0);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.topBar} />

        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {store.logo && <Image src={store.logo} style={s.logo} />}
            <View>
              <Text style={s.storeName}>{store.name}</Text>
              {store.tagline && <Text style={s.storeTagline}>{store.tagline}</Text>}
              {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>LAPORAN PRODUK</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Periode:</Text>
              <Text style={s.docMetaValue}>{data.periodLabel} ({data.from} s/d {data.to})</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Unit Terjual</Text>
            <Text style={[s.summaryValue, { color: C.green }]}>{data.totalQty}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Omzet dari Produk Terjual</Text>
            <Text style={[s.summaryValue, { color: C.accent }]}>{rp(data.totalRevenue)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Jenis Produk Terjual</Text>
            <Text style={[s.summaryValue, { color: C.dark }]}>{data.jenisProduk}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colProduk]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colKat]}>Kategori</Text>
            <Text style={[s.tHeadCell, s.colKasir]}>Kasir</Text>
            <Text style={[s.tHeadCell, s.colOnline]}>Online</Text>
            <Text style={[s.tHeadCell, s.colKons]}>Konsinyasi</Text>
            <Text style={[s.tHeadCell, s.colTotal]}>Total Qty</Text>
            <Text style={[s.tHeadCell, s.colOmzet]}>Omzet</Text>
          </View>
          {data.rows.map((r, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
              <Text style={[s.tCell, s.colNo]}>{r.no}</Text>
              <Text style={[s.tCell, s.colProduk]}>{r.productName}</Text>
              <Text style={[s.tCell, s.colKat]}>{r.category || '–'}</Text>
              <Text style={[s.tCell, s.colKasir]}>{r.qtyPos || '–'}</Text>
              <Text style={[s.tCell, s.colOnline]}>{r.qtyOnline || '–'}</Text>
              <Text style={[s.tCell, s.colKons]}>{r.qtyConsignment || '–'}</Text>
              <Text style={[s.tCell, s.colTotal]}>{r.qtyTotal}</Text>
              <Text style={[s.tCell, s.colOmzet, { fontFamily: 'Helvetica-Bold', color: C.accent }]}>{rp(r.revenue)}</Text>
            </View>
          ))}
          <View style={s.totalsRow}>
            <Text style={[s.totalsCell, s.colNo]} />
            <Text style={[s.totalsCell, s.colProduk]}>Total ({data.rows.length} produk)</Text>
            <Text style={[s.totalsCell, s.colKat]} />
            <Text style={[s.totalsCell, s.colKasir]}>{totalKasir}</Text>
            <Text style={[s.totalsCell, s.colOnline]}>{totalOnline}</Text>
            <Text style={[s.totalsCell, s.colKons]}>{totalKons}</Text>
            <Text style={[s.totalsCell, s.colTotal]}>{data.totalQty}</Text>
            <Text style={[s.totalsCell, s.colOmzet, { color: C.accent }]}>{rp(data.totalRevenue)}</Text>
          </View>
        </View>

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
