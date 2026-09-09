import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface LocationsListPDFRow {
  no:           number;
  name:         string;
  contactName?: string;
  contactPhone?:string;
  address?:     string;
  stockQty:     number;
  stockValue:   number;
  note?:        string;
}

export interface LocationsListPDFData {
  label:        string;
  generatedAt:  string;
  totalStock:   number;
  totalValue:   number;
  rows:         LocationsListPDFRow[];
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
  colNama:    { width: '16%' },
  colKontak:  { width: '13%' },
  colTelepon: { width: '11%' },
  colAlamat:  { width: '20%' },
  colStok:    { width: '9%',  textAlign: 'right' },
  colNilai:   { width: '13%', textAlign: 'right' },
  colCatatan: { width: '13%' },

  totalsRow: { flexDirection: 'row', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border },
  totalsCell: { fontSize: 8, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 4, color: C.dark },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: C.muted },
});

export default function LocationsListPDF({ data, store }: { data: LocationsListPDFData; store: StoreHeader }) {
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
            <Text style={s.docTitle}>LOKASI KONSINYASI</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Dicetak:</Text>
              <Text style={s.docMetaValue}>{data.generatedAt}</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Jumlah Lokasi</Text>
            <Text style={[s.summaryValue, { color: C.dark }]}>{data.rows.length} ({data.label})</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Stok Titip</Text>
            <Text style={[s.summaryValue, { color: C.green }]}>{data.totalStock} pcs</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Nilai Stok Titip</Text>
            <Text style={[s.summaryValue, { color: C.accent }]}>{rp(data.totalValue)}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colNama]}>Nama Lokasi</Text>
            <Text style={[s.tHeadCell, s.colKontak]}>Kontak</Text>
            <Text style={[s.tHeadCell, s.colTelepon]}>Telepon</Text>
            <Text style={[s.tHeadCell, s.colAlamat]}>Alamat</Text>
            <Text style={[s.tHeadCell, s.colStok]}>Stok (pcs)</Text>
            <Text style={[s.tHeadCell, s.colNilai]}>Nilai Stok</Text>
            <Text style={[s.tHeadCell, s.colCatatan]}>Catatan</Text>
          </View>
          {data.rows.map((r, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
              <Text style={[s.tCell, s.colNo]}>{r.no}</Text>
              <Text style={[s.tCell, s.colNama, { fontFamily: 'Helvetica-Bold' }]}>{r.name}</Text>
              <Text style={[s.tCell, s.colKontak]}>{r.contactName || '–'}</Text>
              <Text style={[s.tCell, s.colTelepon]}>{r.contactPhone || '–'}</Text>
              <Text style={[s.tCell, s.colAlamat]}>{r.address || '–'}</Text>
              <Text style={[s.tCell, s.colStok]}>{r.stockQty}</Text>
              <Text style={[s.tCell, s.colNilai, { fontFamily: 'Helvetica-Bold', color: C.accent }]}>{rp(r.stockValue)}</Text>
              <Text style={[s.tCell, s.colCatatan]}>{r.note || '–'}</Text>
            </View>
          ))}
          <View style={s.totalsRow}>
            <Text style={[s.totalsCell, s.colNo]} />
            <Text style={[s.totalsCell, s.colNama]}>Total ({data.rows.length} lokasi)</Text>
            <Text style={[s.totalsCell, s.colKontak]} />
            <Text style={[s.totalsCell, s.colTelepon]} />
            <Text style={[s.totalsCell, s.colAlamat]} />
            <Text style={[s.totalsCell, s.colStok]}>{data.totalStock}</Text>
            <Text style={[s.totalsCell, s.colNilai, { color: C.accent }]}>{rp(data.totalValue)}</Text>
            <Text style={[s.totalsCell, s.colCatatan]} />
          </View>
        </View>

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
