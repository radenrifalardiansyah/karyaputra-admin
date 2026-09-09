import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface FinanceReportIncomeRow { label: string; amount: number }
export interface FinanceReportExpenseRow { category: string; amount: number; foldedIntoHpp: boolean }
export interface FinanceReportJournalRow {
  tanggal: string; jam: string; keterangan: string; debit: number; kredit: number; saldo: number;
}

export interface FinanceReportPDFData {
  periodLabel: string;
  from: string;
  to: string;
  incomeRows: FinanceReportIncomeRow[];
  totalPendapatan: number;
  hpp: number;
  labaKotor: number;
  expenseRows: FinanceReportExpenseRow[];
  totalBeban: number;
  totalBebanOperasional: number;
  labaBersih: number;
  totalModalMasuk: number;
  totalPrive: number;
  saldoAwal: number;
  journal: FinanceReportJournalRow[];
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
  greenBg:  '#F0FDF4',
  red:      '#DC2626',
  redBg:    '#FEF2F2',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 36, fontSize: 9 },

  topBar: { height: 7, backgroundColor: C.accent, marginTop: -36, marginHorizontal: -36, marginBottom: 18 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 44, height: 44, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeTagline: { fontSize: 8, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8, color: C.muted, marginTop: 1 },
  headerRight: { alignItems: 'flex-end', width: '46%', flexShrink: 0 },
  docTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5, textAlign: 'right' },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  docMetaRow: { marginTop: 4, alignItems: 'flex-end' },
  docMetaLabel: { fontSize: 7, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  docMetaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark, textAlign: 'right', marginTop: 1 },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 10, marginBottom: 12 },

  summaryRow: { flexDirection: 'row', gap: 7 },
  summaryBox: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: C.border, padding: 7 },
  summaryLabel: { fontSize: 6.6, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.2, marginBottom: 2 },
  summaryValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold' },

  panelRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  panel: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, paddingVertical: 6, paddingHorizontal: 8 },
  panelHeadText: { color: C.white, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  panelRow2: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: C.border },
  panelLabel: { flex: 1, fontSize: 8.5, color: C.dark },
  panelLabelPlain: { fontSize: 8.5, color: C.dark },
  panelSub: { fontSize: 6.8, color: C.muted, marginTop: 1 },
  panelValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', width: 82, textAlign: 'right' },
  panelPct: { fontSize: 7.5, color: C.muted, width: 28, textAlign: 'right' },
  panelFootNote: { fontSize: 7, color: C.muted, padding: 8, borderTopWidth: 1, borderTopColor: C.border },
  panelEmpty: { fontSize: 8, color: C.muted, textAlign: 'center', paddingVertical: 16 },

  modalPriveBox: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12, padding: 9, borderRadius: 6, backgroundColor: C.accentBg },
  modalPriveLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.muted, textTransform: 'uppercase' },
  modalPriveVal: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },

  table: { marginTop: 14, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 5 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 8, paddingVertical: 4.5, paddingHorizontal: 5, color: C.dark },

  colTgl:    { width: '13%' },
  colJam:    { width: '9%' },
  colKet:    { width: '39%' },
  colDebit:  { width: '13%', textAlign: 'right' },
  colKredit: { width: '13%', textAlign: 'right' },
  colSaldo:  { width: '13%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 20, right: 36, fontSize: 7, color: C.muted },
});

