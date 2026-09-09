import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface LocationHistoryEntry {
  kind: 'kirim' | 'rekap';
  date: string;
  description: string;
  amount: number;
  status?: string;
}

export interface LocationHistoryData {
  locationName:     string;
  contactName?:     string;
  contactPhone?:    string;
  address?:         string;
  generatedAt:      string;
  currentStockQty:  number;
  totalKirim:       number;
  totalRevenue:     number;
  totalSold:        number;
  totalRetur:       number;
  totalReject:      number;
  entries:          LocationHistoryEntry[];
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
  greenBg:  '#DCFCE7',
  amber:    '#B45309',
  amberBg:  '#FEF3C7',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, fontSize: 10 },

  topBar: { height: 8, backgroundColor: C.accent, marginTop: -40, marginHorizontal: -40, marginBottom: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 52, height: 52, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  storeName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeTagline: { fontSize: 8.5, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', width: '40%', flexShrink: 0 },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5, textAlign: 'right' },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  docMetaLabel: { fontSize: 8.5, color: C.muted },
  docMetaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoBox: { backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },
  infoSub: { fontSize: 9, color: C.muted, marginTop: 2 },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statBox: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: C.border, padding: 9 },
  statBoxGreen: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: C.green, backgroundColor: C.greenBg, padding: 9 },
  statLabel: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3 },
  statValue: { fontSize: 12.5, fontFamily: 'Helvetica-Bold', color: C.dark },
  statValueGreen: { fontSize: 12.5, fontFamily: 'Helvetica-Bold', color: C.green },

  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark, marginTop: 18, marginBottom: 8 },

  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 8.5, paddingVertical: 6, paddingHorizontal: 6, color: C.dark },

  colDate: { width: '14%' },
  colKind: { width: '12%' },
  colDesc: { width: '54%' },
  colAmount: { width: '20%', textAlign: 'right' },

  badge: { alignSelf: 'flex-start', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5, fontSize: 7, fontFamily: 'Helvetica-Bold' },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
  pageNo: { position: 'absolute', bottom: 24, right: 40, fontSize: 7.5, color: C.muted },
});

export default function LocationHistoryPDF({ data, store }: { data: LocationHistoryData; store: StoreHeader }) {
  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        <View style={s.topBar} />

        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {store.logo && <Image src={store.logo} style={s.logo} />}
            <View style={s.storeInfo}>
              <Text style={s.storeName}>{store.name}</Text>
              {store.tagline && <Text style={s.storeTagline}>{store.tagline}</Text>}
              {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
              {store.phone && <Text style={s.storeMeta}>{store.phone}</Text>}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>RIWAYAT KONSINYASI</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Dicetak:</Text>
              <Text style={s.docMetaValue}>{data.generatedAt}</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.infoBox}>
          <Text style={s.infoLabel}>Lokasi / Mitra</Text>
          <Text style={s.infoValue}>{data.locationName}</Text>
          {data.contactName && <Text style={s.infoSub}>{data.contactName}</Text>}
          {data.contactPhone && <Text style={s.infoSub}>{data.contactPhone}</Text>}
          {data.address && <Text style={s.infoSub}>{data.address}</Text>}
        </View>

        <View style={s.statsRow}>
          <View style={s.statBox}>
            <Text style={s.statLabel}>Stok Saat Ini</Text>
            <Text style={s.statValue}>{data.currentStockQty} pcs</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statLabel}>Total Dikirim</Text>
            <Text style={s.statValue}>{rp(data.totalKirim)}</Text>
          </View>
          <View style={s.statBoxGreen}>
            <Text style={s.statLabel}>Total Pendapatan</Text>
            <Text style={s.statValueGreen}>{rp(data.totalRevenue)}</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statLabel}>Jual / Retur / Reject</Text>
            <Text style={s.statValue}>{data.totalSold} / {data.totalRetur} / {data.totalReject}</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>Linimasa ({data.entries.length})</Text>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colDate]}>Tanggal</Text>
            <Text style={[s.tHeadCell, s.colKind]}>Jenis</Text>
            <Text style={[s.tHeadCell, s.colDesc]}>Detail</Text>
            <Text style={[s.tHeadCell, s.colAmount]}>Nominal</Text>
          </View>
          {data.entries.map((e, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
              <Text style={[s.tCell, s.colDate]}>{e.date}</Text>
              <View style={[s.tCell, s.colKind]}>
                <Text
                  style={[s.badge, e.kind === 'kirim'
                    ? { backgroundColor: C.accentBg, color: C.accent }
                    : { backgroundColor: C.greenBg, color: C.green }]}
                >
                  {e.kind === 'kirim' ? 'KIRIM' : 'REKAP'}
                </Text>
                {e.status && (
                  <Text style={[s.badge, { backgroundColor: C.amberBg, color: C.amber, marginTop: 3 }]}>{e.status}</Text>
                )}
              </View>
              <Text style={[s.tCell, s.colDesc]}>{e.description}</Text>
              <Text style={[s.tCell, s.colAmount]}>{rp(e.amount)}</Text>
            </View>
          ))}
        </View>

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
