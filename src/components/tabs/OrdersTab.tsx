'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, RefreshCw, Trash2, ChevronLeft, ChevronRight, Receipt, TrendingUp, ShoppingBag, Upload, ShoppingCart, Globe, Truck, Package, MapPin, FileText, CheckCircle2, Ban, Pencil, X, Plus, Minus, Search, Check, Printer, AlertTriangle, MessageCircle } from 'lucide-react';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import OrderInvoicePDF, { type OrderInvoiceData } from '@/lib/pdf/OrderInvoicePDF';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { toDataUri } from '@/lib/pdf/logo';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import ImageLightbox from '@/components/ImageLightbox';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import { WHATSAPP_NUMBER } from '@/lib/whatsapp';
import { RecordHistoryButton, RecordHistoryPanel } from '@/components/RecordHistory';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';
import { useVisiblePolling } from '@/lib/useVisiblePolling';

const API = '';
const HEADER_BTN_H = 34;

// /api/orders is Postgres-backed and cached 15s server-side, so polling for new orders here
// is safe. 30s (vs Kasir's 20s) — this list is the full order history, not just a product
// catalog, so each tick moves more data over the wire.
const ORDERS_POLL_MS = 30_000;

interface OrderItem { productId?: string; name: string; weight: string; qty: number; price: number; subtotal: number; }
interface Order {
  id: string; invoiceNo: string; date: string; customerName: string; customerPhone: string;
  items: OrderItem[]; subtotal: number; discount?: { amount: number; label: string };
  total: number; pdfUrl?: string; status: string; createdAt?: { seconds: number };
  paymentMethod?: 'cash' | 'transfer' | 'qris' | 'kredit';
  paymentStatus?: 'lunas' | 'belum_lunas';
  amountPaid?: number; changeAmount?: number;
  transferBank?: string; transferAmount?: number; transferProofUrl?: string;
  source?: 'kasir' | 'portal';
  deliveryMethod?: 'pickup' | 'delivery'; address?: string; note?: string;
  stockRestored?: boolean;
  walletId?: string | null;
}

interface EditItem { productId?: string; name: string; weight: string; qty: number; price: number; }
interface PickerProduct { id: string; name: string; price: number; weight: string; published?: boolean; emoji?: string; imageUrls?: string[]; }

function SourceBadge({ source }: { source?: 'kasir' | 'portal' }) {
  return source === 'portal' ? (
    <span className="badge badge-blue" style={{ gap: 4 }}><Globe size={10} /> Website</span>
  ) : (
    <span className="badge badge-green" style={{ gap: 4 }}><ShoppingCart size={10} /> Kasir</span>
  );
}

// Pesanan Kasir biasanya status 'done' sejak dibuat, tapi kalau keranjangnya berisi produk
// "Buka PO" (stok belum ada), pesanan itu juga disimpan sebagai 'baru' persis pesanan Website —
// perlu ditandai Selesai manual sebelum stok dipotong & ikut terhitung di Laporan Keuangan.
// Badge "Dibatalkan" berlaku untuk semua sumber pesanan.
function StatusBadge({ status }: { status: string }) {
  if (status === 'dibatalkan') return <span className="badge badge-red">Dibatalkan</span>;
  if (status === 'baru') return <span className="badge badge-amber">Baru</span>;
  if (status === 'selesai') return <span className="badge badge-green">Selesai</span>;
  return null;
}

// Belum Lunas bisa terjadi di transaksi Kredit (Reseller) dari Kasir — order lain selalu lunas seketika.
function PaymentStatusBadge({ paymentStatus }: { paymentStatus?: 'lunas' | 'belum_lunas' }) {
  return paymentStatus === 'belum_lunas' ? <span className="badge badge-red">Belum Lunas</span> : null;
}

function Checkbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(); }}
      className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors"
      style={{
        background:  checked || indeterminate ? 'var(--accent)' : 'transparent',
        borderColor: checked || indeterminate ? 'var(--accent)' : 'var(--border)',
      }}
    >
      {indeterminate && !checked
        ? <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />
        : checked
          ? <Check size={11} color="#fff" strokeWidth={3} />
          : null}
    </button>
  );
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function formatDate(o: Order) {
  if (o.createdAt?.seconds)
    return new Date(o.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return o.date ?? '–';
}

function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : '62' + d;
}

// Format Date lokal ke value <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") tanpa lewat UTC
// (beda dengan toISOString(), yang menggeser jam sesuai timezone browser).
function toDateTimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Excel import ─────────────────────────────────────────────────────────────
const ORDER_TEMPLATE_COLS = [
  { header: 'No. Invoice',    key: 'invoiceNo',     width: 18 },
  { header: 'Tanggal',        key: 'date',          width: 16 },
  { header: 'Nama Pelanggan*', key: 'customerName', width: 24 },
  { header: 'No. HP',         key: 'customerPhone', width: 18 },
  { header: 'Produk',         key: 'itemsText',     width: 36 },
  { header: 'Subtotal',       key: 'subtotal',      width: 16 },
  { header: 'Diskon',         key: 'discount',      width: 14 },
  { header: 'Total*',         key: 'total',         width: 16 },
  { header: 'Status',         key: 'status',        width: 14 },
] as const;

type OrderTemplateKey = typeof ORDER_TEMPLATE_COLS[number]['key'];

function detectOrderColumn(header: string): OrderTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('invoice')) return 'invoiceNo';
  if (h.includes('tanggal') || h.includes('date')) return 'date';
  if (h.includes('pelanggan') || h.includes('customer')) return 'customerName';
  if (h.includes('hp') || h.includes('whatsapp') || h.includes('telp') || h.includes('phone')) return 'customerPhone';
  if (h.includes('produk') || h.includes('item')) return 'itemsText';
  if (h.includes('subtotal')) return 'subtotal';
  if (h.includes('diskon') || h.includes('discount')) return 'discount';
  if (h.includes('total')) return 'total';
  if (h.includes('status')) return 'status';
  return null;
}

