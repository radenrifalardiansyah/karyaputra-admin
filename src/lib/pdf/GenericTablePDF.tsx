import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

// Tabel generik untuk daftar data master/laporan flat (Produk, Pelanggan, Kategori, Pengguna,
// dst) — dipakai berkali-kali oleh tab yang kolomnya cuma "No + beberapa kolom + baris data",
// dibanding bikin satu file layout PDF khusus per tab seperti LocationsListPDF/ProductReportPDF
// (yang punya kartu summary/section khusus dan memang butuh layout sendiri).
export interface GenericTableColumn {
  header: string;
  width: string; // persentase, mis. '10%' — total semua kolom idealnya 100%
  align?: 'left' | 'right' | 'center';
  bold?: boolean;
}

export interface GenericTablePDFData {
  title: string;                 // mis. "DAFTAR PRODUK"
  label: string;                 // mis. "sesuai filter" / "terpilih"
  generatedAt: string;
  columns: GenericTableColumn[];
  // Tiap baris = array nilai sel, urutannya mengikuti `columns`. Hindari karakter di luar
  // WinAnsi/Latin-1 — font standar react-pdf (Helvetica) cuma punya glyph situ, jadi emoji
  // ATAU simbol Unicode seperti tanda minus "−" (U+2212, beda dari "-" biasa) hilang/rusak
  // saat dirender. Lihat CategoriesTab.tsx (kolom Emoji sengaja tidak disertakan di PDF) dan
  // OrdersTab.tsx (pakai "-" biasa untuk diskon, bukan "−").
  rows: (string | number)[][];
}

const C = {
  accent: THEME_COLOR, accentBg: '#F0FDF4', dark: '#1E1008', muted: '#A08468',
  border: '#E6DDD0', white: '#FFFFFF',
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
  countLine: { fontSize: 8.5, color: C.muted, marginBottom: 10 },

  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 4 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 8, paddingVertical: 4.5, paddingHorizontal: 4, color: C.dark },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: C.muted },
});

function cellText(v: string | number | undefined | null): string {
  return v === undefined || v === null || v === '' ? '–' : String(v);
}

export default function GenericTablePDF({ data, store }: { data: GenericTablePDFData; store: StoreHeader }) {
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
            <Text style={s.docTitle}>{data.title}</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Dicetak:</Text>
              <Text style={s.docMetaValue}>{data.generatedAt}</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />
        <Text style={s.countLine}>{data.rows.length} baris ({data.label})</Text>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            {data.columns.map((c, i) => (
              <Text key={i} style={[s.tHeadCell, { width: c.width, textAlign: c.align ?? 'left' }]}>{c.header}</Text>
            ))}
          </View>
          {data.rows.map((row, ri) => (
            <View key={ri} style={[s.tRow, ...(ri % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
              {row.map((cell, ci) => {
                const col = data.columns[ci];
                return (
                  <Text
                    key={ci}
                    style={[
                      s.tCell,
                      { width: col?.width ?? 'auto', textAlign: col?.align ?? 'left' },
                      col?.bold ? { fontFamily: 'Helvetica-Bold' } : {},
                    ]}
                  >
                    {cellText(cell)}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
