import { Fragment } from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface RecapNoteItem {
  productName: string; qtySold: number; qtyRetur: number; qtyReject: number; hargaTitip: number; revenue: number;
}

// Satu rekap harian sumber di dalam halaman gabungan (lihat `sections` di bawah) — item-nya
// TIDAK dijumlahkan dengan tanggal lain, jadi rinciannya tetap terlihat per tanggal.
export interface RecapNoteSection {
  date:         string;
  docNo:        string;
  items:        RecapNoteItem[];
  totalSold:    number;
  totalRetur:   number;
  totalReject:  number;
  totalRevenue: number;
}

export interface RecapNoteData {
  locationName:    string;
  locationCode?:   string;
  warehouseName?:  string;
  date:            string;
  printedAt?:      string;
  docNo?:          string;
  paymentStatus?:  'lunas' | 'belum_lunas';
  note?:           string;
  items:           RecapNoteItem[];
  totalSold:       number;
  totalRetur:      number;
  totalReject:     number;
  totalRevenue:    number;
  // Diisi hanya kalau beberapa rekap mitra yang sama digabung jadi satu halaman — tiap
  // rekap sumber tampil sebagai blok tanggalnya sendiri, `items`/`totalXxx` di atas tetap
  // dipakai sebagai grand total di bagian bawah halaman.
  sections?:       RecapNoteSection[];
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
  docTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.3, textAlign: 'right' },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  docMetaLabel: { fontSize: 8.5, color: C.muted },
  docMetaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoRow: { flexDirection: 'row', gap: 16 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  badge: { alignSelf: 'flex-start', borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7, fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 4 },

  table: { marginTop: 18, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 9, paddingVertical: 6, paddingHorizontal: 6, color: C.dark },

  colNo:     { width: '6%' },
  colName:   { width: '28%' },
  colSold:   { width: '13%', textAlign: 'right' },
  colRetur:  { width: '13%', textAlign: 'right' },
  colReject: { width: '13%', textAlign: 'right' },
  colPrice:  { width: '13%', textAlign: 'right' },
  colRev:    { width: '14%', textAlign: 'right' },

  sectionRow:          { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 5, paddingHorizontal: 6 },
  sectionRowText:      { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.accent },
  sectionRowDocNo:     { fontSize: 7.5, color: C.muted },
  sectionSubtotalRow:  { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: C.border },
  sectionSubtotalText: { fontSize: 8, color: C.muted },
  grandTotalRow:       { flexDirection: 'row', backgroundColor: C.dark, paddingVertical: 6, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: C.border },
  grandTotalText:      { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.white, textTransform: 'uppercase', letterSpacing: 0.5 },

  totalsWrap: { marginTop: 14, alignItems: 'flex-end' },
  totalsBox: { width: '48%', backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  totalsLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  totalsKey: { fontSize: 9, color: C.muted },
  totalsVal: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  totalsFinalKey: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalVal: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent },

  noteBox: { marginTop: 14, padding: 10, backgroundColor: C.accentBg, borderRadius: 6 },
  noteLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', marginBottom: 3 },
  noteText: { fontSize: 9.5, color: C.dark },

  signRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 24 },
  signBox: { width: '42%', alignItems: 'center' },
  signLabel: { fontSize: 9, color: C.muted },
  signArea: { height: 54, width: '100%', position: 'relative', justifyContent: 'flex-end', alignItems: 'center' },
  signStamp: { position: 'absolute', bottom: 2, width: 46, height: 46, opacity: 0.85 },
  signImage: { position: 'absolute', bottom: 8, width: 74, height: 32, objectFit: 'contain' },
  signLine: { borderTopWidth: 1, borderTopColor: C.dark, width: '100%' },
  signName: { fontSize: 9, color: C.muted, marginTop: 4 },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
  pageNo: { position: 'absolute', bottom: 24, right: 40, fontSize: 7.5, color: C.muted },
});

