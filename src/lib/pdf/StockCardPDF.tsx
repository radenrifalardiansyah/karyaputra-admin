import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface StockCardMovementRow {
  date: string;
  tipe: string;
  lokasi: string;
  note?: string;
  debit: number;
  kredit: number;
  saldo: number;
}

export interface StockCardPDFData {
  productName: string;
  category?: string;
  periodLabel: string;
  from: string;
  to: string;
  whLabel: string;
  stokAwal: number;
  masuk: number;
  keluar: number;
  stokAkhir: number;
  movements: StockCardMovementRow[];
}

const C = {
  accent:   THEME_COLOR,
  accentBg: '#F0FDF4',
  dark:     '#1E1008',
  muted:    '#A08468',
  border:   '#E6DDD0',
  white:    '#FFFFFF',
  green:    '#15803D',
  greenBg:  '#DCFCE7',
  red:      '#DC2626',
  redBg:    '#FEF2F2',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, fontSize: 9.5 },

  topBar: { height: 8, backgroundColor: C.accent, marginTop: -40, marginHorizontal: -40, marginBottom: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 52, height: 52, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
  storeName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeTagline: { fontSize: 8.5, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5 },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  docMetaLabel: { fontSize: 8.5, color: C.muted },
  docMetaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoRow: { flexDirection: 'row', gap: 12 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  summaryBox: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: C.border, padding: 9 },
  summaryLabel: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3 },
  summaryValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },

  table: { marginTop: 18, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 8, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 5 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tRowMuted: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: '#F5F0E9' },
  tCell: { fontSize: 8.5, paddingVertical: 5, paddingHorizontal: 5, color: C.dark },
  tCellMuted: { fontSize: 8.5, fontFamily: 'Helvetica-Oblique', paddingVertical: 5, paddingHorizontal: 5, color: C.muted },

  colDate:   { width: '13%' },
  colTipe:   { width: '11%' },
  colLokasi: { width: '22%' },
  colNote:   { width: '22%' },
  colDebit:  { width: '11%', textAlign: 'right' },
  colKredit: { width: '11%', textAlign: 'right' },
  colSaldo:  { width: '10%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
  pageNo: { position: 'absolute', bottom: 24, right: 40, fontSize: 7.5, color: C.muted },
});

const TIPE_COLOR: Record<string, string> = {
  Masuk: C.green, Keluar: C.red, Reject: C.red, Transfer: '#0284C7',
};

export default function StockCardPDF({ data, store }: { data: StockCardPDFData; store: StoreHeader }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.topBar} />

        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {store.logo && <Image src={store.logo} style={s.logo} />}
            <View>
              <Text style={s.storeName}>{store.name}</Text>
              {store.tagline && <Text style={s.storeTagline}>{store.tagline}</Text>}
              {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
              {store.phone && <Text style={s.storeMeta}>{store.phone}</Text>}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>KARTU STOK</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Periode:</Text>
              <Text style={s.docMetaValue}>{data.periodLabel} ({data.from} s/d {data.to})</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.infoRow}>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Produk</Text>
            <Text style={s.infoValue}>{data.productName}</Text>
            {data.category && <Text style={s.storeMeta}>{data.category}</Text>}
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Gudang</Text>
            <Text style={s.infoValue}>{data.whLabel}</Text>
          </View>
        </View>

        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Stok Awal</Text>
            <Text style={[s.summaryValue, { color: C.dark }]}>{data.stokAwal}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Masuk</Text>
            <Text style={[s.summaryValue, { color: C.green }]}>+{data.masuk}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Keluar</Text>
            <Text style={[s.summaryValue, { color: C.red }]}>–{data.keluar}</Text>
          </View>
          <View style={[s.summaryBox, { backgroundColor: C.accentBg, borderColor: C.accent }]}>
            <Text style={s.summaryLabel}>Stok Akhir</Text>
            <Text style={[s.summaryValue, { color: C.accent }]}>{data.stokAkhir}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colDate]}>Tanggal</Text>
            <Text style={[s.tHeadCell, s.colTipe]}>Tipe</Text>
            <Text style={[s.tHeadCell, s.colLokasi]}>Lokasi</Text>
            <Text style={[s.tHeadCell, s.colNote]}>Keterangan</Text>
            <Text style={[s.tHeadCell, s.colDebit]}>Debit</Text>
            <Text style={[s.tHeadCell, s.colKredit]}>Kredit</Text>
            <Text style={[s.tHeadCell, s.colSaldo]}>Saldo</Text>
          </View>
          <View style={s.tRowMuted}>
            <Text style={[s.tCellMuted, { width: '79%' }]}>Saldo Awal Periode</Text>
            <Text style={[s.tCell, s.colSaldo]}>{data.stokAwal}</Text>
          </View>
          {data.movements.map((m, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]}>
              <Text style={[s.tCell, s.colDate]}>{m.date}</Text>
              <Text style={[s.tCell, s.colTipe, { color: TIPE_COLOR[m.tipe] ?? C.dark, fontFamily: 'Helvetica-Bold' }]}>{m.tipe}</Text>
              <Text style={[s.tCell, s.colLokasi]}>{m.lokasi}</Text>
              <Text style={[s.tCell, s.colNote]}>{m.note || '–'}</Text>
              <Text style={[s.tCell, s.colDebit, { color: m.debit > 0 ? C.green : C.muted }]}>{m.debit > 0 ? `+${m.debit}` : '–'}</Text>
              <Text style={[s.tCell, s.colKredit, { color: m.kredit > 0 ? C.red : C.muted }]}>{m.kredit > 0 ? `–${m.kredit}` : '–'}</Text>
              <Text style={[s.tCell, s.colSaldo]}>{m.saldo}</Text>
            </View>
          ))}
          <View style={s.tRowMuted}>
            <Text style={[s.tCellMuted, { width: '79%', fontFamily: 'Helvetica-Bold', color: C.dark }]}>Saldo Akhir</Text>
            <Text style={[s.tCell, s.colSaldo, { color: C.accent }]}>{data.stokAkhir}</Text>
          </View>
        </View>

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