export default function OrdersTab({ creds, highlightInvoice, highlightOrderId, onHighlightHandled, onNewOrdersCountChange }: {
  creds: string; highlightInvoice?: string | null; highlightOrderId?: string | null; onHighlightHandled?: () => void;
  onNewOrdersCountChange?: (count: number) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const wallets = useWallets(creds);
  const [walletBalances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);
  const [orders,     setOrders]     = useState<Order[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const toggleHistory = (id: string) => setHistoryId(cur => cur === id ? null : id);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [view, setView] = useViewMode('orders');
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyBelumLunas, setOnlyBelumLunas] = useState(false);
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const headers = { 'x-admin-auth': creds };

  const [bankOptions, setBankOptions] = useState<{ name: string; bankCode?: string; logoUrl?: string }[]>([]);
  useEffect(() => {
    fetch(`${API}/api/master-banks`, { headers })
      .then(r => r.ok ? r.json() as Promise<{ banks: { name: string; bankCode?: string; logoUrl?: string }[] }> : Promise.resolve({ banks: [] }))
      .then(d => setBankOptions(d.banks))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/orders?from=2000-01-01`, { headers });
    if (r.ok) { const { orders: o } = await r.json() as { orders: Order[] }; setOrders(o); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Auto-refresh in the background — deliberately not reusing `load()`, which flips `loading`
  // and replaces the whole tab with a full-page spinner (fine for the initial load, jarring
  // every 30s in the background).
  const reloadSilently = async () => {
    try {
      const r = await fetch(`${API}/api/orders?from=2000-01-01`, { headers });
      if (r.ok) { const { orders: o } = await r.json() as { orders: Order[] }; setOrders(o); }
    } catch { /* polling — transient failures are ignored, next tick retries */ }
  };
  useVisiblePolling(reloadSilently, ORDERS_POLL_MS, []);

  // Pesanan yang belum ditandai selesai (Website, atau Kasir berisi item "Buka PO") — dipakai
  // buat badge notifikasi di menu sidebar.
  useEffect(() => {
    onNewOrdersCountChange?.(orders.filter(o => o.status === 'baru').length);
  }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Info toko — dipakai saat cetak ulang struk ──
  interface StoreInfo { storeName?: string; storeTagline?: string; address?: string; city?: string; whatsapp?: string; logo?: string; }
  const [storeInfo, setStoreInfo] = useState<StoreInfo>({});
  useEffect(() => {
    fetch(`${API}/api/settings`, { headers }).then(async r => {
      if (r.ok) setStoreInfo((await r.json() as { settings: StoreInfo }).settings ?? {});
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const storeName    = storeInfo.storeName?.trim() || 'Cemilan Teh Risma';
  const storeAddress = [storeInfo.address, storeInfo.city].filter(Boolean).join(', ');
  const storePhone   = (storeInfo.whatsapp?.trim() || WHATSAPP_NUMBER)
    .replace(/^62/, '0').replace(/(\d{4})(\d{4})(\d+)/, '$1-$2-$3');
  const storeLogo    = storeInfo.logo;

  // ── Invoice PDF & kirim WA (pakai logo sebagai data URI, react-pdf tidak bisa fetch balik
  // ke domainnya sendiri dengan andal — lihat komentar di lib/pdf/logo.ts) ──
  const [invoiceLogoDataUri, setInvoiceLogoDataUri] = useState<string | undefined>(undefined);
  useEffect(() => { toDataUri(storeLogo).then(setInvoiceLogoDataUri); }, [storeLogo]);
  const invoiceStoreHeader = {
    name: storeName,
    tagline: storeInfo.storeTagline?.trim() || undefined,
    address: storeAddress || undefined,
    phone: storePhone,
    logo: invoiceLogoDataUri,
  };

  const [printingInvoiceId, setPrintingInvoiceId] = useState<string | null>(null);
  const buildInvoiceData = (o: Order): OrderInvoiceData => ({
    invoiceNo:      o.invoiceNo || o.id,
    date:           formatDate(o),
    printedAt:      new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    customerName:   o.customerName,
    customerPhone:  o.customerPhone || undefined,
    deliveryMethod: o.deliveryMethod,
    address:        o.address,
    note:           o.note,
    items:          o.items,
    subtotal:       o.subtotal,
    discount:       o.discount,
    total:          o.total,
    paymentMethod:  o.paymentMethod,
    paymentStatus:  o.paymentStatus,
    amountPaid:     o.amountPaid,
    changeAmount:   o.changeAmount,
    transferBank:   o.transferBank,
    transferAmount: o.transferAmount,
  });

  const printInvoicePdf = async (o: Order) => {
    setPrintingInvoiceId(o.id);
    try {
      const blob = await pdf(<OrderInvoicePDF data={buildInvoiceData(o)} store={invoiceStoreHeader} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${(o.invoiceNo || o.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal membuat invoice PDF.');
    } finally {
      setPrintingInvoiceId(null);
    }
  };

  const sendInvoiceWhatsApp = (o: Order) => {
    const phone = o.customerPhone?.trim();
    if (!phone) { toast.error('Nomor WhatsApp pelanggan belum diisi di pesanan ini.'); return; }

    const SEP = '─────────────────────';
    const itemLines = o.items
      .map((it, i) => `${i + 1}. ${it.name}${it.weight ? ` (${it.weight})` : ''}\n   ${it.qty} x ${formatRp(it.price)} = *${formatRp(it.subtotal)}*`)
      .join('\n');
    const discountLine = o.discount && o.discount.amount > 0
      ? `Diskon (${o.discount.label}) : -${formatRp(o.discount.amount)}\n`
      : '';
    const paymentLines = o.paymentMethod === 'cash'
      ? `Tunai   : ${formatRp(o.amountPaid ?? 0)}\nKembali : ${formatRp(o.changeAmount ?? 0)}`
      : o.paymentMethod === 'kredit'
      ? `Status  : *${o.paymentStatus === 'lunas' ? 'LUNAS' : 'BELUM LUNAS (KREDIT)'}*`
      : o.paymentMethod === 'transfer'
      ? `Transfer ${o.transferBank ?? ''} : ${formatRp(o.transferAmount ?? 0)}`
      : '';
    const pdfUrl = `${window.location.origin}/api/orders/${o.id}/pdf`;

    const message = `*${storeName.toUpperCase()}*
${storeAddress ? `${storeAddress}\n` : ''}${storePhone}
${SEP}

Halo *${o.customerName}*!
Berikut invoice pesanan Anda:

No. Invoice : *${o.invoiceNo}*
Tanggal     : ${formatDate(o)}
${SEP}
${itemLines}
${SEP}
Subtotal : ${formatRp(o.subtotal)}
${discountLine}*Total    : ${formatRp(o.total)}*
${paymentLines}
${SEP}

Invoice PDF:
${pdfUrl}

Terima kasih telah berbelanja!
_${storeName}_`.trim();

    window.open(`https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`, '_blank');
  };

  // ── Cetak ulang struk pesanan ──
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [printedAt,  setPrintedAt]  = useState('');
  useEffect(() => {
    if (!printOrder) return;
    const t = setTimeout(() => window.print(), 60);
    return () => clearTimeout(t);
  }, [printOrder]);
  const printReceiptFor = (o: Order) => {
    setPrintedAt(new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    setPrintOrder({ ...o });
  };

  // Datang dari klik invoice di Jurnal Kas (Laporan Keuangan) — buka & scroll ke pesanan itu.
  useEffect(() => {
    if (!highlightInvoice || orders.length === 0) return;
    const target = orders.find(o => o.invoiceNo === highlightInvoice);
    if (!target) { onHighlightHandled?.(); return; }
    setExpandedId(target.id);
    setHighlightedId(target.id);
    requestAnimationFrame(() => rowRefs.current[target.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    onHighlightHandled?.();
    const t = setTimeout(() => setHighlightedId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightInvoice, orders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Datang dari klik "Lihat" di modal detail notifikasi (order_new) — sama seperti di atas, tapi
  // notifikasi menyimpan doc id (entityId), bukan invoiceNo.
  useEffect(() => {
    if (!highlightOrderId || orders.length === 0) return;
    const target = orders.find(o => o.id === highlightOrderId);
    if (!target) { onHighlightHandled?.(); return; }
    setExpandedId(target.id);
    setHighlightedId(target.id);
    requestAnimationFrame(() => rowRefs.current[target.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    onHighlightHandled?.();
    const t = setTimeout(() => setHighlightedId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightOrderId, orders]); // eslint-disable-line react-hooks/exhaustive-deps

  const del = async (id: string) => {
    if (!await confirm({ message: 'Hapus pesanan ini? Stok yang sudah terpotong akan dikembalikan ke gudang. Tindakan ini tidak bisa diurungkan.', danger: true })) return;
    const r = await fetch(`${API}/api/orders/${id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setOrders(o => o.filter(x => x.id !== id));
      toast.success('Pesanan berhasil dihapus & stok dikembalikan ke gudang.');
    } else {
      toast.error('Gagal menghapus pesanan.');
    }
  };

  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const cancelOrder = async (id: string) => {
    if (!await confirm({ message: 'Batalkan pesanan ini? Stok yang sudah terpotong akan dikembalikan ke gudang.', danger: true })) return;
    setCancelingId(id);
    const r = await fetch(`${API}/api/orders/${id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dibatalkan' }),
    });
    if (r.ok) {
      setOrders(o => o.map(x => x.id === id ? { ...x, status: 'dibatalkan', stockRestored: true } : x));
      toast.success('Pesanan dibatalkan & stok dikembalikan ke gudang.');
    } else {
      toast.error('Gagal membatalkan pesanan.');
    }
    setCancelingId(null);
  };

  const [markingId, setMarkingId] = useState<string | null>(null);
  const markSelesai = async (id: string) => {
    setMarkingId(id);
    const r = await fetch(`${API}/api/orders/${id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'selesai' }),
    });
    if (r.ok) {
      setOrders(o => o.map(x => x.id === id ? { ...x, status: 'selesai' } : x));
      toast.success('Pesanan ditandai selesai — sudah ikut terhitung di Laporan Keuangan.');
    } else {
      const { error } = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(error ?? 'Gagal menandai pesanan selesai.');
    }
    setMarkingId(null);
  };

  const [markingLunasId, setMarkingLunasId] = useState<string | null>(null);
  const [markLunasOrder, setMarkLunasOrder] = useState<Order | null>(null);
  const [markLunasWalletId, setMarkLunasWalletId] = useState('');
  const markLunas = async (id: string, walletId: string) => {
    setMarkingLunasId(id);
    const r = await fetch(`${API}/api/orders/${id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: 'lunas', walletId }),
    });
    if (r.ok) {
      setOrders(o => o.map(x => x.id === id ? { ...x, paymentStatus: 'lunas', walletId } : x));
      refetchBalances();
      toast.success('Pesanan ditandai lunas — sudah ikut terhitung di Laporan Keuangan.');
    } else {
      toast.error('Gagal menandai lunas.');
    }
    setMarkingLunasId(null);
  };
  const confirmMarkLunas = async () => {
    if (!markLunasOrder || !markLunasWalletId) return;
    await markLunas(markLunasOrder.id, markLunasWalletId);
    setMarkLunasOrder(null);
    setMarkLunasWalletId('');
  };

  const [showBulkMarkLunas, setShowBulkMarkLunas] = useState(false);
  const [bulkMarkLunasWalletId, setBulkMarkLunasWalletId] = useState('');
  const [bulkMarkingLunas, setBulkMarkingLunas] = useState(false);
  const belumLunasSelected = orders.filter(o => selected.has(o.id) && o.paymentStatus === 'belum_lunas');
  const confirmBulkMarkLunas = async () => {
    if (!bulkMarkLunasWalletId || belumLunasSelected.length === 0) return;
    setBulkMarkingLunas(true);
    const ids = belumLunasSelected.map(o => o.id);
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/orders/${id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: 'lunas', walletId: bulkMarkLunasWalletId }),
    }).then(r => r.ok).catch(() => false)));
    const okCount = results.filter(Boolean).length;
    await load();
    refetchBalances();
    setSelected(new Set());
    setShowBulkMarkLunas(false);
    setBulkMarkLunasWalletId('');
    if (okCount === ids.length) toast.success(`${okCount} pesanan ditandai lunas — sudah ikut terhitung di Laporan Keuangan.`);
    else toast.error(`Hanya ${okCount} dari ${ids.length} pesanan berhasil ditandai lunas.`);
    setBulkMarkingLunas(false);
  };

  // ─── Pencarian & seleksi massal ─────────────────────────────────────────────
  const filtered = orders.filter(o => {
    if (onlyBelumLunas && o.paymentStatus !== 'belum_lunas') return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return o.customerName?.toLowerCase().includes(q)
      || o.invoiceNo?.toLowerCase().includes(q)
      || o.customerPhone?.toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const goPage    = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const togglePageAll = () => {
    const ids = paginated.map(o => o.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) ids.forEach(id => n.delete(id));
      else             ids.forEach(id => n.add(id));
      return n;
    });
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} pesanan yang dipilih? Stok yang sudah terpotong akan dikembalikan ke gudang. Tindakan ini tidak bisa diurungkan.`, danger: true })) return;
    setBulkDeleting(true);
    const ids = [...selected];
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/orders/${id}`, { method: 'DELETE', headers }).then(r => r.ok).catch(() => false)));
    const deleted = results.filter(Boolean).length;
    await load();
    refetchBalances();
    setSelected(new Set());
    if (deleted === ids.length) toast.success(`${deleted} pesanan berhasil dihapus & stok dikembalikan ke gudang.`);
    else toast.error(`${deleted} dari ${ids.length} pesanan berhasil dihapus, sisanya gagal.`);
    setBulkDeleting(false);
  };

  // ─── Edit pesanan ───────────────────────────────────────────────────────────
  const [editingOrder,   setEditingOrder]   = useState<Order | null>(null);
  const [savingEdit,     setSavingEdit]     = useState(false);
  const [editItems,      setEditItems]      = useState<EditItem[]>([]);
  const [editCustomerName,  setEditCustomerName]  = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editTransactionAt, setEditTransactionAt] = useState('');
  const [editDiscountType, setEditDiscountType] = useState<'percent' | 'nominal'>('nominal');
  const [editDiscountRaw,  setEditDiscountRaw]  = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<'cash' | 'transfer' | 'qris' | 'kredit'>('cash');
  const [editAmountPaid,    setEditAmountPaid]    = useState('');
  const [editTransferBank,  setEditTransferBank]  = useState('');
  const [editTransferAmount, setEditTransferAmount] = useState('');
  const [editPaymentStatus, setEditPaymentStatus] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [editWalletId, setEditWalletId] = useState('');
  const [editNote, setEditNote] = useState('');
  const [addProductId, setAddProductId] = useState('');
  const [pickerProducts, setPickerProducts] = useState<PickerProduct[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const openEdit = async (o: Order) => {
    let products = pickerProducts;
    if (products.length === 0) {
      setPickerLoading(true);
      const r = await fetch(`${API}/api/products`, { headers });
      if (r.ok) {
        const { products: p } = await r.json() as { products: PickerProduct[] };
        products = p;
        setPickerProducts(p);
      }
      setPickerLoading(false);
    }
    setEditItems((o.items ?? []).map(it => ({
      productId: it.productId ?? products.find(p => p.name === it.name)?.id,
      name: it.name, weight: it.weight, qty: it.qty, price: it.price,
    })));
    setEditCustomerName(o.customerName ?? '');
    setEditCustomerPhone(o.customerPhone ?? '');
    setEditTransactionAt(o.createdAt?.seconds ? toDateTimeLocal(new Date(o.createdAt.seconds * 1000)) : '');
    setEditDiscountType('nominal');
    setEditDiscountRaw(o.discount?.amount ? String(o.discount.amount) : '');
    setEditPaymentMethod(o.paymentMethod ?? 'cash');
    setEditAmountPaid(o.amountPaid != null ? String(o.amountPaid) : '');
    setEditTransferBank(o.transferBank ?? '');
    setEditTransferAmount(o.transferAmount != null ? String(o.transferAmount) : '');
    setEditPaymentStatus(o.paymentStatus ?? 'lunas');
    setEditWalletId(o.walletId ?? '');
    setEditNote(o.note ?? '');
    setAddProductId('');
    setEditingOrder(o);
  };

  const addEditItem = (productId: string) => {
    const product = pickerProducts.find(p => p.id === productId);
    if (!product) return;
    setEditItems(prev => {
      const idx = prev.findIndex(i => i.productId === productId);
      if (idx >= 0) return prev.map((i, ix) => ix === idx ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { productId: product.id, name: product.name, weight: product.weight, qty: 1, price: product.price }];
    });
    setAddProductId('');
  };
  const removeEditItem = (index: number) => setEditItems(prev => prev.filter((_, i) => i !== index));
  const setEditItemQty = (index: number, qty: number) =>
    setEditItems(prev => prev.map((it, i) => i === index ? { ...it, qty: Math.max(1, qty) } : it));

  const editSubtotal = editItems.reduce((s, i) => s + i.price * i.qty, 0);
  // Math.max(0, ...) — kolom diskon persen di form edit adalah <input type="number"> polos yang
  // tidak menolak tanda minus saat diketik, jadi tanpa clamp di sini editDiscountAmount bisa jadi
  // negatif dan justru menambah total, bukan menguranginya.
  const editDiscountNum = Math.max(0, parseFloat(editDiscountRaw) || 0);
  const editDiscountAmount = editDiscountType === 'percent'
    ? Math.min(Math.round(editSubtotal * editDiscountNum / 100), editSubtotal)
    : Math.min(editDiscountNum, editSubtotal);
  const editDiscountLabel = editDiscountType === 'percent' ? `${editDiscountNum}%` : formatRp(editDiscountAmount);
  const editTotal = editSubtotal - editDiscountAmount;
  const editAmountPaidNum = parseFloat(editAmountPaid) || 0;
  const editChangeAmount = editAmountPaidNum - editTotal;
  const editTransferAmountNum = parseFloat(editTransferAmount) || 0;

  const submitEdit = async () => {
    if (!editingOrder) return;
    if (editItems.length === 0) { toast.error('Pesanan harus punya minimal 1 produk.'); return; }
    if (!editCustomerName.trim()) { toast.error('Nama pelanggan wajib diisi.'); return; }

    setSavingEdit(true);
    const items = editItems.map(i => ({ productId: i.productId, name: i.name, weight: i.weight, qty: i.qty, price: i.price, subtotal: i.price * i.qty }));
    const txDate = editTransactionAt ? new Date(editTransactionAt) : null;
    const r = await fetch(`${API}/api/orders/${editingOrder.id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: editCustomerName.trim(), customerPhone: editCustomerPhone.trim(), items,
        subtotal: editSubtotal,
        discount: editDiscountAmount > 0 ? { amount: editDiscountAmount, label: editDiscountLabel } : undefined,
        total: editTotal,
        paymentMethod: editPaymentMethod,
        ...(editPaymentMethod === 'cash' ? { amountPaid: editAmountPaidNum, changeAmount: editChangeAmount } : {}),
        ...(editPaymentMethod === 'transfer' ? { transferBank: editTransferBank, transferAmount: editTransferAmountNum } : {}),
        ...(editPaymentMethod === 'kredit' ? { paymentStatus: editPaymentStatus } : {}),
        walletId: editWalletId || null,
        note: editNote.trim() || undefined,
        ...(txDate ? { transactionAt: txDate.toISOString(), date: txDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) } : {}),
      }),
    });
    if (r.ok) {
      await load();
      refetchBalances();
      toast.success('Pesanan berhasil diperbarui.');
      setEditingOrder(null);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal memperbarui pesanan.');
    }
    setSavingEdit(false);
  };

  const exportExcel = async (rows: Order[]) => {
    if (rows.length === 0) { toast.error('Tidak ada pesanan untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Pesanan');

      const COLS = [
        { header: 'No',          key: 'no',        width: 6  },
        { header: 'No. Invoice', key: 'invoiceNo', width: 18 },
        { header: 'Sumber',      key: 'source',    width: 12 },
        { header: 'Tanggal',     key: 'date',      width: 20 },
        { header: 'Pelanggan',   key: 'customer',  width: 24 },
        { header: 'No. HP',      key: 'phone',     width: 18 },
        { header: 'Produk',      key: 'items',     width: 40 },
        { header: 'Jml Produk',  key: 'itemCount', width: 12 },
        { header: 'Subtotal',    key: 'subtotal',  width: 16 },
        { header: 'Diskon',      key: 'discount',  width: 16 },
        { header: 'Total',       key: 'total',     width: 16 },
        { header: 'Status',      key: 'status',    width: 14 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN PESANAN — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const totalOmzet = rows.reduce((s, o) => s + (o.total ?? 0), 0);
      subCell.value = `${rows.length} pesanan · Total omzet ${formatRp(totalOmzet)} · Diexport ${todayLabel}`;
      subCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      subCell.alignment = { horizontal: 'center', vertical: 'middle' };
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const HEADER_ROW_NUM = 3;
      const headerRow = ws.getRow(HEADER_ROW_NUM);
      COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFC96018' } },
          bottom: { style: 'thin', color: { argb: 'FFC96018' } },
          left: { style: 'thin', color: { argb: 'FFC96018' } },
          right: { style: 'thin', color: { argb: 'FFC96018' } },
        };
      });
      ws.views = [{ state: 'frozen', ySplit: HEADER_ROW_NUM }];

      rows.forEach((o, i) => {
        const itemsText = (o.items ?? []).map(it => `${it.name} (${it.weight}) ×${it.qty}`).join(', ');
        const row = ws.addRow({
          no: i + 1,
          invoiceNo: o.invoiceNo || '-',
          source: o.source === 'portal' ? 'Website' : 'Kasir',
          date: formatDate(o),
          customer: o.customerName || '-',
          phone: o.customerPhone || '-',
          items: itemsText || '-',
          itemCount: o.items?.length ?? 0,
          subtotal: o.subtotal ?? o.total,
          discount: o.discount?.amount ?? 0,
          total: o.total,
          status: o.status || '-',
        });

        const zebraFill = i % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraFill } };
          cell.border = {
            top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right:  { style: 'thin', color: { argb: 'FFE5E7EB' } },
          };
          cell.alignment = { vertical: 'middle', wrapText: false };
        });

        row.getCell('no').alignment        = { horizontal: 'center', vertical: 'middle' };
        row.getCell('source').alignment    = { horizontal: 'center', vertical: 'middle' };
        row.getCell('itemCount').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('status').alignment    = { horizontal: 'center', vertical: 'middle' };
        row.getCell('items').alignment     = { horizontal: 'left', vertical: 'top', wrapText: true };
        ['subtotal', 'discount', 'total'].forEach(key => {
          const cell = row.getCell(key);
          cell.numFmt = '"Rp"#,##0';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        });
      });

      const lastColLetter = ws.getColumn(colCount).letter;
      ws.autoFilter = { from: `A${HEADER_ROW_NUM}`, to: `${lastColLetter}${HEADER_ROW_NUM}` };

      ws.columns.forEach(column => {
        let maxLen = 8;
        for (let r = HEADER_ROW_NUM; r <= ws.rowCount; r++) {
          const v = ws.getRow(r).getCell(column.number!).value;
          const len = v == null ? 0 : v.toString().length;
          if (len > maxLen) maxLen = len;
        }
        column.width = Math.min(maxLen + 2, 50);
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pesanan-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} pesanan ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (rows: Order[]) => {
    if (rows.length === 0) { toast.error('Tidak ada pesanan untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={invoiceStoreHeader}
          data={{
            title: 'DAFTAR PESANAN',
            label: `total omzet ${formatRp(rows.reduce((s, o) => s + (o.total ?? 0), 0))}`,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            // "Jml Produk" dihilangkan (sudah tersirat dari daftar di kolom Produk), dan
            // Subtotal+Diskon digabung satu kolom — 12 kolom Excel terlalu sempit untuk A4
            // landscape.
            columns: [
              { header: 'No', width: '3%', align: 'center' },
              { header: 'No. Invoice', width: '10%' },
              { header: 'Sumber', width: '6%', align: 'center' },
              { header: 'Tanggal', width: '10%' },
              { header: 'Pelanggan', width: '12%' },
              { header: 'No. HP', width: '9%' },
              { header: 'Produk', width: '20%' },
              { header: 'Subtotal / Diskon', width: '13%', align: 'right' },
              { header: 'Total', width: '9%', align: 'right', bold: true },
              { header: 'Status', width: '8%', align: 'center' },
            ],
            rows: rows.map((o, i) => {
              const itemsText = (o.items ?? []).map(it => `${it.name} (${it.weight}) ×${it.qty}`).join(', ');
              const discount = o.discount?.amount ?? 0;
              return [
                i + 1,
                o.invoiceNo || '-',
                o.source === 'portal' ? 'Website' : 'Kasir',
                formatDate(o),
                o.customerName || '-',
                o.customerPhone || '-',
                itemsText || '-',
                // "-" biasa, bukan tanda minus Unicode (−) — font standar react-pdf (Helvetica/
                // WinAnsi) tidak punya glyph itu, hasilnya karakter hilang/kosong di PDF.
                discount > 0 ? `${formatRp(o.subtotal ?? o.total)} (-${formatRp(discount)})` : formatRp(o.subtotal ?? o.total),
                formatRp(o.total),
                o.status || '-',
              ];
            }),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pesanan-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} pesanan ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const downloadOrderTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Pesanan');
    const colCount = ORDER_TEMPLATE_COLS.length;
    ws.columns = ORDER_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT DATA PESANAN — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. '
      + 'Kolom Tanggal diisi format tgl/bln/tahun, contoh: 15/07/2026 (kosong = tanggal hari ini). '
      + 'Kolom No. Invoice boleh dikosongkan — akan dibuat otomatis. '
      + 'Kolom Produk cukup diisi ringkasan nama produk (bebas), bukan rincian per baris.';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 46;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    ORDER_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
    headerRow.height = 24;
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFC96018' } },
        bottom: { style: 'thin', color: { argb: 'FFC96018' } },
        left: { style: 'thin', color: { argb: 'FFC96018' } },
        right: { style: 'thin', color: { argb: 'FFC96018' } },
      };
    });
    ws.views = [{ state: 'frozen', ySplit: HEADER_ROW_NUM }];

    const exampleRow = ws.addRow({
      invoiceNo: '', date: '15/07/2026', customerName: 'Budi Santoso', customerPhone: '081234567890',
      itemsText: 'Keripik Talas (100g) ×2, Mie Kremes (150g) ×1', subtotal: 45000, discount: 5000,
      total: 40000, status: 'selesai',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-pesanan.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importOrdersFromExcel = async (file: File) => {
    setImporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, OrderTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, OrderTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectOrderColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('customerName') || fields.has('total')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Nama Pelanggan" atau "Total" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: Record<string, unknown>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw: Record<string, string> = Object.fromEntries(ORDER_TEMPLATE_COLS.map(c => [c.key, '']));
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (!raw.customerName.trim()) return;
        rows.push({
          invoiceNo: raw.invoiceNo, date: raw.date, customerName: raw.customerName, customerPhone: raw.customerPhone,
          itemsText: raw.itemsText,
          subtotal: Number(raw.subtotal.replace(/[^0-9.-]/g, '')) || undefined,
          discount: Number(raw.discount.replace(/[^0-9.-]/g, '')) || undefined,
          total: Number(raw.total.replace(/[^0-9.-]/g, '')) || 0,
          status: raw.status,
        });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data pesanan valid pada file tersebut. Pastikan kolom Nama Pelanggan dan Total terisi.');
        return;
      }

      const r = await fetch(`${API}/api/orders/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number; skippedDuplicate: number };
        await load();
        const extra = [
          d.skippedDuplicate > 0 ? `${d.skippedDuplicate} No. Invoice duplikat dilewati` : '',
          d.skippedInvalid   > 0 ? `${d.skippedInvalid} baris tidak lengkap dilewati` : '',
        ].filter(Boolean).join(', ');
        toast.success(`${d.created} pesanan berhasil diimpor.${extra ? ` (${extra})` : ''}`);
      } else {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        toast.error(d.error ?? 'Gagal mengimpor data pesanan.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImporting(false);
    }
  };

  // Pesanan dibatalkan tidak ikut dihitung sebagai omzet
  const activeOrders = orders.filter(o => o.status !== 'dibatalkan');
  const totalRevenue = activeOrders.reduce((s, o) => s + (o.total ?? 0), 0);
  const avgOrder     = activeOrders.length ? totalRevenue / activeOrders.length : 0;

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: <ShoppingBag size={16}/>, label: 'Total Transaksi', val: orders.length.toString(), color: 'var(--accent)', bg: 'var(--accent-bg)' },
          { icon: <TrendingUp  size={16}/>, label: 'Total Omzet',     val: formatRp(totalRevenue), color: 'var(--success)', bg: 'var(--success-bg)' },
          { icon: <Receipt     size={16}/>, label: 'Rata-rata Order', val: formatRp(avgOrder), color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
        ].map((c, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: c.bg, color: c.color }}>
              {c.icon}
            </div>
            <div>
              <p className="text-lg font-extrabold tabular leading-none" style={{ color: c.color }}>{c.val}</p>
              <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex flex-row items-center gap-2 sm:gap-3">
        {orders.length > 0 && (
          <button
            onClick={() => { setOnlyBelumLunas(v => !v); resetPage(); }}
            className="px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0"
            style={{
              height: HEADER_BTN_H,
              background: onlyBelumLunas ? 'linear-gradient(135deg,#E8821A,#C96018)' : 'var(--surface-2)',
              color: onlyBelumLunas ? 'white' : 'var(--text-muted)',
            }}
          >
            <AlertTriangle size={14} /> <span className="hidden sm:inline">Belum Lunas</span>
          </button>
        )}
        {orders.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari nama pelanggan, no. invoice, atau no. HP…"
            />
          </div>
        )}
        <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
          <Tooltip label="Unduh Template">
            <button onClick={downloadOrderTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
              <ExcelIcon size={14} />
            </button>
          </Tooltip>
          <Tooltip label={importing ? 'Mengimpor…' : 'Upload Excel'}>
            <button onClick={() => importFileRef.current?.click()} disabled={importing} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            </button>
          </Tooltip>
          <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importOrdersFromExcel(f); e.target.value = ''; }} />
          {orders.length > 0 && (
            <Tooltip label="Export Excel">
              <button onClick={() => exportExcel(orders)} disabled={exporting} aria-label="Export Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
              </button>
            </Tooltip>
          )}
          {orders.length > 0 && (
            <Tooltip label="Export PDF">
              <button onClick={() => exportPdf(orders)} disabled={exportingPdf} aria-label="Export PDF" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
              </button>
            </Tooltip>
          )}
          <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
        </div>
      </div>

      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={load} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🧾</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada pesanan</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pesanan dari Kasir maupun checkout Website akan muncul di sini otomatis.</p>
        </div>
      ) : (
        <>
          {/* Select-all bar */}
          {paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={paginated.every(o => selected.has(o.id))}
                indeterminate={paginated.some(o => selected.has(o.id)) && !paginated.every(o => selected.has(o.id))}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} pesanan di halaman ini`}
              </span>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada pesanan yang cocok.</p>
            </div>
          ) : view === 'table' ? (
        <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
          {paginated.map((o, idx) => {
            const rowNum = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
            const isSelected = selected.has(o.id);
            const actionButtons = (
              <>
                {o.status === 'baru' && (
                  <Tooltip label="Tandai Selesai">
                    <button onClick={() => markSelesai(o.id)} disabled={markingId === o.id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--success)' }} title="Tandai Selesai">
                      {markingId === o.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    </button>
                  </Tooltip>
                )}
                {o.paymentStatus === 'belum_lunas' && (
                  <button onClick={() => { setMarkLunasOrder(o); setMarkLunasWalletId(o.walletId ?? ''); }} disabled={markingLunasId === o.id}
                    className="btn-ghost px-2 py-2 text-xs font-semibold" style={{ color: 'var(--success)' }} title="Tandai Lunas">
                    {markingLunasId === o.id ? <Loader2 size={13} className="animate-spin" /> : 'Tandai Lunas'}
                  </button>
                )}
                {o.status !== 'dibatalkan' && (
                  <Tooltip label="Batalkan Pesanan">
                    <button onClick={() => cancelOrder(o.id)} disabled={cancelingId === o.id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Batalkan Pesanan">
                      {cancelingId === o.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                    </button>
                  </Tooltip>
                )}
                <Tooltip label="Cetak Ulang Struk">
                  <button onClick={() => printReceiptFor(o)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Cetak Ulang Struk">
                    <Printer size={12} />
                  </button>
                </Tooltip>
                <Tooltip label="Cetak Invoice PDF">
                  <button onClick={() => printInvoicePdf(o)} disabled={printingInvoiceId === o.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Cetak Invoice PDF">
                    {printingInvoiceId === o.id ? <Loader2 size={12} className="animate-spin" /> : <PdfIcon size={12} />}
                  </button>
                </Tooltip>
                {o.customerPhone && (
                  <Tooltip label="Kirim Invoice via WhatsApp">
                    <button onClick={() => sendInvoiceWhatsApp(o)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Kirim Invoice via WhatsApp">
                      <MessageCircle size={12} />
                    </button>
                  </Tooltip>
                )}
                {o.status !== 'dibatalkan' && (
                  <Tooltip label="Edit">
                    <button onClick={() => openEdit(o)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit Pesanan">
                      <Pencil size={12} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip label="Hapus">
                  <button onClick={() => del(o.id)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus Pesanan">
                    <Trash2 size={12} />
                  </button>
                </Tooltip>
                <RecordHistoryButton open={historyId === o.id} onToggle={() => toggleHistory(o.id)} />
                <Tooltip label="Lihat Detail">
                  <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                    <ChevronRight size={12} style={{ transform: expandedId === o.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                  </button>
                </Tooltip>
              </>
            );
            return (
            <div key={o.id} ref={el => { rowRefs.current[o.id] = el; }}
              style={{ transition: 'background-color 0.6s ease', backgroundColor: highlightedId === o.id ? 'var(--accent-bg)' : isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
              <div className="flex flex-col gap-2 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <Checkbox checked={isSelected} onChange={() => toggleSelect(o.id)} />
                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                    {rowNum}
                  </span>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent-bg)' }}>
                    <Receipt size={17} style={{ color: 'var(--accent)' }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                      <SourceBadge source={o.source} />
                      <StatusBadge status={o.status} />
                      <PaymentStatusBadge paymentStatus={o.paymentStatus} />
                    </div>
                    <p className="text-xs tabular truncate" style={{ color: 'var(--text-muted)' }}>
                      {o.invoiceNo} · {formatDate(o)}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0 hidden sm:block">
                    <p className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.items?.length ?? 0} produk</p>
                  </div>

                  <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                    {actionButtons}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 sm:hidden">
                  <div>
                    <p className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.items?.length ?? 0} produk</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                    {actionButtons}
                  </div>
                </div>
              </div>

              {expandedId === o.id && <OrderDetail o={o} />}
              {historyId === o.id && <RecordHistoryPanel creds={creds} entity="orders" entityId={o.id} />}
            </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginated.map(o => {
            const isSelected = selected.has(o.id);
            return (
            <div key={o.id} ref={el => { rowRefs.current[o.id] = el; }} className="card overflow-hidden relative"
              style={{ transition: 'background-color 0.6s ease', backgroundColor: highlightedId === o.id ? 'var(--accent-bg)' : undefined, outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="pt-0.5">
                    <Checkbox checked={isSelected} onChange={() => toggleSelect(o.id)} />
                  </div>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent-bg)' }}>
                    <Receipt size={17} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                      <SourceBadge source={o.source} />
                      <StatusBadge status={o.status} />
                      <PaymentStatusBadge paymentStatus={o.paymentStatus} />
                    </div>
                    <p className="text-xs tabular truncate" style={{ color: 'var(--text-muted)' }}>
                      {o.invoiceNo} · {formatDate(o)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {o.status !== 'dibatalkan' && (
                      <Tooltip label="Batalkan Pesanan">
                        <button onClick={() => cancelOrder(o.id)} disabled={cancelingId === o.id}
                          className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Batalkan Pesanan">
                          {cancelingId === o.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip label="Cetak Ulang Struk">
                      <button onClick={() => printReceiptFor(o)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Cetak Ulang Struk">
                        <Printer size={12} />
                      </button>
                    </Tooltip>
                    <Tooltip label="Cetak Invoice PDF">
                      <button onClick={() => printInvoicePdf(o)} disabled={printingInvoiceId === o.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Cetak Invoice PDF">
                        {printingInvoiceId === o.id ? <Loader2 size={12} className="animate-spin" /> : <PdfIcon size={12} />}
                      </button>
                    </Tooltip>
                    {o.customerPhone && (
                      <Tooltip label="Kirim Invoice via WhatsApp">
                        <button onClick={() => sendInvoiceWhatsApp(o)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Kirim Invoice via WhatsApp">
                          <MessageCircle size={12} />
                        </button>
                      </Tooltip>
                    )}
                    {o.status !== 'dibatalkan' && (
                      <Tooltip label="Edit">
                        <button onClick={() => openEdit(o)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit Pesanan">
                          <Pencil size={12} />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip label="Hapus">
                      <button onClick={() => del(o.id)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus Pesanan">
                        <Trash2 size={12} />
                      </button>
                    </Tooltip>
                    <RecordHistoryButton open={historyId === o.id} onToggle={() => toggleHistory(o.id)} />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <div>
                    <p className="text-base font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.items?.length ?? 0} produk</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {o.status === 'baru' && (
                      <Tooltip label="Tandai Selesai">
                        <button onClick={() => markSelesai(o.id)} disabled={markingId === o.id}
                          className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--success)' }} title="Tandai Selesai">
                          {markingId === o.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        </button>
                      </Tooltip>
                    )}
                    {o.paymentStatus === 'belum_lunas' && (
                      <button onClick={() => { setMarkLunasOrder(o); setMarkLunasWalletId(o.walletId ?? ''); }} disabled={markingLunasId === o.id}
                        className="btn-ghost px-2 py-1.5 text-xs font-semibold" style={{ color: 'var(--success)' }} title="Tandai Lunas">
                        {markingLunasId === o.id ? <Loader2 size={13} className="animate-spin" /> : 'Lunas'}
                      </button>
                    )}
                    <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                      className="btn-ghost px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1">
                      Detail <ChevronRight size={13} style={{ transform: expandedId === o.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                    </button>
                  </div>
                </div>
              </div>

              {expandedId === o.id && <OrderDetail o={o} />}
              {historyId === o.id && <RecordHistoryPanel creds={creds} entity="orders" entityId={o.id} />}
            </div>
            );
          })}
        </div>
          )}

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} pesanan · halaman {safePage} dari {totalPages}
                </p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); resetPage(); }} />
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Tooltip label="Halaman sebelumnya">
                    <button onClick={() => goPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronLeft size={14} />
                    </button>
                  </Tooltip>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                    .reduce<(number | '…')[]>((acc, n, i, arr) => {
                      if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(n); return acc;
                    }, [])
                    .map((n, i) =>
                      n === '…'
                        ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                        : <button key={n} onClick={() => goPage(n as number)}
                            className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                            style={safePage === n
                              ? { background: 'var(--accent)', color: '#fff' }
                              : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                            {n}
                          </button>
                    )
                  }
                  <Tooltip label="Halaman berikutnya">
                    <button onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronRight size={14} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportExcel(orders.filter(o => selected.has(o.id)))} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(orders.filter(o => selected.has(o.id)))} disabled={exportingPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              PDF
            </button>
            {belumLunasSelected.length > 0 && (
              <button onClick={() => { setBulkMarkLunasWalletId(''); setShowBulkMarkLunas(true); }}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                style={{ background: 'var(--success)', color: '#fff' }}>
                <Check size={13} />
                Tandai Lunas {belumLunasSelected.length < selected.size ? `(${belumLunasSelected.length})` : ''}
              </button>
            )}
            <button onClick={bulkDelete} disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}

      {markLunasOrder && (
        <div className="modal-overlay" onClick={() => setMarkLunasOrder(null)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><CheckCircle2 size={17} /></div>
                <div>
                  <p className="modal-title">Tandai Lunas</p>
                  <p className="modal-subtitle">Pesanan {markLunasOrder.invoiceNo}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setMarkLunasOrder(null)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <label className="field-label">Uang masuk ke dompet mana? <span style={{ color: 'var(--danger)' }}>*</span></label>
              <SearchSelect value={markLunasWalletId} onChange={setMarkLunasWalletId}
                options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
              {markLunasWalletId && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  Saldo saat ini: {formatRp(walletBalances[markLunasWalletId] ?? 0)}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setMarkLunasOrder(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={confirmMarkLunas} disabled={!markLunasWalletId || markingLunasId === markLunasOrder.id}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {markingLunasId === markLunasOrder.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Tandai Lunas
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkMarkLunas && (
        <div className="modal-overlay" onClick={() => !bulkMarkingLunas && setShowBulkMarkLunas(false)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><CheckCircle2 size={17} /></div>
                <div>
                  <p className="modal-title">Tandai Lunas</p>
                  <p className="modal-subtitle">{belumLunasSelected.length} pesanan terpilih</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowBulkMarkLunas(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <label className="field-label">Uang masuk ke dompet mana? <span style={{ color: 'var(--danger)' }}>*</span></label>
              <SearchSelect value={bulkMarkLunasWalletId} onChange={setBulkMarkLunasWalletId}
                options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
              {bulkMarkLunasWalletId && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  Saldo saat ini: {formatRp(walletBalances[bulkMarkLunasWalletId] ?? 0)}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowBulkMarkLunas(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={confirmBulkMarkLunas} disabled={!bulkMarkLunasWalletId || bulkMarkingLunas}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {bulkMarkingLunas ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Tandai Lunas ({belumLunasSelected.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {editingOrder && (
        <div className="modal-overlay" onClick={() => !savingEdit && setEditingOrder(null)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Pencil size={17} /></div>
                <div>
                  <p className="modal-title">Edit Pesanan</p>
                  <p className="modal-subtitle">{editingOrder.invoiceNo} · {formatDate(editingOrder)}</p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={() => setEditingOrder(null)} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Nama Pelanggan <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="text" value={editCustomerName} onChange={e => setEditCustomerName(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label className="field-label">No. HP</label>
                    <input type="text" value={editCustomerPhone} onChange={e => setEditCustomerPhone(e.target.value)} className="input" />
                  </div>
                </div>

                <div>
                  <label className="field-label">Tanggal &amp; Waktu Transaksi</label>
                  <input type="datetime-local" value={editTransactionAt} onChange={e => setEditTransactionAt(e.target.value)} className="input" />
                </div>

                <div>
                  <label className="field-label">Produk</label>
                  {pickerLoading ? (
                    <div className="flex items-center justify-center py-6"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {editItems.map((it, i) => (
                        <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{it.name}</p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{it.weight} · {formatRp(it.price)}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Tooltip label="Kurangi Jumlah">
                              <button type="button" onClick={() => setEditItemQty(i, it.qty - 1)} className="btn-ghost p-1.5"><Minus size={12} /></button>
                            </Tooltip>
                            <span className="text-sm font-bold tabular" style={{ width: 22, textAlign: 'center' }}>{it.qty}</span>
                            <Tooltip label="Tambah Jumlah">
                              <button type="button" onClick={() => setEditItemQty(i, it.qty + 1)} className="btn-ghost p-1.5"><Plus size={12} /></button>
                            </Tooltip>
                          </div>
                          <p className="text-sm font-bold tabular flex-shrink-0" style={{ width: 80, textAlign: 'right', color: 'var(--text-primary)' }}>{formatRp(it.price * it.qty)}</p>
                          <Tooltip label="Hapus Item">
                            <button type="button" onClick={() => removeEditItem(i)} className="btn-ghost p-1.5 flex-shrink-0" style={{ color: 'var(--danger)' }}><Trash2 size={12} /></button>
                          </Tooltip>
                        </div>
                      ))}
                      <SearchSelect value={addProductId} onChange={addEditItem}
                        options={pickerProducts.filter(p => p.published !== false).map(p => ({ value: p.id, label: p.name, sublabel: `${p.weight} · ${formatRp(p.price)}`, imageUrl: p.imageUrls?.[0], emoji: p.emoji }))}
                        placeholder="+ Tambah Produk" searchPlaceholder="Cari produk…" />
                    </div>
                  )}
                </div>

                <div>
                  <label className="field-label">Diskon</label>
                  <div className="flex gap-2">
                    <div className="flex rounded-xl overflow-hidden border flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
                      {(['nominal', 'percent'] as const).map(t => (
                        <button key={t} type="button" onClick={() => setEditDiscountType(t)}
                          className="px-3 py-2.5 text-xs font-bold transition-all"
                          style={editDiscountType === t ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                          {t === 'nominal' ? 'Rp' : '%'}
                        </button>
                      ))}
                    </div>
                    {editDiscountType === 'percent' ? (
                      <input type="number" min="0" value={editDiscountRaw} onChange={e => setEditDiscountRaw(e.target.value)}
                        placeholder="0" className="input" style={{ flex: 1 }} />
                    ) : (
                      <NumberInput value={editDiscountRaw} onChange={setEditDiscountRaw}
                        placeholder="0" className="input" style={{ flex: 1 }} />
                    )}
                  </div>
                </div>

                <div>
                  <label className="field-label">Metode Pembayaran</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['cash', 'transfer', 'qris', 'kredit'] as const).map(m => (
                      <button key={m} type="button" onClick={() => setEditPaymentMethod(m)}
                        className="flex-1 px-2 py-2.5 text-xs font-bold transition-all"
                        style={editPaymentMethod === m ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {m === 'cash' ? 'Tunai' : m === 'transfer' ? 'Transfer' : m === 'qris' ? 'QRIS' : 'Kredit'}
                      </button>
                    ))}
                  </div>
                </div>

                {editPaymentMethod === 'cash' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="field-label">Dibayar</label>
                      <NumberInput value={editAmountPaid} onChange={setEditAmountPaid} placeholder="0" />
                    </div>
                    <div>
                      <label className="field-label">Kembalian</label>
                      <p className="text-sm font-bold tabular px-3.5 py-2.5" style={{ color: editChangeAmount < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                        {formatRp(editChangeAmount)}
                      </p>
                    </div>
                  </div>
                )}
                {editPaymentMethod === 'transfer' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="field-label">Bank</label>
                      <SearchSelect value={editTransferBank} onChange={setEditTransferBank}
                        options={bankOptions.map(b => ({ value: b.name, label: b.name, sublabel: b.bankCode ? `Kode: ${b.bankCode}` : undefined, imageUrl: b.logoUrl }))}
                        placeholder="– Pilih Bank –" searchPlaceholder="Cari bank…" />
                    </div>
                    <div>
                      <label className="field-label">Jumlah Transfer</label>
                      <NumberInput value={editTransferAmount} onChange={setEditTransferAmount} />
                    </div>
                  </div>
                )}
                {editPaymentMethod === 'kredit' && (
                  <div>
                    <label className="field-label">Status Pembayaran</label>
                    <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                      {(['lunas', 'belum_lunas'] as const).map(s => (
                        <button key={s} type="button" onClick={() => setEditPaymentStatus(s)}
                          className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                          style={editPaymentStatus === s ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                          {s === 'lunas' ? 'Lunas' : 'Belum Lunas'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {(editPaymentMethod !== 'kredit' || editPaymentStatus === 'lunas') && (
                  <div>
                    <label className="field-label">Dompet</label>
                    <SearchSelect value={editWalletId} onChange={setEditWalletId}
                      options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                    {editWalletId && (
                      <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                        Saldo saat ini: {formatRp(walletBalances[editWalletId] ?? 0)}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="field-label">Catatan</label>
                  <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)} className="input" />
                </div>

                <div className="space-y-1 pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-muted)' }}>Subtotal</span>
                    <span className="tabular font-semibold" style={{ color: 'var(--text-primary)' }}>{formatRp(editSubtotal)}</span>
                  </div>
                  {editDiscountAmount > 0 && (
                    <div className="flex justify-between text-xs">
                      <span style={{ color: 'var(--success)' }}>Diskon ({editDiscountLabel})</span>
                      <span className="tabular font-semibold" style={{ color: 'var(--success)' }}>− {formatRp(editDiscountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold pt-1">
                    <span style={{ color: 'var(--text-primary)' }}>Total</span>
                    <span className="tabular" style={{ color: 'var(--accent)' }}>{formatRp(editTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setEditingOrder(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={submitEdit} disabled={savingEdit} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                {savingEdit ? 'Menyimpan…' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Struk cetak ulang (tersembunyi di layar, tampil hanya saat print) ─── */}
      {printOrder && (
        <div id="order-receipt-print">
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#000', padding: 8, width: '80mm', boxSizing: 'border-box' }}>
            {storeLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={storeLogo} alt={storeName} style={{ display: 'block', maxHeight: 44, maxWidth: '55%', margin: '0 auto 4px' }} />
            )}
            <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, margin: 0 }}>{storeName}</p>
            {storeAddress && <p style={{ textAlign: 'center', fontSize: 10, margin: '2px 0 0' }}>{storeAddress}</p>}
            <p style={{ textAlign: 'center', fontSize: 10, margin: '2px 0 0' }}>{storePhone}</p>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <p style={{ margin: 0 }}>No: {printOrder.invoiceNo}</p>
            <p style={{ margin: 0 }}>{formatDate(printOrder)}</p>
            <p style={{ margin: 0 }}>Dicetak: {printedAt}</p>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            {printOrder.items.map((it, i) => (
              <div key={i} style={{ marginBottom: 3 }}>
                <div>{it.name} ({it.weight})</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{it.qty} x {formatRp(it.price)}</span>
                  <span>{formatRp(it.subtotal)}</span>
                </div>
              </div>
            ))}
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatRp(printOrder.subtotal)}</span></div>
            {printOrder.discount && printOrder.discount.amount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Diskon ({printOrder.discount.label})</span><span>-{formatRp(printOrder.discount.amount)}</span></div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12 }}><span>TOTAL</span><span>{formatRp(printOrder.total)}</span></div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            {printOrder.paymentMethod === 'cash' ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tunai</span><span>{formatRp(printOrder.amountPaid ?? 0)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Kembali</span><span>{formatRp(printOrder.changeAmount ?? 0)}</span></div>
              </>
            ) : printOrder.paymentMethod === 'kredit' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Status</span><span>{printOrder.paymentStatus === 'lunas' ? 'LUNAS' : 'BELUM LUNAS (KREDIT)'}</span></div>
            ) : printOrder.paymentMethod === 'transfer' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Transfer {printOrder.transferBank}</span><span>{formatRp(printOrder.transferAmount ?? 0)}</span></div>
            ) : null}
            <p style={{ marginTop: 6 }}>Pelanggan: {printOrder.customerName}</p>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <p style={{ textAlign: 'center', fontWeight: 700 }}>SALINAN STRUK</p>
            <p style={{ textAlign: 'center' }}>Terima kasih telah berbelanja!</p>
            <p style={{ textAlign: 'center', fontSize: 10 }}>{storeName}{storeAddress ? ` · ${storeAddress}` : ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderDetail({ o }: { o: Order }) {
  const [proofOpen, setProofOpen] = useState(false);
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        {o.customerPhone && (
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>📞 {o.customerPhone}</p>
        )}
        {o.paymentMethod && (
          <span className={`badge ${o.paymentMethod === 'cash' ? 'badge-green' : o.paymentMethod === 'kredit' ? 'badge-amber' : 'badge-blue'}`}>
            {o.paymentMethod === 'cash' ? 'Tunai' : o.paymentMethod === 'transfer' ? 'Transfer' : o.paymentMethod === 'kredit' ? 'Kredit' : 'QRIS'}
          </span>
        )}
        {o.deliveryMethod && (
          <span className="badge badge-gray" style={{ gap: 4 }}>
            {o.deliveryMethod === 'delivery' ? <Truck size={10} /> : <Package size={10} />}
            {o.deliveryMethod === 'delivery' ? 'Delivery' : 'Pickup'}
          </span>
        )}
      </div>

      {o.address && (
        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <MapPin size={12} className="mt-0.5 flex-shrink-0" /> {o.address}
        </p>
      )}
      {o.note && (
        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <FileText size={12} className="mt-0.5 flex-shrink-0" /> {o.note}
        </p>
      )}

      {o.paymentMethod === 'cash' && o.amountPaid != null && (
        <div className="flex justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>Dibayar {formatRp(o.amountPaid)} · Kembalian</span>
          <span className="font-bold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(o.changeAmount ?? 0)}</span>
        </div>
      )}
      {o.paymentMethod === 'transfer' && o.transferAmount != null && (
        <div className="flex justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>Transfer via {o.transferBank ?? '–'}</span>
          <span className="font-bold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(o.transferAmount)}</span>
        </div>
      )}
      {o.transferProofUrl && (
        <button type="button" onClick={() => setProofOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--accent)' }}>
          <Receipt size={12} /> Lihat Bukti Transfer →
        </button>
      )}
      {proofOpen && o.transferProofUrl && (
        <ImageLightbox images={[o.transferProofUrl]} index={0} title="Bukti Transfer"
          onIndexChange={() => {}} onClose={() => setProofOpen(false)} />
      )}

      <div className="space-y-1.5">
        {o.items?.map((item, i) => (
          <div key={i} className="flex justify-between gap-2 text-xs">
            <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text-secondary)' }}>
              {item.name} <span style={{ color: 'var(--text-muted)' }}>({item.weight})</span> × {item.qty}
            </span>
            <span className="font-bold tabular flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{formatRp(item.subtotal)}</span>
          </div>
        ))}
      </div>

      {o.discount && o.discount.amount > 0 && (
        <div className="flex justify-between text-xs">
          <span style={{ color: 'var(--success)' }}>Diskon ({o.discount.label})</span>
          <span className="font-bold tabular" style={{ color: 'var(--success)' }}>− {formatRp(o.discount.amount)}</span>
        </div>
      )}

      <div className="flex justify-between text-sm font-bold pt-2"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        <span>Total</span>
        <span className="tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</span>
      </div>

      {o.pdfUrl && (
        <a href={o.pdfUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--accent)' }}>
          <PdfIcon size={12} /> Lihat Invoice PDF →
        </a>
      )}
    </div>
  );
}
