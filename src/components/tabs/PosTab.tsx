'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  ShoppingCart, Plus, Minus, ChevronLeft, CheckCircle2, Loader2, User, Phone,
  Trash2, Tag, Send, Search, Wallet, X, Banknote, Printer,
  MessageCircle, Receipt, ArrowRight, Camera, PauseCircle, BarChart2, TrendingUp, Award, CalendarClock,
  RefreshCw, ScanLine,
} from 'lucide-react';
import { PdfIcon } from '@/components/FileTypeIcons';
import { formatCurrency, WHATSAPP_NUMBER } from '@/lib/whatsapp';
import TopbarPortal from '@/components/TopbarPortal';
import ScrollChips from '@/components/ScrollChips';
import ImageCarousel from '@/components/ImageCarousel';
import ImageLightbox from '@/components/ImageLightbox';
import ImageUploadBox from '@/components/ImageUploadBox';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { recognizeTransferAmount } from '@/lib/receipt-ocr';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';
import BarcodeScannerModal from '@/components/BarcodeScannerModal';
import { resolveScannedProductId } from '@/lib/scan';
import { useVisiblePolling } from '@/lib/useVisiblePolling';
import {
  PosProduct, PosCategory_Entry, PosReseller, PosCustomer, PosBank,
  POS_CAT_ALL, POS_STOCK_MAP, posStockStatus,
} from '@/lib/pos-types';

// /api/products is Postgres-backed and cached 15s server-side, so polling here just keeps
// the register's stock/harga fresh while Kasir stays open — no Firestore quota to worry about.
const STOCK_POLL_MS = 20_000;

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://karyaputra.vercel.app';

// Ingat dompet terakhir dipakai per metode pembayaran (localStorage saja) supaya kasir
// biasanya tidak perlu pilih ulang tiap transaksi — cukup konfirmasi, bukan wajib mikir.
const LAST_WALLET_KEY = 'pos_last_wallet_by_method';
function getLastWallet(method: string): string {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_WALLET_KEY) ?? '{}') as Record<string, string>;
    return map[method] ?? '';
  } catch { return ''; }
}
function setLastWallet(method: string, walletId: string) {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_WALLET_KEY) ?? '{}') as Record<string, string>;
    map[method] = walletId;
    localStorage.setItem(LAST_WALLET_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

// ─── Types ───────────────────────────────────────────────────────────────────
type CartEntry     = { productId: string; qty: number };
// Item bebas input di checkout (bukan produk katalog) — mis. ongkir, bungkus kado, atau nominal
// tambahan lain. Bisa ditambahkan lebih dari satu, ikut masuk ke total & struk seperti item biasa.
type CustomItem    = { id: string; name: string; price: number; qty: number };
type PosView       = 'products' | 'cart' | 'done';
type PaymentMethod = 'cash' | 'transfer' | 'qris' | 'kredit';

interface CashierShift {
  id: string; openedAt?: { seconds: number }; openedBy: string; openingBalance: number;
  status: 'open' | 'closed';
}

interface ReceiptData {
  invoiceNo: string; dateStr: string;
  items: { name: string; weight: string; qty: number; price: number; subtotal: number }[];
  subtotal: number; discount?: { amount: number; label: string }; total: number;
  paymentMethod: PaymentMethod;
  amountPaid?: number; changeAmount?: number;
  transferBank?: string; transferAmount?: number; transferProofUrl?: string;
  customerName: string; customerPhone: string; cashier: string; pdfUrl?: string;
}

// Info toko diambil dari /api/settings — dipakai untuk melengkapi struk cetak & pesan WA
// (nama, alamat, telepon, logo), dengan fallback ke nilai hardcoded lama kalau belum diisi.
interface StoreInfo {
  storeName?: string; address?: string; city?: string; whatsapp?: string; logo?: string;
  posWarehouseId?: string; posWarehouseName?: string;
}

type OcrStatus = 'idle' | 'reading' | 'done' | 'failed';

// Transaksi yang ditahan sementara (Hold/Pending) — disimpan di server (koleksi
// posHeldTransactions) supaya bisa dilanjutkan dari perangkat manapun, bukan cuma
// perangkat yang menahannya.
interface HeldTransaction {
  id: string; createdAt: number; label: string;
  cart: CartEntry[]; customItems?: CustomItem[]; custName: string; custPhone: string;
  discountType: 'percent' | 'nominal'; discountRaw: string;
  paymentMethod: PaymentMethod; amountPaidRaw: string;
  transferBank: string; transferAmountRaw: string; transferProofUrl: string;
  selectedCustRef: string;
}

// Data order mentah dari /api/orders — dipakai untuk hitung Laporan Penjualan hari ini
interface PosOrderRecord {
  total: number;
  source?: 'kasir' | 'portal'; status?: string;
  paymentStatus?: 'lunas' | 'belum_lunas';
  createdAt?: { seconds: number };
  items?: { name: string; qty: number; price: number; subtotal: number }[];
}
interface SalesReportData {
  omzet: number; count: number; avg: number; profit: number; hasCostData: boolean;
  topProducts: { name: string; qty: number; revenue: number; cost: number }[];
}

// QRIS belum diaktifkan (masih proses manual) — cukup tambah entrinya lagi di sini kalau sudah siap.
const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Tunai' }, { id: 'transfer', label: 'Transfer' },
];
const KREDIT_METHOD: { id: PaymentMethod; label: string } = { id: 'kredit', label: 'Kredit' };

function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : '62' + d;
}

// Struk lengkap (bukan cuma link PDF) dikirim lewat WhatsApp — dibuat sedekat mungkin dengan
// struk cetak (nama toko, alamat, telepon, rincian item, total, pembayaran) supaya pelanggan
// tetap dapat rincian belanja meski tidak menerima struk fisik.
function formatWAMessage(receipt: ReceiptData, store: { name: string; address: string; phone: string }) {
  const SEP = '─────────────────────';
  const itemLines = receipt.items
    .map((it, i) => `${i + 1}. ${it.name}${it.weight ? ` (${it.weight})` : ''}\n   ${it.qty} x ${formatCurrency(it.price)} = *${formatCurrency(it.subtotal)}*`)
    .join('\n');
  const discountLine = receipt.discount && receipt.discount.amount > 0
    ? `Diskon (${receipt.discount.label}) : -${formatCurrency(receipt.discount.amount)}\n`
    : '';
  const paymentLines = receipt.paymentMethod === 'cash'
    ? `Tunai   : ${formatCurrency(receipt.amountPaid ?? 0)}\nKembali : ${formatCurrency(receipt.changeAmount ?? 0)}`
    : receipt.paymentMethod === 'kredit'
    ? `Status  : *BELUM LUNAS (KREDIT)*`
    : `Transfer ${receipt.transferBank ?? ''} : ${formatCurrency(receipt.transferAmount ?? 0)}`;
  const pdfLines = receipt.pdfUrl ? `\nInvoice PDF:\n${receipt.pdfUrl}\n${SEP}\n` : '';

  return `*${store.name.toUpperCase()}*
${store.address ? `${store.address}\n` : ''}${store.phone}
${SEP}

Halo *${receipt.customerName}*!
Berikut struk pesanan Anda:

No. Invoice : *${receipt.invoiceNo}*
Tanggal     : ${receipt.dateStr}
${SEP}
${itemLines}
${SEP}
Subtotal : ${formatCurrency(receipt.subtotal)}
${discountLine}*Total    : ${formatCurrency(receipt.total)}*
${paymentLines}
${SEP}
${pdfLines}Terima kasih telah berbelanja!
_${store.name}_`.trim();
}

// Format default untuk input datetime-local — dipakai supaya tanggal/jam transaksi bisa diedit
// (mis. transaksi baru sempat diinput belakangan), default-nya waktu sekarang.
function nowLocalInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Uang pas + beberapa pecahan umum yang dibulatkan ke atas dari total
function quickCashAmounts(total: number): number[] {
  if (total <= 0) return [];
  const steps = [5000, 10000, 20000, 50000, 100000];
  const roundUp = (n: number, to: number) => Math.ceil(n / to) * to;
  const amounts = new Set<number>([total]);
  for (const step of steps) {
    const v = roundUp(total, step);
    if (v > total) amounts.add(v);
  }
  return [...amounts].sort((a, b) => a - b).slice(0, 4);
}

