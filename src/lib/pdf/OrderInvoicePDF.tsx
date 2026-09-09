import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface OrderInvoiceItem { name: string; weight?: string; qty: number; price: number; subtotal: number }

export interface OrderInvoiceData {
  invoiceNo:      string;
  date:           string;
  printedAt?:     string;
  customerName:   string;
  customerPhone?: string;
  deliveryMethod?: 'pickup' | 'delivery';
  address?:       string;
  note?:          string;
  items:          OrderInvoiceItem[];
  subtotal:       number;
  discount?:      { amount: number; label: string };
  total:          number;
  paymentMethod?: 'cash' | 'transfer' | 'qris' | 'kredit';
  paymentStatus?: 'lunas' | 'belum_lunas';
  amountPaid?:    number;
  changeAmount?:  number;
  transferBank?:  string;
  transferAmount?: number;
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const PAYMENT_LABEL: Record<string, string> = { cash: 'Tunai', transfer: 'Transfer', qris: 'QRIS', kredit: 'Kredit' };

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
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  docMetaLabel: { fontSize: 8.5, color: C.muted },
  docMetaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoRow: { flexDirection: 'row', gap: 16 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },
  infoSub: { fontSize: 9, color: C.muted, marginTop: 2 },
  badge: { alignSelf: 'flex-start', borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7, fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 4 },

  table: { marginTop: 18, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 9, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 8 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 9.5, paddingVertical: 6, paddingHorizontal: 8, color: C.dark },

  colNo:    { width: '8%' },
  colName:  { width: '42%' },
  colQty:   { width: '14%', textAlign: 'right' },
  colPrice: { width: '18%', textAlign: 'right' },
  colSub:   { width: '18%', textAlign: 'right' },

  totalsWrap: { marginTop: 14, alignItems: 'flex-end' },
  totalsBox: { width: '48%', backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  totalsLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  totalsKey: { fontSize: 9, color: C.muted },
  totalsVal: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  totalsFinalKey: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalVal: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent },
  paymentLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  paymentKey: { fontSize: 8.5, color: C.muted },
  paymentVal: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  noteBox: { marginTop: 14, padding: 10, backgroundColor: C.accentBg, borderRadius: 6 },
  noteLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', marginBottom: 3 },
  noteText: { fontSize: 9.5, color: C.dark },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
});

export default function OrderInvoicePDF({ data, store }: { data: OrderInvoiceData; store: StoreHeader }) {
  const isLunas = (data.paymentStatus ?? 'lunas') === 'lunas';
  return (
    <Document>
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
            <Text style={s.docTitle}>INVOICE</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>No:</Text>
              <Text style={s.docMetaValue}>{data.invoiceNo}</Text>
            </View>
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
            <Text style={s.infoLabel}>Pelanggan</Text>
            <Text style={s.infoValue}>{data.customerName}</Text>
            {data.customerPhone && <Text style={s.infoSub}>{data.customerPhone}</Text>}
            {data.deliveryMethod && (
              <Text style={s.infoSub}>{data.deliveryMethod === 'delivery' ? `Delivery — ${data.address || '-'}` : 'Ambil Sendiri (Pickup)'}</Text>
            )}
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Pembayaran</Text>
            <Text style={s.infoValue}>{data.paymentMethod ? PAYMENT_LABEL[data.paymentMethod] : '-'}</Text>
            <Text
              style={[s.badge, isLunas
                ? { backgroundColor: C.greenBg, color: C.green }
                : { backgroundColor: C.amberBg, color: C.amber }]}
            >
              {isLunas ? 'LUNAS' : 'BELUM LUNAS'}
            </Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colName]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colQty]}>Qty</Text>
            <Text style={[s.tHeadCell, s.colPrice]}>Harga</Text>
            <Text style={[s.tHeadCell, s.colSub]}>Subtotal</Text>
          </View>
          {data.items.map((it, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]}>
              <Text style={[s.tCell, s.colNo]}>{i + 1}</Text>
              <Text style={[s.tCell, s.colName]}>{it.name}{it.weight ? ` (${it.weight})` : ''}</Text>
              <Text style={[s.tCell, s.colQty]}>{it.qty}</Text>
              <Text style={[s.tCell, s.colPrice]}>{rp(it.price)}</Text>
              <Text style={[s.tCell, s.colSub]}>{rp(it.subtotal)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Subtotal</Text>
              <Text style={s.totalsVal}>{rp(data.subtotal)}</Text>
            </View>
            {data.discount && data.discount.amount > 0 && (
              <View style={s.totalsLine}>
                <Text style={[s.totalsKey, { color: C.green }]}>Diskon ({data.discount.label})</Text>
                {/* "-" biasa, bukan tanda minus Unicode (−, U+2212) — font standar react-pdf
                    tidak punya glyph itu, hasilnya karakter hilang di invoice yang dikirim ke pelanggan. */}
                <Text style={[s.totalsVal, { color: C.green }]}>- {rp(data.discount.amount)}</Text>
              </View>
            )}
            <View style={s.totalsFinalLine}>
              <Text style={s.totalsFinalKey}>Total</Text>
              <Text style={s.totalsFinalVal}>{rp(data.total)}</Text>
            </View>
            {data.paymentMethod === 'cash' && data.amountPaid != null && (
              <View style={s.paymentLine}>
                <Text style={s.paymentKey}>Dibayar {rp(data.amountPaid)} · Kembalian</Text>
                <Text style={s.paymentVal}>{rp(data.changeAmount ?? 0)}</Text>
              </View>
            )}
            {data.paymentMethod === 'transfer' && data.transferAmount != null && (
              <View style={s.paymentLine}>
                <Text style={s.paymentKey}>Transfer via {data.transferBank ?? '-'}</Text>
                <Text style={s.paymentVal}>{rp(data.transferAmount)}</Text>
              </View>
            )}
          </View>
        </View>

        {data.note && (
          <View style={s.noteBox}>
            <Text style={s.noteLabel}>Catatan</Text>
            <Text style={s.noteText}>{data.note}</Text>
          </View>
        )}

        <Text style={s.footer}>Invoice ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
      </Page>
    </Document>
  );
}