// Just the <Page> — reusable so several recaps can be combined into one multi-page
// Document (one page per recap, each keeping its own location header) for bulk export.
export function RecapNotePDFPage({ data, store }: { data: RecapNoteData; store: StoreHeader }) {
  const isLunas = (data.paymentStatus ?? 'lunas') === 'lunas';
  const sections = data.sections && data.sections.length > 1 ? data.sections : null;
  return (
    <Page size="A4" style={s.page}>
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
            <Text style={s.docTitle}>REKAP HARIAN</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            {data.docNo && (
              <View style={s.docMetaRow}>
                <Text style={s.docMetaLabel}>No:</Text>
                <Text style={s.docMetaValue}>{data.docNo}</Text>
              </View>
            )}
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Tanggal:</Text>
              <Text style={s.docMetaValue}>{data.date}</Text>
            </View>
            {data.printedAt && (
              <View style={s.docMetaRow}>
                <Text style={s.docMetaLabel}>Dicetak:</Text>
                <Text style={s.docMetaValue}>{data.printedAt}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.infoRow}>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Lokasi / Mitra</Text>
            <Text style={s.infoValue}>{data.locationName}{data.locationCode ? `  ·  ${data.locationCode}` : ''}</Text>
            <Text
              style={[s.badge, isLunas
                ? { backgroundColor: C.greenBg, color: C.green }
                : { backgroundColor: C.amberBg, color: C.amber }]}
            >
              {isLunas ? 'LUNAS' : 'BELUM LUNAS'}
            </Text>
          </View>
          {data.warehouseName && (
            <View style={s.infoBox}>
              <Text style={s.infoLabel}>Gudang Tujuan Retur/Reject</Text>
              <Text style={s.infoValue}>{data.warehouseName}</Text>
            </View>
          )}
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colName]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colSold]}>Terjual</Text>
            <Text style={[s.tHeadCell, s.colRetur]}>Retur</Text>
            <Text style={[s.tHeadCell, s.colReject]}>Reject</Text>
            <Text style={[s.tHeadCell, s.colPrice]}>Harga Titip</Text>
            <Text style={[s.tHeadCell, s.colRev]}>Pendapatan</Text>
          </View>
          {sections ? sections.map((section, si) => (
            <Fragment key={si}>
              <View style={s.sectionRow}>
                <Text style={s.sectionRowText}>{section.date}</Text>
                <Text style={s.sectionRowDocNo}>No: {section.docNo}</Text>
              </View>
              {section.items.map((it, i) => (
                <View key={i} style={s.tRow}>
                  <Text style={[s.tCell, s.colNo]}>{i + 1}</Text>
                  <Text style={[s.tCell, s.colName]}>{it.productName}</Text>
                  <Text style={[s.tCell, s.colSold]}>{it.qtySold}</Text>
                  <Text style={[s.tCell, s.colRetur]}>{it.qtyRetur}</Text>
                  <Text style={[s.tCell, s.colReject]}>{it.qtyReject}</Text>
                  <Text style={[s.tCell, s.colPrice]}>{rp(it.hargaTitip)}</Text>
                  <Text style={[s.tCell, s.colRev]}>{rp(it.revenue)}</Text>
                </View>
              ))}
              <View style={s.sectionSubtotalRow}>
                <Text style={s.sectionSubtotalText}>
                  Subtotal: jual {section.totalSold}{section.totalRetur > 0 ? `, retur ${section.totalRetur}` : ''}{section.totalReject > 0 ? `, reject ${section.totalReject}` : ''} · {rp(section.totalRevenue)}
                </Text>
              </View>
            </Fragment>
          )) : data.items.map((it, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]}>
              <Text style={[s.tCell, s.colNo]}>{i + 1}</Text>
              <Text style={[s.tCell, s.colName]}>{it.productName}</Text>
              <Text style={[s.tCell, s.colSold]}>{it.qtySold}</Text>
              <Text style={[s.tCell, s.colRetur]}>{it.qtyRetur}</Text>
              <Text style={[s.tCell, s.colReject]}>{it.qtyReject}</Text>
              <Text style={[s.tCell, s.colPrice]}>{rp(it.hargaTitip)}</Text>
              <Text style={[s.tCell, s.colRev]}>{rp(it.revenue)}</Text>
            </View>
          ))}
          {sections && (
            <View style={s.grandTotalRow}>
              <Text style={s.grandTotalText}>TOTAL KESELURUHAN ({sections.length} REKAP)</Text>
            </View>
          )}
        </View>

        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total Terjual</Text>
              <Text style={s.totalsVal}>{data.totalSold} pcs</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total Retur</Text>
              <Text style={s.totalsVal}>{data.totalRetur} pcs</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total Reject</Text>
              <Text style={s.totalsVal}>{data.totalReject} pcs</Text>
            </View>
            <View style={s.totalsFinalLine}>
              <Text style={s.totalsFinalKey}>Total Pendapatan</Text>
              <Text style={s.totalsFinalVal}>{rp(data.totalRevenue)}</Text>
            </View>
          </View>
        </View>

        {data.note && (
          <View style={s.noteBox}>
            <Text style={s.noteLabel}>Catatan</Text>
            <Text style={s.noteText}>{data.note}</Text>
          </View>
        )}

        <View style={s.signRow}>
          <View style={s.signBox}>
            <Text style={s.signLabel}>Mengetahui,</Text>
            <View style={s.signArea}>
              {store.ownerStamp && <Image src={store.ownerStamp} style={s.signStamp} />}
              {store.ownerSignature && <Image src={store.ownerSignature} style={s.signImage} />}
              <View style={s.signLine} />
            </View>
            <Text style={s.signName}>{store.ownerName || store.name}</Text>
          </View>
        </View>

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => totalPages > 1 ? `${pageNumber} / ${totalPages}` : ''} fixed />
    </Page>
  );
}

export default function RecapNotePDF({ data, store }: { data: RecapNoteData; store: StoreHeader }) {
  return (
    <Document>
      <RecapNotePDFPage data={data} store={store} />
    </Document>
  );
}
