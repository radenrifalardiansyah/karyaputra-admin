import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface StockReportPDFRow {
  no: number;
  productName: string;
  category?: string;
  stokAwal: number;
  masuk: number;
  keluar: number;
  stokAkhir: number;
  hpp: number;
  nilai: number;
  status: string;
}

export interface StockReportPDFData {
  periodLabel: string;
  from: string;
  to: string;
  whLabel: string;
  totalNilai: number;
  totalUnit: number;
  jenisProduk: number;
  rendahCount: number;
  habisCount: number;
  masukQty: number;
  keluarQty: number;
  transferCt: number;
  netQty: number;
  rows: StockReportPDFRow[];
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
  red:      '#DC2626',
  amber:    '#15803D',
  amberBg:  '#F0FDF4',
  redBg:    '#FEF2F2',
  greenBg:  '#F0FDF4',
};

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  Habis:   { color: C.red,   bg: C.redBg   },
  Rendah:  { color: C.amber, bg: C.amberBg },
  Normal:  { color: C.green, bg: C.greenBg },
  'Open PO': { color: C.amber, bg: C.amberBg },
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

  colNo:      { width: '4%' },
  colProduk:  { width: '20%' },
  colKat:     { width: '11%' },
  colAwal:    { width: '8%', textAlign: 'right' },
  colMasuk:   { width: '8%', textAlign: 'right' },
  colKeluar:  { width: '8%', textAlign: 'right' },
  colAkhir:   { width: '8%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  colHpp:     { width: '11%', textAlign: 'right' },
  colNilai:   { width: '12%', textAlign: 'right' },
  colStatus:  { width: '10%', textAlign: 'center' },

  statusBadge: { borderRadius: 3, paddingVertical: 2, paddingHorizontal: 4, fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center' },

  totalsRow: { flexDirection: 'row', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border },
  totalsCell: { fontSize: 8, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 4, color: C.dark },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: C.muted },
});

export default function StockReportPDF({ data, store }: { data: StockReportPDFData; store: StoreHeader }) {
  const totalMasuk  = data.rows.reduce((sum, r) => sum + r.masuk, 0);
  const totalKeluar = data.rows.reduce((sum, r) => sum + r.keluar, 0);
  const totalAkhir  = data.rows.reduce((sum, r) => sum + r.stokAkhir, 0);
  const totalAwal   = data.rows.reduce((sum, r) => sum + r.stokAwal, 0);

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
            <Text style={s.docTitle}>LAPORAN STOK</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Gudang:</Text>
              <Text style={s.docMetaValue}>{data.whLabel}</Text>
            </View>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Periode:</Text>
              <Text style={s.docMetaValue}>{data.periodLabel} ({data.from} s/d {data.to})</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Nilai Stok (HPP)</Text>
            <Text style={[s.summaryValue, { color: C.accent }]}>{rp(data.totalNilai)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Unit</Text>
            <Text style={[s.summaryValue, { color: C.dark }]}>{data.totalUnit}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Jenis Produk</Text>
            <Text style={[s.summaryValue, { color: C.dark }]}>{data.jenisProduk}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Stok Rendah</Text>
            <Text style={[s.summaryValue, { color: C.amber }]}>{data.rendahCount}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Stok Habis</Text>
            <Text style={[s.summaryValue, { color: C.red }]}>{data.habisCount}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Masuk (Periode)</Text>
            <Text style={[s.summaryValue, { color: C.green }]}>+{data.masukQty}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Keluar (Periode)</Text>
            <Text style={[s.summaryValue, { color: C.red }]}>–{data.keluarQty}</Text>
          </View>
          <View style={[s.summaryBox, { backgroundColor: C.accentBg, borderColor: C.accent }]}>
            <Text style={s.summaryLabel}>Net Perubahan</Text>
            <Text style={[s.summaryValue, { color: data.netQty >= 0 ? C.green : C.red }]}>
              {data.netQty >= 0 ? '+' : ''}{data.netQty}
            </Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colProduk]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colKat]}>Kategori</Text>
            <Text style={[s.tHeadCell, s.colAwal]}>Awal</Text>
            <Text style={[s.tHeadCell, s.colMasuk]}>Masuk</Text>
            <Text style={[s.tHeadCell, s.colKeluar]}>Keluar</Text>
            <Text style={[s.tHeadCell, s.colAkhir]}>Akhir</Text>
            <Text style={[s.tHeadCell, s.colHpp]}>HPP</Text>
            <Text style={[s.tHeadCell, s.colNilai]}>Nilai Stok</Text>
            <Text style={[s.tHeadCell, s.colStatus]}>Status</Text>
          </View>
          {data.rows.map((r, i) => {
            const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.Normal;
            return (
              <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
                <Text style={[s.tCell, s.colNo]}>{r.no}</Text>
                <Text style={[s.tCell, s.colProduk]}>{r.productName}</Text>
                <Text style={[s.tCell, s.colKat]}>{r.category || '–'}</Text>
                <Text style={[s.tCell, s.colAwal]}>{r.stokAwal}</Text>
                <Text style={[s.tCell, s.colMasuk, { color: r.masuk > 0 ? C.green : C.muted }]}>{r.masuk > 0 ? `+${r.masuk}` : '–'}</Text>
                <Text style={[s.tCell, s.colKeluar, { color: r.keluar > 0 ? C.red : C.muted }]}>{r.keluar > 0 ? `–${r.keluar}` : '–'}</Text>
                <Text style={[s.tCell, s.colAkhir]}>{r.stokAkhir}</Text>
                <Text style={[s.tCell, s.colHpp]}>{rp(r.hpp)}</Text>
                <Text style={[s.tCell, s.colNilai, { fontFamily: 'Helvetica-Bold', color: C.accent }]}>{rp(r.nilai)}</Text>
                <View style={[s.tCell, s.colStatus, { paddingVertical: 2 }]}>
                  <Text style={[s.statusBadge, { color: st.color, backgroundColor: st.bg }]}>{r.status}</Text>
                </View>
              </View>
            );
          })}
          <View style={s.totalsRow}>
            <Text style={[s.totalsCell, s.colNo]} />
            <Text style={[s.totalsCell, s.colProduk]}>Total</Text>
            <Text style={[s.totalsCell, s.colKat]} />
            <Text style={[s.totalsCell, s.colAwal]}>{totalAwal}</Text>
            <Text style={[s.totalsCell, s.colMasuk, { color: C.green }]}>+{totalMasuk}</Text>
            <Text style={[s.totalsCell, s.colKeluar, { color: C.red }]}>–{totalKeluar}</Text>
            <Text style={[s.totalsCell, s.colAkhir]}>{totalAkhir}</Text>
            <Text style={[s.totalsCell, s.colHpp]} />
            <Text style={[s.totalsCell, s.colNilai, { color: C.accent }]}>{rp(data.totalNilai)}</Text>
            <Text style={[s.totalsCell, s.colStatus]} />
          </View>
        </View>

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