// ─── POS Product Card ─────────────────────────────────────────────────────────
function PosProductCard({ product, qty, onAdd, onMinus }: {
  product: PosProduct; qty: number; onAdd: () => void; onMinus: () => void;
}) {
  const stock      = posStockStatus(product);
  const outOfStock = stock.label === 'Habis';
  return (
    <div className={`card overflow-hidden flex flex-col select-none transition-transform ${outOfStock ? '' : 'active:scale-[0.97] cursor-pointer'}`}
      onClick={outOfStock ? undefined : onAdd}>
      <div className="relative w-full aspect-square overflow-hidden" style={{ background: `${product.bgColor}22` }}>
        <ImageCarousel
          imageUrls={product.imageUrls}
          emoji={product.emoji}
          alt={product.name}
          sizes="(max-width: 640px) 50vw, 200px"
          emojiClassName="text-4xl"
          innerStyle={{ filter: outOfStock ? 'grayscale(0.8) blur(3px)' : undefined, opacity: outOfStock ? 0.55 : 1, transition: 'filter 0.15s, opacity 0.15s' }}
        />
        {outOfStock && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="badge badge-red" style={{ fontSize: 11 }}>Stok Habis</span>
          </div>
        )}
        {product.badge && !outOfStock && <span className="absolute top-2 right-2 badge badge-amber">{product.badge}</span>}
        {qty > 0 && <div className="absolute inset-0 bg-black/15 pointer-events-none" />}
        {qty > 0 && (
          <div className="absolute top-2 right-2 min-w-[24px] h-6 rounded-full text-white text-[11px] font-black flex items-center justify-center px-1.5 shadow ring-2 ring-white" style={{ background: 'var(--accent)' }}>
            {qty}
          </div>
        )}
        {qty === 0 && !outOfStock && (
          <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
            <Plus size={13} className="text-white" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div className="px-3 pt-2 pb-3 flex flex-col flex-1 gap-1.5">
        <p className="text-[11px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
          {product.name}
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          <span className={`badge ${stock.cls}`} style={{ fontSize: 10 }}>
            {stock.label}{stock === POS_STOCK_MAP.ready ? ` · ${product.stockQty ?? 0} pcs` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between mt-auto">
          <span className="text-[13px] font-black tabular" style={{ color: 'var(--accent)' }}>
            {formatCurrency(product.price)}
          </span>
          {qty > 0 ? (
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <Tooltip label="Kurangi jumlah">
                <button onClick={e => { e.stopPropagation(); onMinus(); }}
                  className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                  <Minus size={10} strokeWidth={2.5} />
                </button>
              </Tooltip>
              <span className="text-[13px] font-black w-4 text-center tabular" style={{ color: 'var(--text-primary)' }}>{qty}</span>
              <Tooltip label="Tambah jumlah">
                <button onClick={e => { e.stopPropagation(); onAdd(); }}
                  className="w-6 h-6 rounded-full text-white flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                  <Plus size={10} strokeWidth={2.5} />
                </button>
              </Tooltip>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface PosTabProps {
  creds: string;
  posProducts: PosProduct[];
  posCategories: PosCategory_Entry[];
  resellerList: PosReseller[];
  customerList: PosCustomer[];
  bankOptions: PosBank[];
  isActive: boolean;
  username: string;
  onCartChange: (count: number) => void;
  onGoToOrders: () => void;
  onRefresh: () => Promise<void> | void;
  onRefreshStock: () => Promise<void> | void;
}

export default function PosTab({
  creds, posProducts, posCategories, resellerList, customerList, bankOptions,
  isActive, username, onCartChange, onGoToOrders, onRefresh, onRefreshStock,
}: PosTabProps) {
  const [posView,      setPosView]      = useState<PosView>('products');
  const [activeCat,    setActiveCat]    = useState<string>('semua');
  const [query,        setQuery]        = useState('');
  const [cart,         setCart]         = useState<CartEntry[]>([]);
  const [customItems,        setCustomItems]        = useState<CustomItem[]>([]);
  const [showCustomItemForm, setShowCustomItemForm] = useState(false);
  const [customItemName,     setCustomItemName]     = useState('');
  const [customItemPriceRaw, setCustomItemPriceRaw] = useState('');
  const [custName,     setCustName]     = useState('');
  const [custPhone,    setCustPhone]    = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'nominal'>('percent');
  const [discountRaw,  setDiscountRaw]  = useState('');
  const [sellAsPO,     setSellAsPO]     = useState(false);
  const [paymentMethod,     setPaymentMethod]     = useState<PaymentMethod>('cash');
  const [walletId,          setWalletId]          = useState('');
  const [amountPaidRaw,     setAmountPaidRaw]     = useState('');
  const [transferBank,      setTransferBank]      = useState('');
  const [transferAmountRaw, setTransferAmountRaw] = useState('');
  const [transferProofUrl,        setTransferProofUrl]        = useState('');
  const [transferProofUploading,  setTransferProofUploading]  = useState(false);
  const [ocrStatus,               setOcrStatus]               = useState<OcrStatus>('idle');
  const [proofLightboxOpen,       setProofLightboxOpen]       = useState(false);
  const [selectedCustRef, setSelectedCustRef] = useState('');
  const [currentShift,      setCurrentShift]      = useState<CashierShift | null>(null);
  const [shiftLoaded,       setShiftLoaded]       = useState(false);
  const [shiftModal,        setShiftModal]        = useState<'open' | 'close' | null>(null);
  const [shiftInputRaw,     setShiftInputRaw]     = useState('');
  const [shiftNote,         setShiftNote]         = useState('');
  const [shiftSubmitting,   setShiftSubmitting]   = useState(false);
  const [processing,   setProcessing]   = useState(false);
  const [processErr,   setProcessErr]   = useState('');
  const [invoiceNo,    setInvoiceNo]    = useState('');
  const [lastReceipt,  setLastReceipt]  = useState<ReceiptData | null>(null);
  const [receiptPrintedAt, setReceiptPrintedAt] = useState('');
  const [waPhoneDraft, setWaPhoneDraft] = useState('');
  const [heldTransactions, setHeldTransactions] = useState<HeldTransaction[]>([]);
  const [heldLoading,      setHeldLoading]      = useState(false);
  const [heldModalOpen,    setHeldModalOpen]    = useState(false);
  const [reportOpen,      setReportOpen]      = useState(false);
  const [reportLoading,   setReportLoading]   = useState(false);
  const [reportData,      setReportData]      = useState<SalesReportData | null>(null);
  const [txDateTime, setTxDateTime] = useState('');
  useEffect(() => { setTxDateTime(nowLocalInput()); }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [storeInfo, setStoreInfo] = useState<StoreInfo>({});
  const toast = useToast();
  const wallets = useWallets(creds);
  const [walletBalances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

  // ── Info toko (nama, alamat, telepon, logo) — dipakai di struk cetak & pesan WA ──
  useEffect(() => {
    if (!creds) return;
    fetch('/api/settings', { headers: { 'x-admin-auth': creds } }).then(async r => {
      if (r.ok) setStoreInfo((await r.json() as { settings: StoreInfo }).settings ?? {});
    }).catch(() => {});
  }, [creds]);
  const storeName    = storeInfo.storeName?.trim() || 'Cemilan Teh Risma';
  const storeAddress = [storeInfo.address, storeInfo.city].filter(Boolean).join(', ');
  const storePhone   = (storeInfo.whatsapp?.trim() || WHATSAPP_NUMBER)
    .replace(/^62/, '0').replace(/(\d{4})(\d{4})(\d+)/, '$1-$2-$3');
  const storeLogo    = storeInfo.logo;
  const posWarehouseId   = storeInfo.posWarehouseId || '';
  const posWarehouseName = storeInfo.posWarehouseName || '';

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([onRefresh(), fetchHeldTransactions()]);
      toast.success('Data kasir diperbarui.');
    } catch {
      toast.error('Gagal memuat ulang data.');
    } finally {
      setRefreshing(false);
    }
  };

  // Mulai transaksi baru: reset form lalu muat ulang data kasir (produk/stok terbaru)
  // secara otomatis di latar belakang, tanpa menahan kasir menunggu.
  const handleNewTransaction = () => {
    resetPOS();
    Promise.resolve(onRefreshStock()).catch(() => toast.error('Gagal memuat ulang data.'));
  };

  // ── Cart computations ────────────────────────────────────
  const getQty       = (id: string) => cart.find(i => i.productId === id)?.qty ?? 0;
  const cartItems    = cart.filter(i => i.qty > 0);
  const customItemsTotal = customItems.reduce((s, i) => s + i.price * i.qty, 0);
  const customItemsCount = customItems.reduce((s, i) => s + i.qty, 0);
  const cartCount    = cartItems.reduce((s, i) => s + i.qty, 0) + customItemsCount;
  const cartSubtotal = cartItems.reduce((s, i) => {
    const p = posProducts.find(pr => pr.id === i.productId);
    return s + (p?.price ?? 0) * i.qty;
  }, 0) + customItemsTotal;
  // Math.max(0, ...) — kolom diskon persen pakai <input type="number"> polos yang tidak menolak
  // tanda minus saat diketik (atribut min="0" tidak dipaksakan ke keystroke), jadi tanpa clamp di
  // sini nilai negatif membuat discountAmount ikut negatif dan justru MENAMBAH total, bukan
  // menguranginya.
  const discountNum    = Math.max(0, parseFloat(discountRaw) || 0);
  const discountAmount = discountType === 'percent'
    ? Math.min(Math.round(cartSubtotal * discountNum / 100), cartSubtotal)
    : Math.min(discountNum, cartSubtotal);
  const discountLabel = discountType === 'percent' ? `${discountNum}%` : formatCurrency(discountAmount);
  const discountInfo  = discountAmount > 0 ? { amount: discountAmount, label: discountLabel } : undefined;
  const cartTotal = cartSubtotal - discountAmount;
  const hasCart   = cartItems.length > 0 || customItems.length > 0;
  // Kalau keranjang berisi produk "Buka PO", kasir BOLEH (tidak otomatis) menandai transaksi ini
  // sebagai PO lewat checkbox "Jual sebagai PO" — lepas dari stok saat ini. Kalau ditandai, server
  // menyimpan pesanan sebagai 'baru' tanpa memotong stok sekarang, persis pesanan Website, baru
  // dipotong setelah ditandai Selesai di menu Pesanan (lihat POST /api/orders). Kalau tidak
  // ditandai, transaksi dijual normal seperti biasa (perlu stok cukup).
  const cartHasOpenPO = cartItems.some(i => posProducts.find(p => p.id === i.productId)?.openPO);
  const amountPaidNum      = parseFloat(amountPaidRaw) || 0;
  const changeAmount       = amountPaidNum - cartTotal;
  const transferAmountNum  = parseFloat(transferAmountRaw) || 0;
  const transferDiff       = transferAmountNum - cartTotal;
  const selectedReseller = selectedCustRef.startsWith('reseller:')
    ? resellerList.find(r => r.id === selectedCustRef.slice('reseller:'.length))
    : undefined;
  // Kredit (belum lunas) boleh untuk pelanggan umum juga, tidak cuma reseller — transaksinya
  // tetap tercatat di menu Pesanan dan bisa ditandai Lunas begitu pelanggan bayar.
  const availablePaymentMethods = [...PAYMENT_METHODS, KREDIT_METHOD];
  const canProcess = hasCart
    && (paymentMethod !== 'cash'     || amountPaidNum >= cartTotal)
    && (paymentMethod !== 'transfer' || (transferBank && transferAmountNum >= cartTotal))
    && (paymentMethod === 'kredit'   || !!walletId);

  const filteredProducts = (activeCat === 'semua' ? posProducts : posProducts.filter(p => p.category === activeCat))
    .filter(p => p.published !== false)
    .filter(p => query.trim() === '' || p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice()
    .sort((a, b) => {
      const aHabis = posStockStatus(a) === POS_STOCK_MAP.habis ? 1 : 0;
      const bHabis = posStockStatus(b) === POS_STOCK_MAP.habis ? 1 : 0;
      if (aHabis !== bHabis) return aHabis - bHabis;
      return (a.order ?? 9999) - (b.order ?? 9999);
    });

  const addToCart = (id: string) => setCart(prev => {
    const exists = prev.find(i => i.productId === id);
    if (exists) return prev.map(i => i.productId === id ? { ...i, qty: i.qty + 1 } : i);
    return [...prev, { productId: id, qty: 1 }];
  });
  const [showPosScanner, setShowPosScanner] = useState(false);
  const handlePosScan = (text: string) => {
    const productId = resolveScannedProductId(text, posProducts);
    const product = productId ? posProducts.find(p => p.id === productId) : undefined;
    if (!product) { toast.error('Produk tidak dikenali dari QR ini.'); return { ok: false, label: 'Produk tidak dikenali' }; }
    if (posStockStatus(product).label === 'Habis') {
      toast.error(`${product.name} stoknya habis.`);
      return { ok: false, label: `${product.name} — stok habis` };
    }
    addToCart(product.id);
    return { ok: true, label: `+1 ${product.name}` };
  };
  const removeFromCart = (id: string) => setCart(prev =>
    prev.flatMap(i => i.productId === id
      ? i.qty > 1 ? [{ ...i, qty: i.qty - 1 }] : []
      : [i]
    )
  );

  // Item bebas input (bukan produk katalog) — bisa ditambahkan berkali-kali, tiap satu jadi
  // baris tersendiri di keranjang/struk supaya keterangannya tetap jelas per item.
  const addCustomItem = () => {
    const name  = customItemName.trim();
    const price = parseFloat(customItemPriceRaw) || 0;
    if (!name || price <= 0) return;
    setCustomItems(prev => [...prev, { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, price, qty: 1 }]);
    setCustomItemName(''); setCustomItemPriceRaw(''); setShowCustomItemForm(false);
  };
  const removeCustomItem    = (id: string) => setCustomItems(prev => prev.filter(i => i.id !== id));
  const addCustomItemQty    = (id: string) => setCustomItems(prev => prev.map(i => i.id === id ? { ...i, qty: i.qty + 1 } : i));
  const removeCustomItemQty = (id: string) => setCustomItems(prev =>
    prev.flatMap(i => i.id === id ? (i.qty > 1 ? [{ ...i, qty: i.qty - 1 }] : []) : [i])
  );

  const clearCart = () => { setCart([]); setCustomItems([]); };
  const resetPOS = () => {
    setPosView('products'); setActiveCat('semua'); setQuery(''); clearCart();
    setShowCustomItemForm(false); setCustomItemName(''); setCustomItemPriceRaw('');
    setCustName(''); setCustPhone(''); setDiscountType('percent'); setDiscountRaw(''); setSellAsPO(false);
    setPaymentMethod('cash'); setWalletId(getLastWallet('cash')); setAmountPaidRaw(''); setTransferBank(''); setTransferAmountRaw('');
    setTransferProofUrl(''); setTransferProofUploading(false); setOcrStatus('idle');
    setSelectedCustRef(''); setTxDateTime(() => nowLocalInput());
    setProcessing(false); setProcessErr(''); setInvoiceNo(''); setLastReceipt(null); setWaPhoneDraft('');
  };

  // ── Foto bukti transfer: kompres, upload, & coba baca nominal otomatis ──
  const compressReceiptImage = async (file: File): Promise<File> => {
    const MAX_PX = 1200;
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    return new Promise(resolve =>
      canvas.toBlob(
        blob => resolve(new File([blob!], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', 0.82,
      ),
    );
  };

  const handleTransferProofSelect = async (file: File | undefined) => {
    if (!file) return;
    setTransferProofUploading(true);
    setOcrStatus('reading');
    try {
      const compressed = await compressReceiptImage(file);

      const uploadPromise = (async () => {
        const form = new FormData();
        form.append('file', compressed);
        const r = await fetch('/api/upload', { method: 'POST', headers: { 'x-admin-auth': creds }, body: form });
        if (!r.ok) throw new Error('upload failed');
        return (await r.json() as { url: string }).url;
      })();

      const [uploadResult, ocrResult] = await Promise.allSettled([
        uploadPromise,
        recognizeTransferAmount(compressed),
      ]);

      if (uploadResult.status === 'fulfilled') {
        setTransferProofUrl(uploadResult.value);
      } else {
        toast.error('Upload foto bukti transfer gagal, coba lagi.');
      }

      const detected = ocrResult.status === 'fulfilled' ? ocrResult.value : null;
      if (detected && !transferAmountRaw.trim()) {
        setTransferAmountRaw(String(detected));
        setOcrStatus('done');
      } else if (!transferAmountRaw.trim()) {
        setOcrStatus('failed');
      } else {
        setOcrStatus('idle'); // sudah ada nominal manual — abaikan hasil OCR diam-diam
      }
    } finally {
      setTransferProofUploading(false);
    }
  };

  // ── Laporkan jumlah cart ke parent (untuk badge sidebar/bottom-nav) ──
  useEffect(() => { onCartChange(cartCount); }, [cartCount, onCartChange]);

  // ── Transaksi tertahan (Hold/Pending) — disimpan di server (Firestore) supaya
  // bisa dilanjutkan dari perangkat manapun, bukan cuma perangkat yang menahannya.
  const fetchHeldTransactions = async () => {
    if (!creds) return;
    setHeldLoading(true);
    try {
      const r = await fetch('/api/pos/held', { headers: { 'x-admin-auth': creds } });
      if (r.ok) setHeldTransactions((await r.json() as { held: HeldTransaction[] }).held);
    } catch { /* biarkan daftar lama tampil kalau gagal muat ulang */ }
    setHeldLoading(false);
  };
  useEffect(() => {
    if (!isActive || !creds) return;
    fetchHeldTransactions();
  }, [isActive, creds]); // eslint-disable-line react-hooks/exhaustive-deps

  const heldTotal = (h: HeldTransaction) => {
    const subtotal = h.cart.reduce((s, i) => {
      const p = posProducts.find(pr => pr.id === i.productId);
      return s + (p?.price ?? 0) * i.qty;
    }, 0) + (h.customItems ?? []).reduce((s, i) => s + i.price * i.qty, 0);
    const discNum = Math.max(0, parseFloat(h.discountRaw) || 0);
    const disc = h.discountType === 'percent'
      ? Math.min(Math.round(subtotal * discNum / 100), subtotal)
      : Math.min(discNum, subtotal);
    return subtotal - disc;
  };
  const heldItemCount = (h: HeldTransaction) =>
    h.cart.reduce((s, i) => s + i.qty, 0) + (h.customItems ?? []).reduce((s, i) => s + i.qty, 0);

  // Kirim keranjang berjalan ke server sebagai transaksi tertahan; mengembalikan
  // record tersimpan (dengan id dari server) atau null kalau gagal.
  const holdCurrentCart = async (createdAt: number): Promise<HeldTransaction | null> => {
    const body = {
      label: custName.trim() || `Transaksi ${heldTransactions.length + 1}`,
      cart: cartItems, customItems, custName, custPhone, discountType, discountRaw, paymentMethod,
      amountPaidRaw, transferBank, transferAmountRaw, transferProofUrl, selectedCustRef,
      createdAt,
    };
    try {
      const r = await fetch('/api/pos/held', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify(body),
      });
      if (!r.ok) return null;
      return (await r.json() as { held: HeldTransaction }).held;
    } catch { return null; }
  };

  // Tahan transaksi berjalan: simpan ke server lalu kosongkan form untuk pelanggan berikutnya
  const holdTransaction = async () => {
    if (!hasCart) return;
    const held = await holdCurrentCart(Date.now());
    if (!held) { toast.error('Gagal menahan transaksi.'); return; }
    setHeldTransactions(prev => [...prev, held]);
    clearCart(); setCustName(''); setCustPhone(''); setDiscountType('percent'); setDiscountRaw('');
    setPaymentMethod('cash'); setWalletId(getLastWallet('cash')); setAmountPaidRaw(''); setTransferBank(''); setTransferAmountRaw('');
    setTransferProofUrl(''); setOcrStatus('idle'); setSelectedCustRef(''); setProcessErr('');
    setPosView('products');
    toast.success('Transaksi ditahan. Lanjutkan lagi lewat menu "Tertahan" dari perangkat manapun.');
  };

  // Lanjutkan transaksi tertahan — kalau ada keranjang berjalan, itu ikut ditahan dulu supaya tidak hilang
  const resumeHeldTransaction = async (h: HeldTransaction) => {
    if (hasCart && !window.confirm('Keranjang saat ini akan ditahan otomatis agar tidak hilang. Lanjutkan ke transaksi tertahan ini?')) return;
    if (hasCart) {
      const held = await holdCurrentCart(Date.now());
      if (!held) { toast.error('Gagal menahan keranjang saat ini.'); return; }
      setHeldTransactions(prev => [...prev.filter(x => x.id !== h.id), held]);
    }
    fetch(`/api/pos/held/${h.id}`, { method: 'DELETE', headers: { 'x-admin-auth': creds } }).catch(() => {});
    setHeldTransactions(prev => prev.filter(x => x.id !== h.id));
    setCart(h.cart); setCustomItems(h.customItems ?? []); setCustName(h.custName); setCustPhone(h.custPhone);
    setDiscountType(h.discountType); setDiscountRaw(h.discountRaw);
    setPaymentMethod(h.paymentMethod); setAmountPaidRaw(h.amountPaidRaw);
    setTransferBank(h.transferBank); setTransferAmountRaw(h.transferAmountRaw);
    setTransferProofUrl(h.transferProofUrl); setSelectedCustRef(h.selectedCustRef);
    setOcrStatus('idle'); setProcessErr('');
    setHeldModalOpen(false);
    setPosView('cart');
  };

  const deleteHeldTransaction = async (id: string) => {
    if (!window.confirm('Hapus transaksi tertahan ini? Tindakan ini tidak bisa dibatalkan.')) return;
    const prev = heldTransactions;
    setHeldTransactions(cur => cur.filter(x => x.id !== id));
    const r = await fetch(`/api/pos/held/${id}`, { method: 'DELETE', headers: { 'x-admin-auth': creds } }).catch(() => null);
    if (!r || !r.ok) { setHeldTransactions(prev); toast.error('Gagal menghapus transaksi tertahan.'); }
  };

  // ── Laporan Penjualan — omzet, produk terlaris & laba hari ini ────────────
  // Semua penghitungan (termasuk penentuan "hari ini") dilakukan di dalam handler
  // async ini, bukan langsung di badan komponen, supaya tidak impure saat render.
  const fetchSalesReport = async () => {
    setReportLoading(true);
    try {
      const r = await fetch('/api/orders?limit=500', { headers: { 'x-admin-auth': creds } });
      if (!r.ok) { toast.error('Gagal memuat laporan penjualan.'); return; }
      const { orders } = await r.json() as { orders: PosOrderRecord[] };
      const todayKey = new Date().toDateString();
      const todaysOrders = orders.filter(o =>
        o.createdAt?.seconds && new Date(o.createdAt.seconds * 1000).toDateString() === todayKey
        && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan'
        && (o.status !== 'baru')
      );
      const omzet = todaysOrders.reduce((s, o) => s + (o.total ?? 0), 0);
      const count = todaysOrders.length;

      const productMap = new Map<string, { qty: number; revenue: number; cost: number }>();
      todaysOrders.forEach(o => o.items?.forEach(it => {
        const product = posProducts.find(p => p.name === it.name);
        const entry = productMap.get(it.name) ?? { qty: 0, revenue: 0, cost: 0 };
        entry.qty += it.qty;
        entry.revenue += it.subtotal;
        entry.cost += (product?.costPrice ?? 0) * it.qty;
        productMap.set(it.name, entry);
      }));
      const topProducts = [...productMap.entries()]
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, 5)
        .map(([name, v]) => ({ name, ...v }));
      const totalCost   = [...productMap.values()].reduce((s, v) => s + v.cost, 0);
      const hasCostData = [...productMap.keys()].some(name =>
        (posProducts.find(p => p.name === name)?.costPrice ?? 0) > 0
      );

      setReportData({
        omzet, count, avg: count > 0 ? Math.round(omzet / count) : 0,
        profit: omzet - totalCost, hasCostData, topProducts,
      });
    } catch { toast.error('Gagal memuat laporan penjualan.'); }
    finally { setReportLoading(false); }
  };
  useEffect(() => { if (reportOpen) fetchSalesReport(); }, [reportOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sesi kasir — muat status shift terbuka saat tab Kasir dibuka ──
  useEffect(() => {
    if (!isActive || !creds || shiftLoaded) return;
    fetch('/api/pos/shifts', { headers: { 'x-admin-auth': creds } }).then(async r => {
      if (r.ok) setCurrentShift((await r.json() as { shift: CashierShift | null }).shift);
      setShiftLoaded(true);
    }).catch(() => setShiftLoaded(true));
  }, [isActive, creds, shiftLoaded]);

  // ── Refresh stok otomatis: langsung saat tab Kasir dibuka, lalu tiap STOCK_POLL_MS
  // selama tab masih aktif & jendela browser terlihat (auto-pause di tab background) ──
  const pollStock = () => { if (isActive) Promise.resolve(onRefreshStock()).catch(() => {}); };
  useVisiblePolling(pollStock, STOCK_POLL_MS, [isActive]);

  // ── Proses transaksi ──────────────────────────────────────
  const processTransaction = async () => {
    if (!canProcess) return;
    setProcessing(true); setProcessErr('');
    try {
      const now   = txDateTime ? new Date(txDateTime) : new Date();
      const pad   = (n: number) => n.toString().padStart(2, '0');
      const invNo = `INV-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const finalCustName = custName.trim() || 'Pelanggan Umum';
      // Item bebas input tidak punya productId — server (/api/orders) sudah didesain untuk skip
      // pemotongan stok & HPP untuk item semacam ini, jadi aman digabung apa adanya ke `items`.
      const items = [
        ...cartItems.map(i => {
          const p = posProducts.find(pr => pr.id === i.productId)!;
          return { productId: i.productId, name: p.name, weight: p.weight, qty: i.qty, price: p.price, subtotal: p.price * i.qty };
        }),
        ...customItems.map(ci => ({ name: ci.name, weight: '', qty: ci.qty, price: ci.price, subtotal: ci.price * ci.qty })),
      ];
      const res = await fetch(`${MAIN_APP}/api/admin/invoice-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({
          invoiceNo: invNo, date: dateStr, customerName: finalCustName, customerPhone: custPhone, items, subtotal: cartSubtotal, discount: discountInfo, total: cartTotal, logo: '', halalLogo: '',
          source: 'kasir',
          paymentStatus: paymentMethod === 'kredit' ? 'belum_lunas' : 'lunas',
        }),
      });
      if (!res.ok) throw new Error('Gagal generate PDF');
      const { url: pdfUrl } = await res.json() as { url: string };
      const reseller = selectedReseller;
      const selectedCustomer = selectedCustRef.startsWith('customer:')
        ? customerList.find(c => c.id === selectedCustRef.slice('customer:'.length))
        : undefined;
      const bank = bankOptions.find(b => b.code === transferBank);
      // Order & potong stok jadi satu transaksi atomik di server (lihat POST /api/orders) — kalau
      // stok tidak cukup, order ini tidak tersimpan sama sekali, jadi responsnya wajib dicek.
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({
          invoiceNo: invNo, date: dateStr, transactionAt: now.toISOString(), customerName: finalCustName, customerPhone: custPhone, items,
          subtotal: cartSubtotal, discount: discountInfo, total: cartTotal, pdfUrl,
          paymentMethod,
          ...(paymentMethod === 'cash' ? { amountPaid: amountPaidNum, changeAmount } : {}),
          ...(paymentMethod === 'transfer' ? { transferBank: bank?.name ?? transferBank, transferAmount: transferAmountNum, ...(transferProofUrl ? { transferProofUrl } : {}) } : {}),
          ...(paymentMethod === 'kredit' ? { paymentStatus: 'belum_lunas' } : { walletId }),
          ...(reseller ? { resellerId: reseller.id, customerId: reseller.customerId } : {}),
          ...(!reseller && selectedCustomer ? { customerId: selectedCustomer.id } : {}),
          ...(currentShift ? { shiftId: currentShift.id } : {}),
          ...(posWarehouseId ? { warehouseId: posWarehouseId, warehouseName: posWarehouseName } : {}),
          ...(cartHasOpenPO && sellAsPO ? { isPreOrder: true } : {}),
        }),
      });
      if (!orderRes.ok) {
        const { error } = await orderRes.json().catch(() => ({ error: undefined })) as { error?: string };
        throw new Error(error ?? 'Gagal menyimpan transaksi.');
      }

      refetchBalances();
      setLastReceipt({
        invoiceNo: invNo, dateStr, items, subtotal: cartSubtotal, discount: discountInfo, total: cartTotal,
        paymentMethod,
        ...(paymentMethod === 'cash' ? { amountPaid: amountPaidNum, changeAmount } : {}),
        ...(paymentMethod === 'transfer' ? { transferBank: bank?.name ?? transferBank, transferAmount: transferAmountNum, ...(transferProofUrl ? { transferProofUrl } : {}) } : {}),
        customerName: finalCustName, customerPhone: custPhone, cashier: username, pdfUrl,
      });
      if (paymentMethod !== 'kredit' && walletId) setLastWallet(paymentMethod, walletId);
      if (cartHasOpenPO && sellAsPO) toast.success('Pesanan PO tersimpan sebagai "Baru" — tandai Selesai di menu Pesanan begitu barangnya siap, baru stoknya dipotong.');
      else if (paymentMethod === 'kredit') toast.success(`Transaksi kredit tersimpan — tandai Lunas di menu Pesanan kalau ${finalCustName} sudah bayar.`);
      setInvoiceNo(invNo);
      setWaPhoneDraft(custPhone);
      setPosView('done');
    } catch (err) {
      setProcessErr(err instanceof Error ? err.message : 'Gagal memproses transaksi. Coba lagi.');
    }
    finally { setProcessing(false); }
  };

  const sendWhatsApp = () => {
    if (!lastReceipt) return;
    const phone = waPhoneDraft.trim();
    if (!phone) { toast.error('Isi nomor WhatsApp pelanggan dulu.'); return; }
    const message = formatWAMessage(lastReceipt, { name: storeName, address: storeAddress, phone: storePhone });
    window.open(
      `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`,
      '_blank'
    );
  };

  const printReceipt = () => {
    setReceiptPrintedAt(new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    setTimeout(() => window.print(), 0);
  };

  // ── Sesi kasir — buka/tutup shift ─────────────────────────
  const openShift = async () => {
    const openingBalance = parseFloat(shiftInputRaw) || 0;
    setShiftSubmitting(true);
    try {
      const r = await fetch('/api/pos/shifts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({ openingBalance, note: shiftNote }),
      });
      const data = await r.json() as { shift?: CashierShift; error?: string };
      if (!r.ok || !data.shift) { toast.error(data.error ?? 'Gagal membuka sesi kasir.'); return; }
      setCurrentShift(data.shift);
      setShiftModal(null); setShiftInputRaw(''); setShiftNote('');
      toast.success('Sesi kasir dibuka.');
    } catch { toast.error('Gagal membuka sesi kasir.'); }
    finally { setShiftSubmitting(false); }
  };

  const closeShift = async () => {
    if (!currentShift) return;
    const actualBalance = parseFloat(shiftInputRaw) || 0;
    setShiftSubmitting(true);
    try {
      const r = await fetch(`/api/pos/shifts/${currentShift.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({ actualBalance, note: shiftNote }),
      });
      const data = await r.json() as { shift?: CashierShift & { difference?: number }; error?: string };
      if (!r.ok || !data.shift) { toast.error(data.error ?? 'Gagal menutup sesi kasir.'); return; }
      setCurrentShift(null);
      setShiftModal(null); setShiftInputRaw(''); setShiftNote('');
      const diff = data.shift.difference ?? 0;
      toast.success(diff === 0 ? 'Sesi kasir ditutup, kas pas.' : `Sesi kasir ditutup, selisih ${formatCurrency(diff)}.`);
    } catch { toast.error('Gagal menutup sesi kasir.'); }
    finally { setShiftSubmitting(false); }
  };

  // ─── Catalog (search + kategori + grid produk) ────────────────────────────
  const catalogContent = (
    <div className="flex flex-col h-full relative">
      <div className="flex-shrink-0 px-4 pt-4 pb-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              className="input" style={{ paddingLeft: 38 }} placeholder="Cari produk…" />
          </div>
          <Tooltip label="Scan Produk">
            <button onClick={() => setShowPosScanner(true)} type="button"
              className="btn-ghost p-2.5 flex-shrink-0" style={{ color: 'var(--accent)' }}>
              <ScanLine size={18} />
            </button>
          </Tooltip>
        </div>
        <ScrollChips gap="gap-2">
          {[POS_CAT_ALL, ...posCategories].map(c => (
            <button key={c.id} onClick={() => setActiveCat(c.id)}
              className={`tab-chip ${activeCat === c.id ? 'active' : ''}`}>
              <span>{c.emoji}</span> {c.label}
            </button>
          ))}
        </ScrollChips>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-44 lg:pb-4 thin-scrollbar">
        {posProducts.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Produk tidak ditemukan.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredProducts.map(p => (
              <PosProductCard key={p.id} product={p} qty={getQty(p.id)}
                onAdd={() => addToCart(p.id)} onMinus={() => removeFromCart(p.id)} />
            ))}
          </div>
        )}
      </div>
      {hasCart && (
        <div className="lg:hidden fixed left-0 right-0 px-4 pt-3 z-40"
          style={{
            bottom: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 10px)',
            background: 'linear-gradient(to top, var(--ground) 75%, transparent)',
          }}>
          <button onClick={() => setPosView('cart')}
            className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-white font-bold shadow-2xl"
            style={{ background: 'linear-gradient(135deg,#E8821A,#C96018)' }}>
            <div className="relative">
              <ShoppingCart size={19} />
              <span className="absolute -top-2 -right-2.5 w-5 h-5 rounded-full bg-white text-[10px] font-black flex items-center justify-center shadow" style={{ color: 'var(--accent)' }}>
                {cartCount}
              </span>
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-[11px] text-white/70 truncate">{cartItems.length + customItems.length} item · {cartCount} pcs</p>
              <p className="text-[15px] font-black tabular">{formatCurrency(cartTotal)}</p>
            </div>
            <span className="text-sm opacity-90 flex-shrink-0">Checkout →</span>
          </button>
        </div>
      )}
    </div>
  );

  // ─── Order panel (keranjang, diskon, pembayaran, customer) ────────────────
  const orderPanelContent = (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto thin-scrollbar px-4 py-4 space-y-3">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-2)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Pesanan {hasCart && <span style={{ color: 'var(--accent)' }}>({cartCount} pcs)</span>}
            </span>
            {hasCart && (
              <div className="flex items-center gap-3">
                <button onClick={holdTransaction} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                  <PauseCircle size={12} /> Tahan
                </button>
                <button onClick={clearCart} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                  <Trash2 size={12} /> Kosongkan
                </button>
              </div>
            )}
          </div>
          {!hasCart ? (
            <div className="px-4 py-8 text-center space-y-3">
              <div>
                <ShoppingCart size={26} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada item. Pilih produk di sebelah kiri.</p>
              </div>
            </div>
          ) : (
            <>
              {cartItems.length > 0 && (
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                {cartItems.map(item => {
                  const p = posProducts.find(pr => pr.id === item.productId);
                  if (!p) return null;
                  const imgUrl = p.imageUrls?.[0];
                  return (
                    <div key={item.productId} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 relative" style={{ background: `${p.bgColor}22` }}>
                        {imgUrl ? <Image src={imgUrl} alt={p.name} fill className="object-contain" sizes="40px" unoptimized />
                                : <div className="w-full h-full flex items-center justify-center text-lg">{p.emoji}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                        <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>{formatCurrency(p.price)} / pcs</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Tooltip label="Kurangi jumlah">
                          <button onClick={() => removeFromCart(item.productId)}
                            className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                            <Minus size={11} strokeWidth={2.5} />
                          </button>
                        </Tooltip>
                        <span className="w-5 text-center text-sm font-black tabular" style={{ color: 'var(--text-primary)' }}>{item.qty}</span>
                        <Tooltip label="Tambah jumlah">
                          <button onClick={() => addToCart(item.productId)}
                            className="w-7 h-7 rounded-full text-white flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                            <Plus size={11} strokeWidth={2.5} />
                          </button>
                        </Tooltip>
                      </div>
                      <span className="text-sm font-bold tabular w-16 text-right flex-shrink-0" style={{ color: 'var(--accent-dark)' }}>
                        {formatCurrency(p.price * item.qty)}
                      </span>
                    </div>
                  );
                })}
              </div>
              )}
              {customItems.length > 0 && (
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)', borderTop: '1px solid var(--border-2)' }}>
                {customItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                      <Tag size={15} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                      <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>{formatCurrency(item.price)} / item · bebas input</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tooltip label="Kurangi jumlah">
                        <button onClick={() => removeCustomItemQty(item.id)}
                          className="w-7 h-7 rounded-full flex items-center justify-center"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                          <Minus size={11} strokeWidth={2.5} />
                        </button>
                      </Tooltip>
                      <span className="w-5 text-center text-sm font-black tabular" style={{ color: 'var(--text-primary)' }}>{item.qty}</span>
                      <Tooltip label="Tambah jumlah">
                        <button onClick={() => addCustomItemQty(item.id)}
                          className="w-7 h-7 rounded-full text-white flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                          <Plus size={11} strokeWidth={2.5} />
                        </button>
                      </Tooltip>
                    </div>
                    <span className="text-sm font-bold tabular w-16 text-right flex-shrink-0" style={{ color: 'var(--accent-dark)' }}>
                      {formatCurrency(item.price * item.qty)}
                    </span>
                    <Tooltip label="Hapus item">
                      <button onClick={() => removeCustomItem(item.id)}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ color: 'var(--danger)' }}>
                        <Trash2 size={12} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
              )}
              <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-2)' }}>
                {showCustomItemForm ? (
                  <div className="space-y-2">
                    <input type="text" value={customItemName} onChange={e => setCustomItemName(e.target.value)}
                      className="input" placeholder="Nama item / keterangan (mis. Ongkir, Bungkus kado)" autoFocus />
                    <NumberInput value={customItemPriceRaw} onChange={setCustomItemPriceRaw} placeholder="Nominal (Rp)" />
                    <div className="flex gap-2">
                      <button onClick={() => { setShowCustomItemForm(false); setCustomItemName(''); setCustomItemPriceRaw(''); }}
                        className="btn-ghost flex-1 justify-center py-2 text-xs font-semibold">
                        Batal
                      </button>
                      <button onClick={addCustomItem} disabled={!customItemName.trim() || !(parseFloat(customItemPriceRaw) > 0)}
                        className="btn-primary flex-1 justify-center py-2 text-xs disabled:opacity-40">
                        Tambah
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowCustomItemForm(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold"
                    style={{ color: 'var(--accent)', background: 'var(--accent-bg)' }}>
                    <Plus size={12} /> Tambah Item / Nominal Lain
                  </button>
                )}
              </div>
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)', borderTop: '1px solid var(--border-2)' }}>
                {discountAmount > 0 && (
                  <>
                    <div className="px-4 py-2.5 flex justify-between">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Subtotal</span>
                      <span className="text-sm font-semibold tabular" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(cartSubtotal)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between" style={{ background: 'var(--success-bg)' }}>
                      <span className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--success)' }}>
                        <Tag size={11} /> Diskon ({discountLabel})
                      </span>
                      <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>− {formatCurrency(discountAmount)}</span>
                    </div>
                  </>
                )}
                <div className="px-4 py-3.5 flex justify-between" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Bayar</span>
                  <span className="text-xl font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatCurrency(cartTotal)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {hasCart && (
          <>
            {/* Tanggal & Waktu Transaksi */}
            <div className="card p-4">
              <p className="section-label mb-3 flex items-center gap-1.5"><CalendarClock size={11} /> Tanggal & Waktu Transaksi</p>
              <input type="datetime-local" value={txDateTime} onChange={e => setTxDateTime(e.target.value)} className="input" />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Default sekarang — ubah kalau transaksi ini baru sempat diinput belakangan.
              </p>
            </div>

            {/* Discount */}
            <div className="card p-4">
              <p className="section-label mb-3 flex items-center gap-1.5"><Tag size={11} /> Diskon (opsional)</p>
              <div className="flex gap-2">
                <div className="flex rounded-xl overflow-hidden border text-xs font-bold flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
                  {(['percent', 'nominal'] as const).map(t => (
                    <button key={t} onClick={() => { setDiscountType(t); setDiscountRaw(''); }}
                      className="px-3.5 py-2.5 transition-all"
                      style={discountType === t ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                      {t === 'percent' ? '%' : 'Rp'}
                    </button>
                  ))}
                </div>
                {discountType === 'percent' ? (
                  <input type="number" min="0" value={discountRaw} onChange={e => setDiscountRaw(e.target.value)}
                    className="input flex-1" placeholder="Contoh: 10" />
                ) : (
                  <NumberInput value={discountRaw} onChange={setDiscountRaw}
                    className="input flex-1" placeholder="Contoh: 5.000" />
                )}
                {discountRaw && (
                  <button onClick={() => setDiscountRaw('')} className="btn-ghost px-3 text-xs" style={{ color: 'var(--danger)' }}>✕</button>
                )}
              </div>
              {discountAmount > 0 && (
                <p className="text-xs mt-2 font-medium" style={{ color: 'var(--success)' }}>
                  Hemat {formatCurrency(discountAmount)} → bayar {formatCurrency(cartTotal)}
                </p>
              )}
            </div>

            {/* Pembayaran */}
            <div className="card p-4">
              <p className="section-label mb-3 flex items-center gap-1.5"><Banknote size={11} /> Metode Pembayaran</p>
              {cartHasOpenPO && (
                <label className="flex items-start gap-2 text-xs mb-3 px-3 py-2 rounded-xl cursor-pointer" style={{ background: 'var(--accent-bg)', color: 'var(--accent-dark)' }}>
                  <input type="checkbox" checked={sellAsPO} onChange={e => setSellAsPO(e.target.checked)} className="mt-0.5" />
                  <span>
                    Jual sebagai <strong>PO</strong> — keranjang berisi produk <strong>Buka PO</strong>.{' '}
                    {sellAsPO
                      ? 'Transaksi ini akan disimpan sebagai pesanan Baru, stok tidak dipotong sekarang — baru dipotong setelah ditandai Selesai di menu Pesanan.'
                      : 'Tidak dicentang = dijual normal seperti biasa sekarang (perlu stok cukup).'}
                  </span>
                </label>
              )}
              <div className="flex rounded-xl overflow-hidden border text-xs font-bold" style={{ borderColor: 'var(--border)' }}>
                {availablePaymentMethods.map(m => (
                  <button key={m.id} onClick={() => { setPaymentMethod(m.id); setWalletId(getLastWallet(m.id)); setAmountPaidRaw(''); setTransferBank(''); setTransferAmountRaw(''); }}
                    className="flex-1 px-3.5 py-2.5 transition-all"
                    style={paymentMethod === m.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                    {m.label}
                  </button>
                ))}
              </div>
              {paymentMethod === 'kredit' && (
                <p className="text-xs mt-3 px-3 py-2 rounded-xl" style={{ background: 'var(--accent-bg)', color: 'var(--accent-dark)' }}>
                  Transaksi dicatat sebagai <strong>Belum Lunas</strong> — stok tetap berkurang sekarang, tapi belum dihitung sebagai pendapatan di Laporan Keuangan sampai ditandai Lunas di menu Pesanan.
                </p>
              )}
              {paymentMethod !== 'kredit' && (
                <div className="mt-3">
                  <SearchSelect value={walletId} onChange={setWalletId}
                    options={walletOptions} placeholder="– Dompet Tujuan –" searchPlaceholder="Cari dompet…" />
                  {walletId && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Saldo saat ini: {formatCurrency(walletBalances[walletId] ?? 0)}
                    </p>
                  )}
                </div>
              )}
              {paymentMethod === 'cash' && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {quickCashAmounts(cartTotal).map(v => (
                      <button key={v} type="button" onClick={() => setAmountPaidRaw(String(v))}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                        {v === cartTotal ? 'Uang Pas' : formatCurrency(v)}
                      </button>
                    ))}
                  </div>
                  <NumberInput value={amountPaidRaw} onChange={setAmountPaidRaw}
                    placeholder="Jumlah dibayar (Rp)" />
                  {amountPaidRaw && (
                    <p className="text-xs font-semibold" style={{ color: changeAmount >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {changeAmount >= 0 ? `Kembalian: ${formatCurrency(changeAmount)}` : `Kurang ${formatCurrency(-changeAmount)}`}
                    </p>
                  )}
                </div>
              )}
              {paymentMethod === 'transfer' && (
                <div className="mt-3 space-y-2.5">
                  <SearchSelect
                    value={transferBank}
                    onChange={setTransferBank}
                    options={bankOptions.map(b => ({ value: b.code, label: b.name, sublabel: b.bankCode ? `Kode: ${b.bankCode}` : undefined, imageUrl: b.logoUrl }))}
                    placeholder="– Pilih Bank Pengirim –"
                    searchPlaceholder="Cari bank…"
                  />

                  <div className="flex items-center gap-2.5 p-2 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <ImageUploadBox
                      src={transferProofUrl}
                      alt="Bukti transfer"
                      uploading={transferProofUploading}
                      onSelect={f => handleTransferProofSelect(f)}
                      onRemove={() => { setTransferProofUrl(''); setOcrStatus('idle'); }}
                      onView={() => setProofLightboxOpen(true)}
                      capture="environment"
                      icon={<Camera size={16} />}
                      emptyText="Upload"
                      size={44}
                    />
                    <span className="flex-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {transferProofUrl ? 'Bukti transfer terlampir' : 'Upload / foto bukti transfer'}
                    </span>
                  </div>
                  {ocrStatus === 'reading' && (
                    <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                      <Loader2 size={11} className="animate-spin" /> Membaca nominal dari foto…
                    </p>
                  )}
                  {ocrStatus === 'done' && (
                    <p className="text-xs" style={{ color: 'var(--warning)' }}>
                      Nominal terdeteksi otomatis dari foto — periksa kembali sebelum diproses.
                    </p>
                  )}
                  {ocrStatus === 'failed' && (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Nominal tidak terbaca otomatis, isi manual di bawah.
                    </p>
                  )}

                  <NumberInput value={transferAmountRaw} onChange={setTransferAmountRaw}
                    placeholder="Nominal transfer (Rp)" />
                  {transferAmountRaw && (
                    <p className="text-xs font-semibold" style={{ color: transferDiff >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {transferDiff === 0 ? 'Nominal sesuai total' : transferDiff > 0 ? `Lebih ${formatCurrency(transferDiff)}` : `Kurang ${formatCurrency(-transferDiff)}`}
                    </p>
                  )}
                </div>
              )}
            </div>

            {proofLightboxOpen && transferProofUrl && (
              <ImageLightbox images={[transferProofUrl]} index={0} title="Bukti Transfer"
                onIndexChange={() => {}} onClose={() => setProofLightboxOpen(false)} />
            )}

            {/* Customer */}
            <div className="card p-4 space-y-3">
              <p className="section-label">Data Customer (opsional)</p>
              {(resellerList.length > 0 || customerList.length > 0) && (
                <SearchSelect
                  value={selectedCustRef}
                  onChange={ref => {
                    setSelectedCustRef(ref);
                    if (ref.startsWith('reseller:')) {
                      const r = resellerList.find(rr => rr.id === ref.slice('reseller:'.length));
                      if (r) { setCustName(r.name); setCustPhone(r.phone); }
                    } else if (ref.startsWith('customer:')) {
                      const c = customerList.find(cc => cc.id === ref.slice('customer:'.length));
                      if (c) { setCustName(c.name); setCustPhone(c.phone); }
                    }
                  }}
                  options={[
                    { value: '', label: 'Pelanggan Umum (isi manual)' },
                    ...resellerList.map(r => ({ value: `reseller:${r.id}`, label: r.name, sublabel: `${r.phone} · Reseller` })),
                    ...customerList.map(c => ({ value: `customer:${c.id}`, label: c.name, sublabel: c.phone })),
                  ]}
                  placeholder="– Pilih Pelanggan / Reseller (opsional) –"
                  searchPlaceholder="Cari pelanggan atau reseller…"
                />
              )}
              <div className="relative">
                <User size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input type="text" value={custName} onChange={e => setCustName(e.target.value)}
                  className="input" style={{ paddingLeft: 38 }} placeholder="Nama customer (kosongkan = Pelanggan Umum)" />
              </div>
              <div className="relative">
                <Phone size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input type="tel" value={custPhone} onChange={e => setCustPhone(e.target.value)}
                  className="input" style={{ paddingLeft: 38 }} placeholder="Nomor WhatsApp (opsional)" />
              </div>
            </div>
          </>
        )}
      </div>

      {hasCart && (
        <div className="flex-shrink-0 px-4 py-3 space-y-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          {processErr && (
            <div className="px-3 py-2 rounded-xl text-xs font-medium" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {processErr}
            </div>
          )}
          <button onClick={processTransaction} disabled={!canProcess || processing}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl text-white font-bold text-sm shadow-xl disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#16A34A,#22C55E)' }}>
            {processing ? <><Loader2 size={17} className="animate-spin" /> Memproses…</> : <><CheckCircle2 size={17} /> Proses Transaksi</>}
          </button>
        </div>
      )}
    </div>
  );

  // ─── Success panel ─────────────────────────────────────────────────────────
  const successContent = (
    <div className="h-full overflow-y-auto thin-scrollbar flex flex-col items-center px-6 py-10 gap-5" style={{ maxWidth: 480, margin: '0 auto' }}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'var(--success-bg)' }}>
        <CheckCircle2 size={44} style={{ color: 'var(--success)' }} />
      </div>
      <div className="text-center">
        <p className="text-xl font-extrabold mb-2" style={{ color: 'var(--text-primary)' }}>Transaksi Berhasil!</p>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Pesanan <strong>{lastReceipt?.customerName}</strong> senilai{' '}
          <strong className="tabular">{lastReceipt ? formatCurrency(lastReceipt.total) : ''}</strong> sudah diproses & masuk ke Pesanan.
        </p>
        {invoiceNo && <p className="text-xs mt-1.5 badge badge-amber mx-auto inline-block">{invoiceNo}</p>}
      </div>

      <div className="w-full grid grid-cols-2 gap-2.5">
        <button onClick={printReceipt} className="btn-ghost justify-center gap-2 py-3 text-sm font-semibold">
          <Printer size={15} /> Cetak Struk
        </button>
        {lastReceipt?.pdfUrl ? (
          <a href={lastReceipt.pdfUrl} target="_blank" rel="noopener noreferrer"
            className="btn-ghost justify-center gap-2 py-3 text-sm font-semibold">
            <PdfIcon size={15} /> Lihat Invoice
          </a>
        ) : <span />}
      </div>

      <div className="w-full card p-3.5 space-y-2.5">
        <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
          <MessageCircle size={13} /> Kirim ke WhatsApp (opsional)
        </p>
        <div className="flex gap-2">
          <input type="tel" value={waPhoneDraft} onChange={e => setWaPhoneDraft(e.target.value)}
            className="input flex-1" placeholder="Nomor WhatsApp (08xxx)" />
          <Tooltip label="Kirim WhatsApp">
            <button onClick={sendWhatsApp} disabled={!waPhoneDraft.trim()} className="btn-primary px-4 disabled:opacity-40">
              <Send size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="w-full flex gap-2.5">
        <button onClick={onGoToOrders} className="btn-ghost flex-1 justify-center gap-2 py-3 text-sm font-semibold">
          <Receipt size={15} /> Lihat di Pesanan
        </button>
        <button onClick={handleNewTransaction} className="btn-primary flex-1 justify-center gap-2 py-3 text-sm">
          Transaksi Baru <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );

  // ─── Shift bar (topbar) & modal ────────────────────────────────────────────
  const shiftBar = shiftLoaded && (
    currentShift ? (
      <Tooltip label={`Kas ${formatCurrency(currentShift.openingBalance)} · Tutup Kasir`}>
        <button onClick={() => setShiftModal('close')} title="Tutup Kasir" className="btn-ghost gap-2 text-xs h-9 w-9 p-0 flex items-center justify-center sm:w-auto sm:px-3.5 sm:justify-start" style={{ color: 'var(--success)' }}>
          <Wallet size={14} />
          <span className="hidden sm:inline">Kas {formatCurrency(currentShift.openingBalance)} · Tutup Kasir</span>
        </button>
      </Tooltip>
    ) : (
      <Tooltip label="Buka Kasir">
        <button onClick={() => setShiftModal('open')} title="Buka Kasir" className="btn-ghost gap-2 text-xs h-9 w-9 p-0 flex items-center justify-center sm:w-auto sm:px-3.5 sm:justify-start" style={{ color: 'var(--accent)' }}>
          <Wallet size={14} /> <span className="hidden sm:inline">Buka Kasir</span>
        </button>
      </Tooltip>
    )
  );

  const heldBar = heldTransactions.length > 0 && (
    <Tooltip label={`Tertahan (${heldTransactions.length})`}>
      <button onClick={() => { setHeldModalOpen(true); fetchHeldTransactions(); }} title="Tertahan" className="btn-ghost gap-2 text-xs h-9 w-9 p-0 flex items-center justify-center sm:w-auto sm:px-3.5 sm:justify-start relative" style={{ color: 'var(--warning)' }}>
        <PauseCircle size={14} />
        <span className="hidden sm:inline">Tertahan ({heldTransactions.length})</span>
        <span
          className="sm:hidden absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center"
        >
          {heldTransactions.length}
        </span>
      </button>
    </Tooltip>
  );

  const reportBar = (
    <Tooltip label="Laporan">
      <button onClick={() => setReportOpen(true)} title="Laporan" className="btn-ghost gap-2 text-xs h-9 w-9 p-0 flex items-center justify-center sm:w-auto sm:px-3.5 sm:justify-start" style={{ color: '#0284C7' }}>
        <BarChart2 size={14} /> <span className="hidden sm:inline">Laporan</span>
      </button>
    </Tooltip>
  );

  const refreshBar = (
    <Tooltip label="Muat ulang data">
      <button onClick={handleRefresh} disabled={refreshing} title="Muat ulang data"
        className="btn-ghost h-9 w-9 p-0 flex items-center justify-center disabled:opacity-60" style={{ color: 'var(--text-secondary)' }}>
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </Tooltip>
  );

  const heldModalContent = heldModalOpen && (
    <div className="modal-overlay" onClick={() => setHeldModalOpen(false)}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><PauseCircle size={17} /></div>
            <div>
              <p className="modal-title">Transaksi Tertahan</p>
              <p className="modal-subtitle flex items-center gap-1.5">
                {heldLoading && <Loader2 size={11} className="animate-spin" />}
                {heldTransactions.length} transaksi menunggu dilanjutkan
              </p>
            </div>
          </div>
          <Tooltip label="Tutup"><button onClick={() => setHeldModalOpen(false)} className="modal-close"><X size={14} /></button></Tooltip>
        </div>
        <div className="modal-body">
          {heldTransactions.length === 0 ? (
            <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Tidak ada transaksi tertahan.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {heldTransactions.slice().reverse().map(h => (
                <div key={h.id} className="card p-3 flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{h.label}</p>
                    <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                      {heldItemCount(h)} pcs · {formatCurrency(heldTotal(h))}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Ditahan {new Date(h.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <Tooltip label="Hapus transaksi tertahan">
                    <button onClick={() => deleteHeldTransaction(h.id)}
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ color: 'var(--danger)' }}>
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                  <button onClick={() => resumeHeldTransaction(h)} className="btn-primary px-3 py-2 text-xs flex-shrink-0 whitespace-nowrap">
                    Lanjutkan
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const reportModalContent = reportOpen && (
    <div className="modal-overlay" onClick={() => setReportOpen(false)}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><BarChart2 size={17} /></div>
            <div>
              <p className="modal-title">Laporan Penjualan</p>
              <p className="modal-subtitle">
                {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Tooltip label="Refresh laporan">
              <button onClick={fetchSalesReport} disabled={reportLoading} className="btn-ghost h-8 w-8 p-0 flex items-center justify-center" title="Refresh">
                <Loader2 size={14} className={reportLoading ? 'animate-spin' : 'hidden'} />
                {!reportLoading && <TrendingUp size={14} />}
              </button>
            </Tooltip>
            <Tooltip label="Tutup"><button onClick={() => setReportOpen(false)} className="modal-close"><X size={14} /></button></Tooltip>
          </div>
        </div>
        <div className="modal-body">
          {reportLoading && !reportData ? (
            <div className="flex items-center justify-center py-14">
              <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : !reportData || reportData.count === 0 ? (
            <div className="py-10 text-center">
              <BarChart2 size={26} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada transaksi hari ini.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="card p-3.5" style={{ background: 'var(--success-bg)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--success)' }}>Omzet Hari Ini</p>
                  <p className="text-lg font-extrabold tabular mt-1" style={{ color: 'var(--success)' }}>{formatCurrency(reportData.omzet)}</p>
                </div>
                <div className="card p-3.5" style={{ background: 'var(--accent-bg)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Transaksi</p>
                  <p className="text-lg font-extrabold tabular mt-1" style={{ color: 'var(--accent)' }}>{reportData.count}</p>
                </div>
                <div className="card p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Rata-rata / Transaksi</p>
                  <p className="text-base font-extrabold tabular mt-1" style={{ color: 'var(--text-primary)' }}>{formatCurrency(reportData.avg)}</p>
                </div>
                <div className="card p-3.5" style={{ background: '#F5F3FF' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}>Laba Hari Ini</p>
                  <p className="text-base font-extrabold tabular mt-1" style={{ color: '#7C3AED' }}>{formatCurrency(reportData.profit)}</p>
                </div>
              </div>

              {!reportData.hasCostData && (
                <p className="text-[11px] px-3 py-2 rounded-xl" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  Harga modal belum diisi untuk produk yang terjual hari ini — isi di menu Produk agar laba lebih akurat.
                </p>
              )}

              <div>
                <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  <Award size={13} style={{ color: 'var(--accent)' }} /> Produk Terlaris Hari Ini
                </p>
                <div className="card divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                  {reportData.topProducts.map((p, i) => (
                    <div key={p.name} className="px-3.5 py-2.5 flex items-center gap-2.5">
                      <div style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.qty} pcs terjual</p>
                      </div>
                      <span className="text-xs font-bold tabular flex-shrink-0" style={{ color: 'var(--success)' }}>
                        {formatCurrency(p.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const shiftModalContent = shiftModal && (
    <div className="modal-overlay" onClick={() => !shiftSubmitting && setShiftModal(null)}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Wallet size={17} /></div>
            <div>
              <p className="modal-title">{shiftModal === 'open' ? 'Buka Sesi Kasir' : 'Tutup Sesi Kasir'}</p>
              <p className="modal-subtitle">
                {shiftModal === 'open' ? 'Catat kas awal sebelum mulai transaksi' : 'Hitung kas fisik untuk rekonsiliasi'}
              </p>
            </div>
          </div>
          <Tooltip label="Tutup"><button onClick={() => setShiftModal(null)} className="modal-close"><X size={14} /></button></Tooltip>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <p className="section-label mb-1.5">{shiftModal === 'open' ? 'Kas Awal (Rp)' : 'Kas Aktual Dihitung (Rp)'}</p>
              <NumberInput value={shiftInputRaw} onChange={setShiftInputRaw} placeholder="0" autoFocus />
            </div>
            <div>
              <p className="section-label mb-1.5">Catatan (opsional)</p>
              <input type="text" value={shiftNote} onChange={e => setShiftNote(e.target.value)}
                className="input" placeholder="Catatan tambahan" />
            </div>
            <button
              onClick={shiftModal === 'open' ? openShift : closeShift}
              disabled={shiftSubmitting}
              className="btn-primary w-full py-3 mt-1 disabled:opacity-50">
              {shiftSubmitting ? <Loader2 size={15} className="animate-spin mx-auto" /> : (shiftModal === 'open' ? 'Buka Kasir' : 'Tutup Kasir')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Struk cetak (tersembunyi di layar, tampil hanya saat print) ──────────
  const receiptPrintBlock = lastReceipt && (
    <div id="pos-receipt">
      <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#000', padding: 8, width: '80mm', boxSizing: 'border-box' }}>
        {storeLogo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={storeLogo} alt={storeName} style={{ display: 'block', maxHeight: 44, maxWidth: '55%', margin: '0 auto 4px' }} />
        )}
        <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, margin: 0 }}>{storeName}</p>
        {storeAddress && <p style={{ textAlign: 'center', fontSize: 10, margin: '2px 0 0' }}>{storeAddress}</p>}
        <p style={{ textAlign: 'center', fontSize: 10, margin: '2px 0 0' }}>{storePhone}</p>
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <p style={{ margin: 0 }}>No: {lastReceipt.invoiceNo}</p>
        <p style={{ margin: 0 }}>{lastReceipt.dateStr} · Kasir: {lastReceipt.cashier}</p>
        {receiptPrintedAt && <p style={{ margin: 0 }}>Dicetak: {receiptPrintedAt}</p>}
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        {lastReceipt.items.map((it, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <div>{it.name}{it.weight ? ` (${it.weight})` : ''}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{it.qty} x {formatCurrency(it.price)}</span>
              <span>{formatCurrency(it.subtotal)}</span>
            </div>
          </div>
        ))}
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatCurrency(lastReceipt.subtotal)}</span></div>
        {lastReceipt.discount && lastReceipt.discount.amount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Diskon ({lastReceipt.discount.label})</span><span>-{formatCurrency(lastReceipt.discount.amount)}</span></div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12 }}><span>TOTAL</span><span>{formatCurrency(lastReceipt.total)}</span></div>
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        {lastReceipt.paymentMethod === 'cash' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tunai</span><span>{formatCurrency(lastReceipt.amountPaid ?? 0)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Kembali</span><span>{formatCurrency(lastReceipt.changeAmount ?? 0)}</span></div>
          </>
        ) : lastReceipt.paymentMethod === 'kredit' ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Status</span><span>BELUM LUNAS (KREDIT)</span></div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Transfer {lastReceipt.transferBank}</span><span>{formatCurrency(lastReceipt.transferAmount ?? 0)}</span></div>
        )}
        <p style={{ marginTop: 6 }}>Pelanggan: {lastReceipt.customerName}</p>
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <p style={{ textAlign: 'center' }}>Terima kasih telah berbelanja!</p>
        <p style={{ textAlign: 'center', fontSize: 10 }}>{storeName}{storeAddress ? ` · ${storeAddress}` : ''}</p>
      </div>
    </div>
  );

  // ─── Header mobile (langkah "cart") ────────────────────────────────────────
  const mobileCartHeader = (
    <div className="px-4 pt-4 pb-3 flex items-center gap-3 flex-shrink-0">
      <Tooltip label="Kembali">
        <button onClick={() => { setPosView('products'); setProcessErr(''); }} className="btn-ghost p-2.5">
          <ChevronLeft size={16} />
        </button>
      </Tooltip>
      <div className="flex-1">
        <p className="text-[15px] font-extrabold" style={{ color: 'var(--text-primary)' }}>Detail &amp; Checkout</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{`${cartItems.length + customItems.length} jenis · ${cartCount} pcs`}</p>
      </div>
    </div>
  );

  return (
    <div style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
      {isActive && <TopbarPortal>{refreshBar}{reportBar}{heldBar}{shiftBar}</TopbarPortal>}

      {/* Desktop: catalog + order panel selalu berdampingan */}
      <div className="hidden lg:grid flex-1 min-h-0" style={{ gridTemplateColumns: '1fr 400px' }}>
        <div className="min-w-0 h-full" style={{ borderRight: '1px solid var(--border)' }}>{catalogContent}</div>
        <div className="h-full overflow-hidden">{posView === 'done' ? successContent : orderPanelContent}</div>
      </div>

      {/* Mobile/tablet: alur bertahap (katalog → checkout → selesai) */}
      <div className="lg:hidden flex-1 min-h-0 relative overflow-hidden">
        {posView === 'products' && catalogContent}
        {posView === 'cart' && (
          <div className="h-full flex flex-col">
            {mobileCartHeader}
            <div className="flex-1 overflow-hidden">{orderPanelContent}</div>
          </div>
        )}
        {posView === 'done' && successContent}
      </div>

      {shiftModalContent}
      {heldModalContent}
      {reportModalContent}
      {receiptPrintBlock}

      {showPosScanner && (
        <BarcodeScannerModal
          title="Scan Produk"
          subtitle="Setiap QR yang terbaca langsung masuk keranjang"
          onDetect={handlePosScan}
          onClose={() => setShowPosScanner(false)}
        />
      )}
    </div>
  );
}