function ReportHeader({ store, title, metaRows }: { store: StoreHeader; title: string; metaRows: { label: string; value: string }[] }) {
  return (
    <>
      <View style={s.topBar} />
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          {store.logo && <Image src={store.logo} style={s.logo} />}
          <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
            <Text style={s.storeName}>{store.name}</Text>
            {store.tagline && <Text style={s.storeTagline}>{store.tagline}</Text>}
            {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
          </View>
        </View>
        <View style={s.headerRight}>
          <Text style={s.docTitle}>{title}</Text>
          <Text style={s.docSub}>Dokumen Internal</Text>
          {metaRows.map((m, i) => (
            <View key={i} style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>{m.label}:</Text>
              <Text style={s.docMetaValue}>{m.value}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={s.divider} />
    </>
  );
}

export default function FinanceReportPDF({ data, store }: { data: FinanceReportPDFData; store: StoreHeader }) {
  const totalDebit  = data.journal.reduce((sum, j) => sum + j.debit, 0);
  const totalKredit = data.journal.reduce((sum, j) => sum + j.kredit, 0);
  const saldoAkhir  = data.journal.length > 0 ? data.journal[data.journal.length - 1].saldo : data.saldoAwal;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <ReportHeader
          store={store}
          title="LAPORAN LABA RUGI"
          metaRows={[{ label: 'Periode', value: `${data.periodLabel} (${data.from} s/d ${data.to})` }]}
        />

        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Omzet</Text>
            <Text style={[s.summaryValue, { color: C.green }]}>{rp(data.totalPendapatan)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>HPP</Text>
            <Text style={[s.summaryValue, { color: '#B45309' }]}>{rp(data.hpp)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Laba Kotor</Text>
            <Text style={[s.summaryValue, { color: C.accent }]}>{rp(data.labaKotor)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Beban Operasional</Text>
            <Text style={[s.summaryValue, { color: C.red }]}>{rp(data.totalBebanOperasional)}</Text>
          </View>
          <View style={[s.summaryBox, { backgroundColor: C.accentBg, borderColor: C.accent }]}>
            <Text style={s.summaryLabel}>{data.labaBersih >= 0 ? 'Laba Bersih' : 'Rugi Bersih'}</Text>
            <Text style={[s.summaryValue, { color: data.labaBersih >= 0 ? C.accent : C.red }]}>{rp(data.labaBersih)}</Text>
          </View>
        </View>

        <View style={s.panelRow}>
          <View style={s.panel}>
            <View style={s.panelHead}>
              <Text style={s.panelHeadText}>Rincian Pendapatan</Text>
            </View>
            {data.incomeRows.map((r, i) => (
              <View key={i} style={s.panelRow2}>
                <Text style={s.panelLabel}>{r.label}</Text>
                <Text style={[s.panelValue, { color: C.green }]}>{rp(r.amount)}</Text>
                <Text style={s.panelPct}>{data.totalPendapatan > 0 ? Math.round((r.amount / data.totalPendapatan) * 100) : 0}%</Text>
              </View>
            ))}
          </View>

          <View style={s.panel}>
            <View style={s.panelHead}>
              <Text style={s.panelHeadText}>Rincian Beban (Kas)</Text>
            </View>
            {data.expenseRows.length === 0 ? (
              <Text style={s.panelEmpty}>Tidak ada pengeluaran di periode ini.</Text>
            ) : (
              <>
                {data.expenseRows.map((r, i) => (
                  <View key={i} style={s.panelRow2}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.panelLabelPlain}>{r.category}</Text>
                      {r.foldedIntoHpp && <Text style={s.panelSub}>{'-> masuk HPP saat terjual'}</Text>}
                    </View>
                    <Text style={[s.panelValue, { color: C.red }]}>{rp(r.amount)}</Text>
                    <Text style={s.panelPct}>{data.totalBeban > 0 ? Math.round((r.amount / data.totalBeban) * 100) : 0}%</Text>
                  </View>
                ))}
                <Text style={s.panelFootNote}>
                  Total kas keluar periode ini: {rp(data.totalBeban)}. Baris bertanda &quot;masuk HPP&quot; sudah dihitung sebagai HPP saat barangnya laku, tidak dijumlah lagi di Beban Operasional.
                </Text>
              </>
            )}
          </View>
        </View>

        {(data.totalModalMasuk > 0 || data.totalPrive > 0) && (
          <View style={s.modalPriveBox}>
            <Text style={s.modalPriveLabel}>Di luar Laba Rugi operasional:</Text>
            <Text style={[s.modalPriveVal, { color: C.green }]}>Modal Masuk {rp(data.totalModalMasuk)}</Text>
            <Text style={[s.modalPriveVal, { color: C.red }]}>Prive {rp(data.totalPrive)}</Text>
          </View>
        )}

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>

      <Page size="A4" style={s.page}>
        <ReportHeader
          store={store}
          title="JURNAL KAS"
          metaRows={[
            { label: 'Periode', value: `${data.periodLabel} (${data.from} s/d ${data.to})` },
            { label: 'Saldo Awal', value: rp(data.saldoAwal) },
          ]}
        />

        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Saldo Awal</Text>
            <Text style={[s.summaryValue, { color: C.dark }]}>{rp(data.saldoAwal)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Debit</Text>
            <Text style={[s.summaryValue, { color: C.green }]}>{rp(totalDebit)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Kredit</Text>
            <Text style={[s.summaryValue, { color: C.red }]}>{rp(totalKredit)}</Text>
          </View>
          <View style={[s.summaryBox, { backgroundColor: C.accentBg, borderColor: C.accent }]}>
            <Text style={s.summaryLabel}>Saldo Akhir</Text>
            <Text style={[s.summaryValue, { color: C.accent }]}>{rp(saldoAkhir)}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colTgl]}>Tanggal</Text>
            <Text style={[s.tHeadCell, s.colJam]}>Jam</Text>
            <Text style={[s.tHeadCell, s.colKet]}>Keterangan</Text>
            <Text style={[s.tHeadCell, s.colDebit]}>Debit</Text>
            <Text style={[s.tHeadCell, s.colKredit]}>Kredit</Text>
            <Text style={[s.tHeadCell, s.colSaldo]}>Saldo</Text>
          </View>
          {data.journal.length === 0 ? (
            <View style={s.tRow}>
              <Text style={[s.tCell, { width: '100%', textAlign: 'center', color: C.muted, paddingVertical: 14 }]}>
                Tidak ada transaksi di periode ini.
              </Text>
            </View>
          ) : (
            data.journal.map((j, i) => (
              <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
                <Text style={[s.tCell, s.colTgl]}>{j.tanggal}</Text>
                <Text style={[s.tCell, s.colJam]}>{j.jam}</Text>
                <Text style={[s.tCell, s.colKet]}>{j.keterangan}</Text>
                <Text style={[s.tCell, s.colDebit, { color: j.debit > 0 ? C.green : C.muted }]}>{j.debit > 0 ? rp(j.debit) : '–'}</Text>
                <Text style={[s.tCell, s.colKredit, { color: j.kredit > 0 ? C.red : C.muted }]}>{j.kredit > 0 ? rp(j.kredit) : '–'}</Text>
                <Text style={[s.tCell, s.colSaldo]}>{rp(j.saldo)}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
