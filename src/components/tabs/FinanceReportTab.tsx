'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Loader2, RefreshCw, TrendingUp, TrendingDown, Wallet, ShoppingCart, Globe, Store, Coins,
  ScrollText, PieChart, ArrowDownCircle, ArrowUpCircle, Landmark,
  Info, Package, Receipt, ChevronDown, ChevronUp, ChevronRight, AlertTriangle, Calculator, X,
  Award,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import FinanceReportPDF from '@/lib/pdf/FinanceReportPDF';
import { toDataUri } from '@/lib/pdf/logo';
import TopbarPortal from '@/components/TopbarPortal';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import { type PeriodKey, PERIOD_OPTIONS, periodRange } from '@/lib/period';
import { SALDO_AWAL_KEY } from '@/lib/finance';
import type { WalletDoc } from '@/lib/useWallets';
import { resolveIcon } from '@/lib/icon-registry';

const API = '';

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const pct = (value: number, base: number) => (base > 0 ? (value / base) * 100 : 0);
const formatPct = (n: number) => `${n.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// Penilaian kesehatan usaha dari Margin Bersih (Laba Bersih / Omzet) — patokan umum untuk
// usaha kuliner/UMKM skala rumahan, bukan standar akuntansi baku.
type MarginTier = 'good' | 'warning' | 'bad';
const gradeMarginBersih = (marginPct: number): { grade: string; label: string; desc: string; tier: MarginTier } => {
  if (marginPct >= 20) return { grade: 'A', label: 'Sangat Sehat', desc: 'Margin laba tinggi — usaha sangat menguntungkan dengan bantalan aman kalau biaya naik.', tier: 'good' };
  if (marginPct >= 12) return { grade: 'B', label: 'Sehat', desc: 'Margin laba bagus — usaha berjalan baik dan berkelanjutan.', tier: 'good' };
  if (marginPct >= 6) return { grade: 'C', label: 'Cukup Sehat', desc: 'Margin laba standar — usaha jalan, tapi tipis dan perlu efisiensi biaya.', tier: 'warning' };
  if (marginPct >= 0) return { grade: 'D', label: 'Kurang Sehat', desc: 'Margin laba sangat tipis — rawan rugi kalau ada kenaikan harga bahan/operasional.', tier: 'warning' };
  return { grade: 'E', label: 'Tidak Sehat', desc: 'Usaha merugi di periode ini — perlu evaluasi harga jual, HPP, dan beban operasional.', tier: 'bad' };
};
const MARGIN_TIER_COLOR: Record<MarginTier, { fg: string; bg: string; ring: string }> = {
  good: { fg: 'var(--success)', bg: 'var(--success-bg)', ring: 'rgba(21,128,61,0.15)' },
  warning: { fg: 'var(--warning)', bg: 'rgba(180,83,9,0.08)', ring: 'rgba(180,83,9,0.15)' },
  bad: { fg: 'var(--danger)', bg: 'var(--danger-bg)', ring: 'rgba(220,38,38,0.15)' },
};
const MARGIN_GRADE_SCALE: { grade: string; range: string; label: string; desc: string; tier: MarginTier }[] = [
  { grade: 'A', range: '≥ 20%', label: 'Sangat Sehat', desc: 'Margin laba tinggi — usaha sangat menguntungkan dengan bantalan aman kalau biaya naik.', tier: 'good' },
  { grade: 'B', range: '12% – 20%', label: 'Sehat', desc: 'Margin laba bagus — usaha berjalan baik dan berkelanjutan.', tier: 'good' },
  { grade: 'C', range: '6% – 12%', label: 'Cukup Sehat', desc: 'Margin standar — usaha jalan, tapi tipis dan perlu efisiensi biaya.', tier: 'warning' },
  { grade: 'D', range: '0% – 6%', label: 'Kurang Sehat', desc: 'Margin sangat tipis — rawan rugi kalau ada kenaikan harga bahan/operasional.', tier: 'warning' },
  { grade: 'E', range: '< 0% (rugi)', label: 'Tidak Sehat', desc: 'Usaha merugi di periode ini — perlu evaluasi harga jual, HPP, dan beban operasional.', tier: 'bad' },
];

// ─── Tipe data ────────────────────────────────────────────────────────────────
interface OrderRecord {
  invoiceNo: string; customerName: string; total: number;
  source?: 'kasir' | 'portal'; status: string; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAt?: { seconds: number };
  items?: { productId?: string; qty: number; costPrice?: number; name?: string }[];
  walletId?: string | null;
}

interface RecapRecord {
  locationName: string; totalRevenue: number; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAt?: { seconds: number };
  items?: { productId?: string; qtySold: number; costPrice?: number; productName?: string }[];
  walletId?: string | null;
}
interface IncomeRecord { category: string; description: string; amount: number; date: string; createdAt?: { seconds: number }; walletId?: string | null }
interface ExpenseRecord { category: string; description: string; amount: number; date: string; sourceType?: string; createdAt?: { seconds: number }; walletId?: string | null }

// Beban yang otomatis tercatat dari Pembelian Bahan Baku / Produksi (punya `sourceType`) tidak
// dihitung lagi sebagai Beban Operasional di Laba Rugi — biayanya sudah masuk HPP saat barangnya
// terjual. Kalau dihitung dua-duanya, laba jadi kelihatan lebih kecil dari yang sebenarnya.
const isCogsSourcedExpense = (e: ExpenseRecord) => e.sourceType === 'material-purchase' || e.sourceType === 'production';

// Pemasukan/Pengeluaran/Modal hanya punya field `date` (tanggal transaksi, bisa diisi mundur),
// tapi `createdAt` (waktu dokumen dibuat) sudah tersimpan sejak awal — pakai jam dari situ supaya
// Jurnal Kas menunjukkan jam sebenarnya, tanpa mengubah tanggal transaksi yang dipilih user.
const dateWithRealTime = (dateStr: string, createdAt?: { seconds: number }) => {
  if (createdAt?.seconds) {
    const c = new Date(createdAt.seconds * 1000);
    const hh = String(c.getHours()).padStart(2, '0');
    const mm = String(c.getMinutes()).padStart(2, '0');
    const ss = String(c.getSeconds()).padStart(2, '0');
    return new Date(`${dateStr}T${hh}:${mm}:${ss}`).getTime() / 1000;
  }
  return new Date(`${dateStr}T12:00:00`).getTime() / 1000;
};
interface CapitalRecord { type: 'modal' | 'prive'; amount: number; date: string; note?: string; createdAt?: { seconds: number }; walletId?: string | null }

interface JournalEntry { seconds: number; description: string; debit: number; kredit: number; invoiceNo?: string }

const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  'Bahan Baku': '#B45309', 'Produksi': '#15803D', 'Sewa': '#7C3AED', 'Gaji': '#0284C7',
  'Listrik & Air': '#0891B2', 'Transportasi': '#DB2777', 'Perlengkapan': '#65A30D',
};

// ─── Panduan istilah ───────────────────────────────────────────────────────────
const GLOSSARY_LABA_RUGI: { term: string; desc: string }[] = [
  { term: 'Omzet (Total Pendapatan)', desc: 'Total nilai penjualan kasir, online, konsinyasi, dan pendapatan lain, sebelum dikurangi biaya apa pun.' },
  { term: 'HPP (Harga Pokok Penjualan / COGS)', desc: 'Total modal (biaya bahan baku + produksi) dari barang yang benar-benar terjual di periode ini — dihitung per item saat transaksi terjadi, bukan saat bahan baku dibeli.' },
  { term: 'Laba Kotor', desc: 'Omzet dikurangi HPP. Menunjukkan untung dari selisih harga jual vs modal barang, sebelum biaya operasional usaha.' },
  { term: 'Beban Operasional', desc: 'Biaya menjalankan usaha di luar HPP: sewa, gaji, listrik & air, transportasi, perlengkapan, dan lainnya. Beban Bahan Baku/Produksi tidak dihitung di sini lagi karena sudah masuk HPP saat barangnya laku (supaya tidak dihitung dua kali).' },
  { term: 'Laba / Rugi Bersih', desc: 'Laba Kotor dikurangi Beban Operasional. Ini angka untung/rugi usaha yang sebenarnya di periode ini.' },
  { term: 'Modal & Prive', desc: 'Uang masuk (Modal) atau keluar (Prive) dari pemilik usaha secara pribadi — tidak dihitung sebagai hasil operasional usaha, jadi tidak masuk Laba Rugi.' },
  { term: 'Pendapatan − Pengeluaran (Kas)', desc: 'Total Pendapatan dikurangi Total Beban kas (termasuk beli bahan baku & produksi langsung dihitung sebagai beban saat itu juga, bukan menunggu barangnya laku). Cara hitung paling sederhana — jawaban langsung ke "pendapatan dikurangi pengeluaran jadi berapa" — tapi angkanya bisa beda dari Laba Bersih akrual di atas.' },
  { term: 'Basis Akrual', desc: '"Akrual" (bukan "aktual") artinya biaya & pendapatan dicatat sesuai waktu transaksinya terjadi secara ekonomis — misalnya HPP dihitung saat barang laku, bukan saat bahan baku dibeli. Ini beda dengan "Pendapatan − Pengeluaran (Kas)" di bawah yang mencatat semua biaya begitu uang keluar. Basis akrual dianggap lebih akurat menggambarkan untung/rugi usaha di periode ini.' },
];
const GLOSSARY_JURNAL: { term: string; desc: string }[] = [
  { term: 'Jurnal Kas', desc: 'Catatan pergerakan uang kas secara berurutan — ini pergerakan KAS RIIL, beda dari Laba Rugi. Uang keluar beli stok tetap tercatat di sini sebagai Kredit meski barangnya belum tentu laku (belum jadi HPP).' },
  { term: 'Debit', desc: 'Uang yang masuk ke kas (penjualan, pendapatan lain, modal masuk).' },
  { term: 'Kredit', desc: 'Uang yang keluar dari kas (semua pengeluaran, termasuk beli bahan baku, dan prive pemilik).' },
  { term: 'Saldo', desc: 'Sisa uang kas berjalan setelah tiap transaksi (Saldo Awal + Debit − Kredit secara kumulatif).' },
  { term: 'Saldo Awal', desc: 'Uang kas nyata yang sudah ada sebelum periode laporan ini dimulai — diisi manual, tidak otomatis dari sistem.' },
];

function GlossaryPanel({ open, onToggle, items }: { open: boolean; onToggle: () => void; items: { term: string; desc: string }[] }) {
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-xs font-bold"
        style={{ color: 'var(--accent)' }}>
        <Info size={14} />
        <span className="flex-1 text-left">Panduan Istilah — Apa Artinya?</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
          {items.map(g => (
            <p key={g.term} className="text-xs leading-relaxed pt-2.5" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{g.term}: </span>
              {g.desc}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

interface DetailRow { key: string; label: string; sub?: string; value: number }

function SummaryDetailModal({ title, icon: Icon, color, rows, total, totalLabel = 'Total', periodLabel, from, to, emptyMessage, onClose }: {
  title: string; icon: React.ComponentType<{ size?: number }>; color: string; rows: DetailRow[]; total: number;
  totalLabel?: string; periodLabel: string; from: string; to: string; emptyMessage: string; onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />

        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Icon size={17} /></div>
            <div>
              <p className="modal-title">{title}</p>
              <p className="modal-subtitle">{periodLabel} ({from} s/d {to})</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>

        <div className="modal-body">
          {rows.length === 0 ? (
            <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>{emptyMessage}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map(r => (
                <div key={r.key} className="flex items-center justify-between gap-3 pb-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{r.label}</p>
                    {r.sub && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.sub}</p>}
                  </div>
                  <p className="text-xs font-extrabold tabular flex-shrink-0" style={{ color }}>{formatRp(r.value)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{totalLabel}</span>
          <span className="text-sm font-extrabold tabular" style={{ color }}>{formatRp(total)}</span>
        </div>
      </div>
    </div>
  );
}

function InfoTip({ label }: { label: string }) {
  return (
    <Tooltip label={label}>
      <Info size={12} style={{ color: 'var(--text-muted)', cursor: 'help' }} />
    </Tooltip>
  );
}

// ─── Chart tren (mandiri, tidak menyentuh RevenueChart di page.tsx) ───────────
function TrendChart({ data }: { data: { date: string; income: number; expense: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = data.length;
  if (n === 0) return null;

  const VW = 560, VH = 150;
  const PAD = { l: 6, r: 6, t: 20, b: 26 };
  const iW = VW - PAD.l - PAD.r;
  const iH = VH - PAD.t - PAD.b;
  const maxVal = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);

  const xAt = (i: number) => PAD.l + (n === 1 ? iW / 2 : (i / (n - 1)) * iW);
  const yAt = (v: number) => PAD.t + (1 - v / maxVal) * iH;

  const linePath = (key: 'income' | 'expense') => n < 2 ? '' : data.reduce((acc, d, i) => {
    const x = xAt(i), y = yAt(d[key]);
    if (i === 0) return `M ${x},${y}`;
    const px = xAt(i - 1), py = yAt(data[i - 1][key]);
    return `${acc} C ${px + (x - px) * 0.45},${py} ${px + (x - px) * 0.55},${y} ${x},${y}`;
  }, '');

  const step = Math.max(1, Math.ceil(n / 8));
  const hd = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * VW;
          let ci = 0, md = Infinity;
          data.forEach((_, i) => { const d = Math.abs(xAt(i) - relX); if (d < md) { md = d; ci = i; } });
          setHoverIdx(ci);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {n >= 2 && <path d={linePath('income')} fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {n >= 2 && <path d={linePath('expense')} fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {n === 1 && <circle cx={xAt(0)} cy={yAt(data[0].income)} r="4" fill="#15803D" />}
        {n === 1 && <circle cx={xAt(0)} cy={yAt(data[0].expense)} r="4" fill="#DC2626" />}

        {hd && (
          <line x1={xAt(hoverIdx!)} y1={PAD.t} x2={xAt(hoverIdx!)} y2={PAD.t + iH} stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4,3" />
        )}
        {hd && <circle cx={xAt(hoverIdx!)} cy={yAt(hd.income)} r="4.5" fill="#15803D" stroke="white" strokeWidth="2" />}
        {hd && <circle cx={xAt(hoverIdx!)} cy={yAt(hd.expense)} r="4.5" fill="#DC2626" stroke="white" strokeWidth="2" />}

        {data.map((d, i) => {
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text key={i} x={xAt(i)} y={VH - 4} textAnchor="middle" fontSize="9" fill="#A08468">
              {new Date(`${d.date}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
            </text>
          );
        })}
      </svg>

      {hd && (
        <div style={{
          position: 'absolute', left: `${(xAt(hoverIdx!) / VW) * 100}%`, top: `${(Math.min(yAt(hd.income), yAt(hd.expense)) / VH) * 100}%`,
          transform: 'translate(-50%, calc(-100% - 10px))', background: 'var(--text-primary)', color: 'white',
          padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)', zIndex: 10,
        }}>
          <div style={{ color: '#4ADE80' }}>Pendapatan: {formatRp(hd.income)}</div>
          <div style={{ color: '#F87171' }}>Pengeluaran: {formatRp(hd.expense)}</div>
        </div>
      )}
    </div>
  );
}

export default function FinanceReportTab({ creds, onOpenOrder }: { creds: string; onOpenOrder?: (invoiceNo: string) => void }) {
  const headers = { 'x-admin-auth': creds };

  const [period,     setPeriod]     = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [subView,    setSubView]    = useState<'laba-rugi' | 'jurnal'>('laba-rugi');
  const [showGlossary, setShowGlossary] = useState(false);
  const [showRekonsiliasi, setShowRekonsiliasi] = useState(false);
  const [showGradeScale, setShowGradeScale] = useState(false);
  const [openDetail, setOpenDetail] = useState<'omzet' | 'hpp' | 'beban' | null>(null);

  const [loading,  setLoading]  = useState(true);
  const [orders,   setOrders]   = useState<OrderRecord[]>([]);
  const [recaps,   setRecaps]   = useState<RecapRecord[]>([]);
  const [income,   setIncome]   = useState<IncomeRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [capital,  setCapital]  = useState<CapitalRecord[]>([]);
  const [exporting, setExporting] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);

  // ── Data toko untuk kop PDF ──────────────────────────────────
  const [storeInfo, setStoreInfo] = useState<{ storeName?: string; storeTagline?: string; address?: string; city?: string; whatsapp?: string; logo?: string }>({});
  const [logoDataUri, setLogoDataUri] = useState<string | undefined>(undefined);
  useEffect(() => {
    fetch(`${API}/api/settings`, { headers }).then(async r => {
      if (r.ok) setStoreInfo((await r.json() as { settings: typeof storeInfo }).settings ?? {});
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { toDataUri(storeInfo.logo).then(setLogoDataUri); }, [storeInfo.logo]);
  const storeHeader = {
    name:    storeInfo.storeName?.trim() || 'Cemilan Teh Risma',
    tagline: storeInfo.storeTagline?.trim() || undefined,
    address: [storeInfo.address, storeInfo.city].filter(Boolean).join(', ') || undefined,
    phone:   storeInfo.whatsapp?.trim() || undefined,
    logo:    logoDataUri,
  };

  const [saldoAwalRaw, setSaldoAwalRaw] = useState('0');
  useEffect(() => {
    const saved = localStorage.getItem(SALDO_AWAL_KEY);
    if (saved) setSaldoAwalRaw(saved);
  }, []);
  const saldoAwal = parseFloat(saldoAwalRaw) || 0;

  // ── Saldo Kas Saat Ini ───────────────────────────────────────
  // Independen dari filter periode di atas: tarik SEMUA transaksi sejak awal pencatatan (bukan cuma
  // periode yang dipilih) supaya saldo real-time ini akurat walau periode laporan diganti-ganti.
  // Kirim `from` eksplisit (bukan dikosongkan) karena /api/orders & /api/consignment/recap membatasi
  // hasil ke 50 dokumen terbaru kalau from/to tidak dikirim sama sekali.
  const [allTimeLoading, setAllTimeLoading] = useState(true);
  const [allTimeTxSaldo, setAllTimeTxSaldo] = useState<number | null>(null);
  const [wallets, setWallets] = useState<WalletDoc[]>([]);
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [unassignedBalance, setUnassignedBalance] = useState(0);
  // Tahap 6 migrasi (lihat plan gleaming-wondering-quokka.md) — /api/wallets/balances menghitung
  // totalTx (saldo transaksi gabungan, sama seperti `saldo` di bawah) dan saldo per dompet +
  // "Belum Ditentukan" langsung di server, ganti pola lama fetch 5 endpoint histori penuh lalu
  // hitung manual di client.
  const loadAllTimeSaldo = async () => {
    setAllTimeLoading(true);
    try {
      const [wRes, bRes] = await Promise.all([
        fetch(`${API}/api/wallets`, { headers }),
        fetch(`${API}/api/wallets/balances`, { headers }),
      ]);
      const walletList = wRes.ok ? (await wRes.json() as { wallets: WalletDoc[] }).wallets : [];
      const { balances: nextBalances, unassigned, totalTx } = bRes.ok
        ? await bRes.json() as { balances: Record<string, number>; unassigned: number; totalTx: number }
        : { balances: {}, unassigned: 0, totalTx: 0 };

      setAllTimeTxSaldo(totalTx);
      setWallets(walletList);
      setWalletBalances(nextBalances);
      setUnassignedBalance(unassigned);
    } finally { setAllTimeLoading(false); }
  };
  useEffect(() => { loadAllTimeSaldo(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saldoSaatIni = saldoAwal + (allTimeTxSaldo ?? 0);

  const { from, to } = periodRange(period, customFrom, customTo);

  // Generasi request — cegah respons periode LAMA yang datang belakangan menimpa (atau, lebih
  // buruk, tercampur sebagian dengan) data periode BARU yang sudah lebih dulu tampil.
  const loadIdRef = useRef(0);
  const load = async () => {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    try {
      const qs = `from=${from}&to=${to}`;
      const [oRes, rRes, iRes, eRes, cRes] = await Promise.all([
        fetch(`${API}/api/orders?${qs}`, { headers }),
        fetch(`${API}/api/consignment/recap?${qs}`, { headers }),
        fetch(`${API}/api/income?${qs}`, { headers }),
        fetch(`${API}/api/expenses?${qs}`, { headers }),
        fetch(`${API}/api/capital?${qs}`, { headers }),
      ]);
      const orders   = oRes.ok ? (await oRes.json() as { orders: OrderRecord[] }).orders : [];
      const recaps   = rRes.ok ? (await rRes.json() as { recaps: RecapRecord[] }).recaps : [];
      const income   = iRes.ok ? (await iRes.json() as { income: IncomeRecord[] }).income : [];
      const expenses = eRes.ok ? (await eRes.json() as { expenses: ExpenseRecord[] }).expenses : [];
      const capital  = cRes.ok ? (await cRes.json() as { entries: CapitalRecord[] }).entries : [];
      if (myLoadId !== loadIdRef.current) return;
      setOrders(orders);
      setRecaps(recaps);
      setIncome(income);
      setExpenses(expenses);
      setCapital(capital);
    } finally { if (myLoadId === loadIdRef.current) setLoading(false); }
  };
  useEffect(() => { load(); }, [period, customFrom, customTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Harga Modal (costPrice) TERKINI per produk — dipakai sebagai fallback HPP kalau snapshot di item
  // transaksi 0/kosong (mis. transaksinya terjadi sebelum Harga Modal produknya diisi). Tombol "Hitung
  // Ulang HPP" cuma ambil ulang ini, tidak menimpa data transaksi — aman diulang kapan saja.
  const [productCostMap, setProductCostMap] = useState<Map<string, number>>(new Map());
  const [recalculating, setRecalculating] = useState(false);
  const loadProductCosts = async () => {
    setRecalculating(true);
    try {
      const res = await fetch(`${API}/api/products`, { headers });
      if (res.ok) {
        const { products: prods } = await res.json() as { products: { id: string; costPrice?: number }[] };
        setProductCostMap(new Map(prods.map(p => [p.id, Number(p.costPrice) || 0])));
      }
    } finally { setRecalculating(false); }
  };
  useEffect(() => { loadProductCosts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveCostPrice = (stored: number | undefined, productId: string | undefined) => {
    if (stored) return stored;
    return productId ? (productCostMap.get(productId) ?? 0) : 0;
  };

  // ── Hitung Pendapatan / Beban ────────────────────────────────
  // Order/rekap "Belum Lunas" tidak ikut dihitung sebagai uang masuk sampai ditandai Lunas
  // (lihat menu Pesanan / riwayat Pembelian Bahan Baku & Rekap Konsinyasi). Field yang hilang
  // (data lama sebelum fitur ini ada) dianggap lunas.
  const countedOrders = orders.filter(o => (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
  const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');
  const kasirRevenue = countedOrders.filter(o => o.source !== 'portal').reduce((s, o) => s + (o.total ?? 0), 0);
  const onlineRevenue = countedOrders.filter(o => o.source === 'portal').reduce((s, o) => s + (o.total ?? 0), 0);
  const consignmentRevenue = countedRecaps.reduce((s, r) => s + (r.totalRevenue ?? 0), 0);
  const totalPendapatanLain = income.reduce((s, i) => s + i.amount, 0);
  const totalPendapatan = kasirRevenue + onlineRevenue + consignmentRevenue + totalPendapatanLain;

  const expenseByCategory = new Map<string, number>();
  expenses.forEach(e => expenseByCategory.set(e.category, (expenseByCategory.get(e.category) ?? 0) + e.amount));
  const totalBeban = expenses.reduce((s, e) => s + e.amount, 0);

  // HPP (Harga Pokok Penjualan) — dihitung dari qty × costPrice tiap item yang benar-benar terjual di
  // periode ini (kasir/online/konsinyasi). Pakai costPrice snapshot kalau ada isinya; kalau 0/kosong
  // (mis. transaksi terjadi sebelum Harga Modal produknya diisi), fallback ke Harga Modal produk
  // TERKINI (effectiveCostPrice) — ini yang bikin tombol "Hitung Ulang HPP" berguna tanpa transaksi ulang.
  const hppPenjualan = countedOrders.reduce((s, o) =>
    s + (o.items ?? []).reduce((s2, it) => s2 + it.qty * effectiveCostPrice(it.costPrice, it.productId), 0), 0);
  const hppKonsinyasi = countedRecaps.reduce((s, r) =>
    s + (r.items ?? []).reduce((s2, it) => s2 + it.qtySold * effectiveCostPrice(it.costPrice, it.productId), 0), 0);
  const hpp = hppPenjualan + hppKonsinyasi;
  const labaKotor = totalPendapatan - hpp;

  const expensesOperasional = expenses.filter(e => !isCogsSourcedExpense(e));
  const totalBebanOperasional = expensesOperasional.reduce((s, e) => s + e.amount, 0);
  const labaBersih = labaKotor - totalBebanOperasional;
  const marginBersihPct = pct(labaBersih, totalPendapatan);
  const gradeUsaha = gradeMarginBersih(marginBersihPct);

  // Versi lama (sebelum HPP akrual ada): Total Pendapatan − Total Beban kas (termasuk Bahan Baku/
  // Produksi langsung sebagai beban). Tetap ditampilkan terpisah di bawah supaya tidak hilang, tapi
  // beda dari Laba Bersih akrual di atas — lihat panel "Panduan Istilah" untuk penjelasan bedanya.
  const labaBersihKasLama = totalPendapatan - totalBeban;

  // Transaksi lama (sebelum snapshot HPP ada) tidak punya field costPrice sama sekali di itemnya —
  // beda dari costPrice eksplisit 0 — kalau ketemu, Laba Kotor pada periode ini bisa understate HPP.
  const hasMissingCostData =
    countedOrders.some(o => o.items?.some(it => it.qty > 0 && it.costPrice === undefined)) ||
    countedRecaps.some(r => r.items?.some(it => it.qtySold > 0 && it.costPrice === undefined));

  // Produk yang costPrice-nya masih 0 walau sudah dicoba fallback ke Harga Modal produk terkini —
  // berarti "Harga Modal / HPP" produk itu memang belum pernah diisi sama sekali di menu Produk.
  // Daftar ini dikasih ke user supaya tahu produk mana yang perlu diisi HPP-nya, lalu klik
  // "Hitung Ulang HPP" untuk langsung kepakai tanpa perlu transaksi ulang.
  const zeroCostProducts = new Set<string>();
  countedOrders.forEach(o => (o.items ?? []).forEach(it => {
    if (it.qty > 0 && effectiveCostPrice(it.costPrice, it.productId) === 0) zeroCostProducts.add(it.name || '(tanpa nama)');
  }));
  countedRecaps.forEach(r => (r.items ?? []).forEach(it => {
    if (it.qtySold > 0 && effectiveCostPrice(it.costPrice, it.productId) === 0) zeroCostProducts.add(it.productName || '(tanpa nama)');
  }));

  // Rincian HPP per produk — dipakai modal detail saat kartu HPP di-klik. Dikelompokkan per
  // productId (gabung penjualan kasir/online/konsinyasi produk yang sama), fallback ke nama
  // kalau item lama/manual tidak punya productId.
  const hppByProduct = new Map<string, { key: string; name: string; qty: number; total: number }>();
  const addHppRow = (productId: string | undefined, name: string, qty: number, cost: number) => {
    const key = productId || `nama:${name}`;
    const cur = hppByProduct.get(key) ?? { key, name, qty: 0, total: 0 };
    cur.qty += qty;
    cur.total += qty * cost;
    hppByProduct.set(key, cur);
  };
  countedOrders.forEach(o => (o.items ?? []).forEach(it => {
    if (it.qty > 0) addHppRow(it.productId, it.name || '(tanpa nama)', it.qty, effectiveCostPrice(it.costPrice, it.productId));
  }));
  countedRecaps.forEach(r => (r.items ?? []).forEach(it => {
    if (it.qtySold > 0) addHppRow(it.productId, it.productName || '(tanpa nama)', it.qtySold, effectiveCostPrice(it.costPrice, it.productId));
  }));
  const hppDetailRows: DetailRow[] = [...hppByProduct.values()].sort((a, b) => b.total - a.total)
    .map(r => ({ key: r.key, label: r.name, sub: `${r.qty} pcs × ${formatRp(r.qty ? r.total / r.qty : 0)}`, value: r.total }));

  // Rincian Omzet per sumber — kasir/online/konsinyasi/lain-lain, sama seperti yang dipakai di
  // Export Excel & PDF (lihat incomeRows di printPdf), cuma dibungkus format DetailRow di sini.
  const omzetDetailRows: DetailRow[] = [
    { key: 'kasir', label: 'Penjualan Kasir', value: kasirRevenue },
    { key: 'online', label: 'Penjualan Online', value: onlineRevenue },
    { key: 'konsinyasi', label: 'Pendapatan Konsinyasi', value: consignmentRevenue },
    { key: 'lain', label: 'Pendapatan Lain-lain', value: totalPendapatanLain },
  ].filter(r => r.value !== 0);

  // Rincian Beban Operasional per kategori — hanya beban di luar HPP (Bahan Baku/Produksi sudah
  // dikeluarkan lewat isCogsSourcedExpense supaya tidak dobel hitung dengan HPP di atas).
  const bebanOperasionalByCategory = new Map<string, number>();
  expensesOperasional.forEach(e => bebanOperasionalByCategory.set(e.category, (bebanOperasionalByCategory.get(e.category) ?? 0) + e.amount));
  const bebanOperasionalDetailRows: DetailRow[] = [...bebanOperasionalByCategory.entries()]
    .sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ key: category, label: category, value: amount }));

  // Modal & Prive TIDAK ikut Laba Rugi operasional — cuma info terpisah + masuk Jurnal Kas.
  const totalModalMasuk = capital.filter(c => c.type === 'modal').reduce((s, c) => s + c.amount, 0);
  const totalPrive       = capital.filter(c => c.type === 'prive').reduce((s, c) => s + c.amount, 0);

  // ── Rekonsiliasi Kas vs Laba ─────────────────────────────────
  // Menjembatani kenapa Laba Bersih (akrual) beda dari perubahan Saldo Kas riil periode ini:
  // (1) Modal Masuk/Prive mempengaruhi kas tapi bukan hasil operasional, jadi tidak masuk Laba Rugi.
  // (2) Kas keluar untuk Bahan Baku/Produksi dicatat saat DIBAYAR, sedangkan HPP diakui saat
  // barangnya TERJUAL — kalau lagi numpuk stok, kas keluar lebih besar dari HPP yang diakui
  // (dan sebaliknya kalau jual dari stok lama). Rumus ini murni menyusun ulang variabel yang
  // sudah dihitung di atas (totalBeban = totalBebanOperasional + bagian Bahan Baku/Produksi),
  // jadi selalu identik dengan hasil penjumlahan Jurnal Kas periode yang sama — bukan angka baru.
  const totalBebanCogsSourced = totalBeban - totalBebanOperasional;
  const selisihWaktuPersediaan = hpp - totalBebanCogsSourced;
  const perubahanSaldoKasPeriode = labaBersih + totalModalMasuk - totalPrive + selisihWaktuPersediaan;

  // ── Jurnal Kas ───────────────────────────────────────────────
  const journal: JournalEntry[] = [
    ...countedOrders.map(o => ({
      seconds: o.createdAt?.seconds ?? 0,
      description: `Penjualan ${o.source === 'portal' ? 'Online' : 'Kasir'} - ${o.invoiceNo || o.customerName}`,
      debit: o.total ?? 0, kredit: 0,
      invoiceNo: o.invoiceNo || undefined,
    })),
    ...countedRecaps.map(r => ({
      seconds: r.createdAt?.seconds ?? 0,
      description: `Pendapatan Konsinyasi - ${r.locationName}`,
      debit: r.totalRevenue ?? 0, kredit: 0,
    })),
    ...income.map(i => ({
      seconds: dateWithRealTime(i.date, i.createdAt),
      description: `${i.category} - ${i.description}`,
      debit: i.amount, kredit: 0,
    })),
    ...expenses.map(e => ({
      seconds: dateWithRealTime(e.date, e.createdAt),
      description: `${e.category} - ${e.description}`,
      debit: 0, kredit: e.amount,
    })),
    ...capital.map(c => ({
      seconds: dateWithRealTime(c.date, c.createdAt),
      description: c.type === 'modal' ? `Modal Masuk${c.note ? ` - ${c.note}` : ''}` : `Prive Pemilik${c.note ? ` - ${c.note}` : ''}`,
      debit: c.type === 'modal' ? c.amount : 0, kredit: c.type === 'prive' ? c.amount : 0,
    })),
  ].sort((a, b) => a.seconds - b.seconds);

  const journalWithSaldo = journal.reduce<(JournalEntry & { saldo: number })[]>((acc, j) => {
    const prevSaldo = acc.length > 0 ? acc[acc.length - 1].saldo : saldoAwal;
    acc.push({ ...j, saldo: prevSaldo + j.debit - j.kredit });
    return acc;
  }, []);
  const journalDisplay = [...journalWithSaldo].reverse();

  // ── Chart tren harian ────────────────────────────────────────
  const dailyMap = new Map<string, { income: number; expense: number }>();
  countedOrders.forEach(o => {
    if (!o.createdAt?.seconds) return;
    const key = new Date(o.createdAt.seconds * 1000).toISOString().slice(0, 10);
    const cur = dailyMap.get(key) ?? { income: 0, expense: 0 };
    cur.income += o.total ?? 0; dailyMap.set(key, cur);
  });
  countedRecaps.forEach(r => {
    if (!r.createdAt?.seconds) return;
    const key = new Date(r.createdAt.seconds * 1000).toISOString().slice(0, 10);
    const cur = dailyMap.get(key) ?? { income: 0, expense: 0 };
    cur.income += r.totalRevenue ?? 0; dailyMap.set(key, cur);
  });
  income.forEach(i => {
    const cur = dailyMap.get(i.date) ?? { income: 0, expense: 0 };
    cur.income += i.amount; dailyMap.set(i.date, cur);
  });
  expenses.forEach(e => {
    const cur = dailyMap.get(e.date) ?? { income: 0, expense: 0 };
    cur.expense += e.amount; dailyMap.set(e.date, cur);
  });
  const trendData = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));

  const periodLabel = PERIOD_OPTIONS.find(p => p.id === period)?.label ?? '';

  const exportExcel = async () => {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();

      const styleTitle = (ws: ExcelJS.Worksheet, title: string, subtitle: string, colCount: number) => {
        ws.mergeCells(1, 1, 1, colCount);
        const t = ws.getCell(1, 1);
        t.value = title; t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
        ws.getRow(1).height = 28;
        ws.mergeCells(2, 1, 2, colCount);
        const s = ws.getCell(2, 1);
        s.value = subtitle; s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
        s.alignment = { horizontal: 'center', vertical: 'middle' };
        s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
        ws.getRow(2).height = 20;
      };
      const styleHeader = (ws: ExcelJS.Worksheet, rowNum: number, headers: string[]) => {
        const row = ws.getRow(rowNum);
        headers.forEach((h, i) => { row.getCell(i + 1).value = h; });
        row.height = 24;
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        ws.views = [{ state: 'frozen', ySplit: rowNum }];
      };
      const zebra = (ws: ExcelJS.Worksheet, rowNum: number, idx: number) => {
        ws.getRow(rowNum).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
      };

      // ── Sheet 1: Laba Rugi ──
      const wsLR = wb.addWorksheet('Laba Rugi');
      wsLR.columns = [{ key: 'a', width: 32 }, { key: 'b', width: 20 }];
      styleTitle(wsLR, 'RINGKASAN LABA RUGI — CEMILAN TEH RISMA', `Periode: ${periodLabel} (${from} s/d ${to})`, 2);
      styleHeader(wsLR, 3, ['Keterangan', 'Jumlah']);
      const lrRows: [string, number][] = [
        ['Penjualan Kasir', kasirRevenue], ['Penjualan Online', onlineRevenue], ['Pendapatan Konsinyasi', consignmentRevenue],
        ['Pendapatan Lain-lain', totalPendapatanLain],
        ['Total Pendapatan (Omzet)', totalPendapatan],
        ['HPP (Harga Pokok Penjualan)', hpp],
        ['Laba Kotor', labaKotor],
        ...[...expenseByCategory.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => [`Beban - ${c}${expenses.some(e => e.category === c && isCogsSourcedExpense(e)) ? ' (masuk HPP)' : ''}`, v] as [string, number]),
        ['Total Beban (Kas)', totalBeban],
        ['Beban Operasional (di luar HPP)', totalBebanOperasional],
        [labaBersih >= 0 ? 'Laba Bersih' : 'Rugi Bersih', labaBersih],
        ['Modal Masuk (di luar Laba Rugi)', totalModalMasuk], ['Prive (di luar Laba Rugi)', totalPrive],
      ];
      lrRows.forEach(([label, val], i) => {
        const rowNum = 4 + i;
        wsLR.getRow(rowNum).getCell(1).value = label;
        wsLR.getRow(rowNum).getCell(2).value = val;
        wsLR.getRow(rowNum).getCell(2).numFmt = '"Rp"#,##0';
        zebra(wsLR, rowNum, i);
      });

      // ── Sheet 2: Jurnal Kas ──
      const wsJK = wb.addWorksheet('Jurnal Kas');
      wsJK.columns = [{ key: 'tgl', width: 14 }, { key: 'jam', width: 10 }, { key: 'ket', width: 42 }, { key: 'debit', width: 18 }, { key: 'kredit', width: 18 }, { key: 'saldo', width: 18 }];
      styleTitle(wsJK, 'JURNAL KAS — CEMILAN TEH RISMA', `Periode: ${periodLabel} (${from} s/d ${to}) · Saldo Awal: ${formatRp(saldoAwal)}`, 6);
      styleHeader(wsJK, 3, ['Tanggal', 'Jam', 'Keterangan', 'Debit', 'Kredit', 'Saldo']);
      journalWithSaldo.forEach((j, i) => {
        const rowNum = 4 + i;
        const row = wsJK.getRow(rowNum);
        row.getCell(1).value = j.seconds ? new Date(j.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
        row.getCell(2).value = j.seconds ? new Date(j.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        row.getCell(3).value = j.description;
        row.getCell(4).value = j.debit || null;
        row.getCell(5).value = j.kredit || null;
        row.getCell(6).value = j.saldo;
        [4, 5, 6].forEach(c => { row.getCell(c).numFmt = '"Rp"#,##0'; });
        zebra(wsJK, rowNum, i);
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-keuangan-${from}-sd-${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const printPdf = async () => {
    setPrintingPdf(true);
    try {
      const incomeRows = [
        { label: 'Penjualan Kasir', amount: kasirRevenue },
        { label: 'Penjualan Online', amount: onlineRevenue },
        { label: 'Pendapatan Konsinyasi', amount: consignmentRevenue },
        { label: 'Pendapatan Lain-lain', amount: totalPendapatanLain },
      ];
      const expenseRows = [...expenseByCategory.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({
        category, amount, foldedIntoHpp: expenses.some(e => e.category === category && isCogsSourcedExpense(e)),
      }));
      const journalRows = journalWithSaldo.map(j => ({
        tanggal: j.seconds ? new Date(j.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-',
        jam: j.seconds ? new Date(j.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-',
        keterangan: j.description,
        debit: j.debit, kredit: j.kredit, saldo: j.saldo,
      }));

      const blob = await pdf(
        <FinanceReportPDF
          store={storeHeader}
          data={{
            periodLabel, from, to,
            incomeRows, totalPendapatan, hpp, labaKotor,
            expenseRows, totalBeban, totalBebanOperasional, labaBersih,
            totalModalMasuk, totalPrive,
            saldoAwal, journal: journalRows,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-keuangan-${from}-sd-${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally { setPrintingPdf(false); }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <TopbarPortal>
        <Tooltip label="Hitung ulang HPP pakai Harga Modal produk terkini (tanpa transaksi ulang)">
          <button onClick={loadProductCosts} disabled={recalculating} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Hitung Ulang HPP">
            <Calculator size={14} className={recalculating ? 'animate-pulse' : ''} />
          </button>
        </Tooltip>
        <Tooltip label="Export Excel">
          <button onClick={exportExcel} disabled={exporting || loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Export Excel">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
          </button>
        </Tooltip>
        <Tooltip label="Cetak PDF">
          <button onClick={printPdf} disabled={printingPdf || loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Cetak PDF">
            {printingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
          </button>
        </Tooltip>
        <Tooltip label="Refresh">
          <button onClick={() => { load(); loadAllTimeSaldo(); }} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      {/* Saldo Kas Saat Ini — dihitung dari SELURUH transaksi sejak awal pencatatan, tidak
          terpengaruh filter periode di bawah, supaya selalu menjawab "saldo sekarang berapa". */}
      <div className="card p-5 flex items-center justify-between gap-4 flex-wrap" style={{ background: 'linear-gradient(135deg, var(--accent-bg), var(--surface-2))' }}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,105,30,0.15)', color: 'var(--accent)' }}>
            <Wallet size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Saldo Kas Saat Ini</p>
            {allTimeLoading ? (
              <Loader2 size={18} className="animate-spin mt-1" style={{ color: 'var(--accent)' }} />
            ) : (
              <p className="text-2xl font-extrabold tabular leading-tight" style={{ color: saldoSaatIni >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>{formatRp(saldoSaatIni)}</p>
            )}
          </div>
        </div>
        <p className="text-[11px] max-w-xs" style={{ color: 'var(--text-muted)' }}>
          Dihitung otomatis dari seluruh transaksi tersimpan sejak awal pencatatan + Saldo Awal (di tab Jurnal Kas) — tidak tergantung filter periode di bawah.
        </p>
      </div>

      {/* Rincian saldo per dompet — breakdown dari total di atas, dikelompokkan per sumber dana. */}
      {!allTimeLoading && wallets.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Rincian Saldo per Dompet</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {wallets.filter(w => w.isActive).map(w => {
              const Icon = resolveIcon(w.icon);
              const balance = walletBalances[w.id] ?? 0;
              return (
                <div key={w.id} className="card p-3.5 flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${w.color}22`, color: w.color }}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold tabular truncate" style={{ color: balance >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>{formatRp(balance)}</p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{w.name}</p>
                  </div>
                </div>
              );
            })}
            {unassignedBalance !== 0 && (
              <div className="card p-3.5 flex items-center gap-2.5" style={{ borderStyle: 'dashed' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  <Wallet size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold tabular truncate" style={{ color: 'var(--text-secondary)' }}>{formatRp(unassignedBalance)}</p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>Belum Ditentukan</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pemilih periode */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={period === p.id ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input" style={{ height: 36 }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input" style={{ height: 36 }} />
          </div>
        )}
      </div>

      {/* Sub-view switcher */}
      <div className="inline-flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        {([
          { id: 'laba-rugi' as const, label: 'Laba Rugi', Icon: PieChart },
          { id: 'jurnal'    as const, label: 'Jurnal Kas', Icon: ScrollText },
        ]).map(t => (
          <button key={t.id} onClick={() => setSubView(t.id)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all"
            style={subView === t.id ? { background: 'var(--accent)', color: 'white' } : { color: 'var(--text-muted)' }}>
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : subView === 'laba-rugi' ? (
        <div className="space-y-5">
          <GlossaryPanel open={showGlossary} onToggle={() => setShowGlossary(v => !v)} items={GLOSSARY_LABA_RUGI} />

          {hasMissingCostData && (
            <div className="card p-3 flex items-center gap-2.5" style={{ background: 'var(--warning-bg, #FEF3C7)' }}>
              <AlertTriangle size={15} style={{ color: '#B45309', flexShrink: 0 }} />
              <p className="text-xs font-medium" style={{ color: '#92400E' }}>
                Sebagian transaksi lama di periode ini belum punya data HPP tersimpan (dari sebelum fitur ini aktif), sehingga HPP dihitung 0 untuk transaksi tsb — Laba Kotor &amp; Laba Bersih bisa sedikit lebih tinggi dari sebenarnya.
              </p>
            </div>
          )}

          {zeroCostProducts.size > 0 && (
            <div className="card p-4 flex items-start gap-3" style={{ background: 'var(--warning-bg, #FEF3C7)' }}>
              <AlertTriangle size={16} style={{ color: '#B45309', flexShrink: 0, marginTop: 1 }} />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-xs font-bold leading-relaxed" style={{ color: '#92400E' }}>
                  Harga Modal (HPP) belum diisi untuk {zeroCostProducts.size} produk yang terjual di periode ini
                </p>
                <p className="text-xs leading-relaxed" style={{ color: '#92400E' }}>
                  HPP produk ini dihitung Rp0, jadi Laba Kotor &amp; Laba Bersih pasti lebih tinggi dari sebenarnya.
                </p>
                <p className="text-xs leading-relaxed" style={{ color: '#92400E' }}>
                  Isi di menu <span className="font-semibold">Produk → edit produk → &quot;Harga Modal / HPP&quot;</span>, lalu klik tombol <span className="font-semibold">&quot;Hitung Ulang HPP&quot;</span> di pojok kanan atas supaya langsung kepakai tanpa transaksi ulang.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {[...zeroCostProducts].map(p => (
                    <span key={p} className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(180,83,9,0.14)', color: '#92400E' }}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Ringkasan akrual */}
          <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            Ringkasan Akrual — Laba Rugi Sebenarnya <InfoTip label={GLOSSARY_LABA_RUGI[7].desc} />
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <button type="button" onClick={() => setOpenDetail('omzet')}
              className="card p-4 flex items-center gap-3 text-left transition-transform active:scale-[0.98]" style={{ background: 'var(--success-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(21,128,61,0.15)', color: 'var(--success)' }}>
                <TrendingUp size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: 'var(--success)' }}>{formatRp(totalPendapatan)}</p>
                <p className="text-[11px] font-medium mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  Omzet <InfoTip label={GLOSSARY_LABA_RUGI[0].desc} />
                </p>
              </div>
              <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </button>
            <button type="button" onClick={() => setOpenDetail('hpp')}
              className="card p-4 flex items-center gap-3 text-left transition-transform active:scale-[0.98]" style={{ background: 'var(--surface-2)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(180,83,9,0.15)', color: '#B45309' }}>
                <Package size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: '#B45309' }}>{formatRp(hpp)}</p>
                <p className="text-[11px] font-medium mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  HPP <InfoTip label={GLOSSARY_LABA_RUGI[1].desc} />
                </p>
              </div>
              <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </button>
            <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--accent-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,105,30,0.15)', color: 'var(--accent)' }}>
                <PieChart size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: 'var(--accent)' }}>{formatRp(labaKotor)}</p>
                <p className="text-[11px] font-medium mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  Laba Kotor <InfoTip label={GLOSSARY_LABA_RUGI[2].desc} />
                </p>
              </div>
            </div>
            <button type="button" onClick={() => setOpenDetail('beban')}
              className="card p-4 flex items-center gap-3 text-left transition-transform active:scale-[0.98]" style={{ background: 'var(--danger-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(220,38,38,0.15)', color: 'var(--danger)' }}>
                <Receipt size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: 'var(--danger)' }}>{formatRp(totalBebanOperasional)}</p>
                <p className="text-[11px] font-medium mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  Beban Operasional <InfoTip label={GLOSSARY_LABA_RUGI[3].desc} />
                </p>
              </div>
              <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </button>
            <div className="card p-4 flex items-center gap-3" style={{ background: labaBersih >= 0 ? 'var(--accent-bg)' : 'var(--danger-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: labaBersih >= 0 ? 'rgba(212,105,30,0.15)' : 'rgba(220,38,38,0.15)', color: labaBersih >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                <Wallet size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: labaBersih >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{formatRp(labaBersih)}</p>
                <p className="text-[11px] font-medium mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  {labaBersih >= 0 ? 'Laba Bersih' : 'Rugi Bersih'} <InfoTip label={GLOSSARY_LABA_RUGI[4].desc} />
                </p>
              </div>
            </div>
          </div>

          {/* Rasio & Margin — persentase tiap komponen terhadap Omzet, biar kesehatan margin kelihatan
              langsung tanpa hitung manual dari nominal Rupiah di atas. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card p-3 flex flex-col items-center text-center gap-0.5" style={{ background: 'var(--surface-2)' }}>
              <p className="text-base font-extrabold tabular leading-none" style={{ color: '#B45309' }}>{formatPct(pct(hpp, totalPendapatan))}</p>
              <p className="text-[10.5px] font-medium" style={{ color: 'var(--text-muted)' }}>HPP dari Omzet</p>
            </div>
            <div className="card p-3 flex flex-col items-center text-center gap-0.5" style={{ background: 'var(--accent-bg)' }}>
              <p className="text-base font-extrabold tabular leading-none" style={{ color: 'var(--accent)' }}>{formatPct(pct(labaKotor, totalPendapatan))}</p>
              <p className="text-[10.5px] font-medium" style={{ color: 'var(--text-muted)' }}>Margin Kotor dari Omzet</p>
            </div>
            <div className="card p-3 flex flex-col items-center text-center gap-0.5" style={{ background: 'var(--danger-bg)' }}>
              <p className="text-base font-extrabold tabular leading-none" style={{ color: 'var(--danger)' }}>{formatPct(pct(totalBebanOperasional, totalPendapatan))}</p>
              <p className="text-[10.5px] font-medium" style={{ color: 'var(--text-muted)' }}>Beban dari Omzet</p>
            </div>
            <div className="card p-3 flex flex-col items-center text-center gap-0.5" style={{ background: labaBersih >= 0 ? 'var(--accent-bg)' : 'var(--danger-bg)' }}>
              <p className="text-base font-extrabold tabular leading-none" style={{ color: labaBersih >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{formatPct(pct(labaBersih, totalPendapatan))}</p>
              <p className="text-[10.5px] font-medium" style={{ color: 'var(--text-muted)' }}>Margin Bersih dari Omzet</p>
            </div>
          </div>

          {/* Penilaian kesehatan usaha — grade A-E dari Margin Bersih (Laba Bersih / Omzet). Patokan umum
              untuk usaha kuliner/UMKM, bukan standar akuntansi formal — sekadar bantu baca cepat. */}
          <div className="card p-4 flex items-center gap-4" style={{ background: MARGIN_TIER_COLOR[gradeUsaha.tier].bg }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-2xl font-extrabold" style={{ background: MARGIN_TIER_COLOR[gradeUsaha.tier].ring, color: MARGIN_TIER_COLOR[gradeUsaha.tier].fg }}>
              {gradeUsaha.grade}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: MARGIN_TIER_COLOR[gradeUsaha.tier].fg }}>
                <Award size={15} /> Penilaian Usaha: {gradeUsaha.label}
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                {gradeUsaha.desc} Margin Bersih periode ini <span className="font-bold tabular">{formatPct(marginBersihPct)}</span> dari Omzet.
              </p>
            </div>
          </div>

          {/* Tabel skala penilaian — disembunyikan default, cuma buat yang mau lihat semua ambang batas
              grade A-E sekaligus, bukan cuma grade yang lagi didapat. */}
          <div className="card overflow-hidden">
            <button type="button" onClick={() => setShowGradeScale(v => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-xs font-bold"
              style={{ color: 'var(--accent)' }}>
              <Award size={14} />
              <span className="flex-1 text-left">Skala Penilaian Margin Bersih (Grade A-E)</span>
              {showGradeScale ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showGradeScale && (
              <div className="px-5 pb-5" style={{ borderTop: '1px solid var(--border-2)' }}>
                <p className="text-[11px] my-3" style={{ color: 'var(--text-muted)' }}>
                  Patokan umum untuk usaha kuliner/UMKM skala rumahan, bukan standar akuntansi baku — sekadar bantu baca cepat sehat tidaknya margin laba.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th className="pb-2 pr-3 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-2)' }}>Grade</th>
                        <th className="pb-2 pr-3 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-2)' }}>Margin Bersih</th>
                        <th className="pb-2 pr-3 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-2)' }}>Status</th>
                        <th className="pb-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-2)' }}>Arti</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MARGIN_GRADE_SCALE.map(row => {
                        const rc = MARGIN_TIER_COLOR[row.tier];
                        const isCurrent = row.grade === gradeUsaha.grade;
                        return (
                          <tr key={row.grade} style={{ background: isCurrent ? rc.bg : 'transparent' }}>
                            <td className="py-2 pr-3 align-top">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-extrabold"
                                style={{ background: rc.ring, color: rc.fg }}>{row.grade}</span>
                            </td>
                            <td className="py-2 pr-3 align-top text-xs font-bold tabular whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{row.range}</td>
                            <td className="py-2 pr-3 align-top text-xs font-bold whitespace-nowrap" style={{ color: rc.fg }}>{row.label}{isCurrent && <span className="ml-1 font-medium" style={{ color: 'var(--text-muted)' }}>(sekarang)</span>}</td>
                            <td className="py-2 align-top text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>{row.desc}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Rekonsiliasi Kas vs Laba — disembunyikan default, cuma buat yang penasaran kenapa Laba
              Bersih beda dari Saldo Kas. Jawaban "uang saya berapa" sudah ada di kartu Saldo Kas Saat
              Ini di atas; jawaban "pendapatan dikurangi pengeluaran" ada di panel di bawah ini yang
              tetap selalu terlihat, jadi panel ini murni penjelasan tambahan yang boleh diabaikan. */}
          <div className="card overflow-hidden">
            <button type="button" onClick={() => setShowRekonsiliasi(v => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-xs font-bold"
              style={{ color: 'var(--accent)' }}>
              <Info size={14} />
              <span className="flex-1 text-left">Kenapa Laba Bersih Beda dari Saldo Kas? — Lihat Rekonsiliasi</span>
              {showRekonsiliasi ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showRekonsiliasi && (
              <div className="px-5 pb-5" style={{ borderTop: '1px solid var(--border-2)' }}>
                <p className="text-[11px] my-3" style={{ color: 'var(--text-muted)' }}>
                  Laba Bersih bukan saldo kas — ini menunjukkan kenapa keduanya beda di periode ini. Saldo kas RIIL sekarang ada di kartu &quot;Saldo Kas Saat Ini&quot; di bagian atas halaman.
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Laba Bersih (Akrual)</span>
                    <span className="font-bold tabular">{formatRp(labaBersih)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>(+) Modal Masuk</span>
                    <span className="font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(totalModalMasuk)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>(−) Prive</span>
                    <span className="font-bold tabular" style={{ color: 'var(--danger)' }}>{formatRp(totalPrive)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {selisihWaktuPersediaan >= 0 ? '(+) ' : '(−) '}Selisih Waktu Bahan Baku/Produksi
                    </span>
                    <span className="font-bold tabular" style={{ color: selisihWaktuPersediaan >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {formatRp(selisihWaktuPersediaan)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                    <span className="font-bold" style={{ color: 'var(--text-primary)' }}>= Perubahan Saldo Kas (Periode Ini)</span>
                    <span className="font-extrabold tabular" style={{ color: perubahanSaldoKasPeriode >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {formatRp(perubahanSaldoKasPeriode)}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
                  {selisihWaktuPersediaan < 0
                    ? `Sedang menumpuk stok/produksi: belanja Bahan Baku & Produksi (${formatRp(totalBebanCogsSourced)}) periode ini lebih besar dari HPP barang yang terjual (${formatRp(hpp)}) — kas keluar lebih dulu dari yang diakui sebagai biaya.`
                    : selisihWaktuPersediaan > 0
                    ? `Menjual dari stok lama: HPP barang yang terjual (${formatRp(hpp)}) periode ini lebih besar dari belanja Bahan Baku & Produksi (${formatRp(totalBebanCogsSourced)}) — biaya yang diakui lebih besar dari kas yang keluar.`
                    : 'Belanja Bahan Baku/Produksi periode ini sama persis dengan HPP barang yang terjual.'}
                </p>
              </div>
            )}
          </div>

          {/* Pendapatan − Pengeluaran (kas) — jawaban langsung ke pertanyaan paling umum, selalu
              terlihat (tidak di-collapse) supaya tidak perlu buka panel apa pun buat lihat ini. */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              Pendapatan − Pengeluaran (Kas) <InfoTip label={GLOSSARY_LABA_RUGI[6].desc} />
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--surface-2)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(21,128,61,0.15)', color: 'var(--success)' }}>
                  <TrendingUp size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: 'var(--success)' }}>{formatRp(totalPendapatan)}</p>
                  <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Total Pendapatan</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--surface-2)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(220,38,38,0.15)', color: 'var(--danger)' }}>
                  <TrendingDown size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: 'var(--danger)' }}>{formatRp(totalBeban)}</p>
                  <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Total Beban (Kas)</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--surface-2)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: labaBersihKasLama >= 0 ? 'rgba(212,105,30,0.15)' : 'rgba(220,38,38,0.15)', color: labaBersihKasLama >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                  <Wallet size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: labaBersihKasLama >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{formatRp(labaBersihKasLama)}</p>
                  <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{labaBersihKasLama >= 0 ? 'Laba Bersih (Kas)' : 'Rugi Bersih (Kas)'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Modal & Prive — di luar Laba Rugi operasional */}
          {(totalModalMasuk > 0 || totalPrive > 0) && (
            <div className="card p-4 flex items-center gap-4 flex-wrap" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-center gap-2">
                <Landmark size={15} style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Di luar Laba Rugi operasional:</span>
              </div>
              <span className="text-xs font-semibold" style={{ color: 'var(--success)' }}>Modal Masuk {formatRp(totalModalMasuk)}</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>Prive {formatRp(totalPrive)}</span>
            </div>
          )}

          {/* Chart tren */}
          {trendData.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center gap-4 mb-3">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tren Pendapatan vs Pengeluaran</p>
                <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  <span className="flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 4, background: '#15803D', display: 'inline-block' }} /> Pendapatan</span>
                  <span className="flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 4, background: '#DC2626', display: 'inline-block' }} /> Pengeluaran</span>
                </div>
              </div>
              <TrendChart data={trendData} />
            </div>
          )}

          {/* Rincian Pendapatan & Beban */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                <ArrowUpCircle size={15} style={{ color: 'var(--success)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Rincian Pendapatan</p>
              </div>
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                {[
                  { icon: <ShoppingCart size={14} />, label: 'Penjualan Kasir', val: kasirRevenue },
                  { icon: <Globe size={14} />, label: 'Penjualan Online', val: onlineRevenue },
                  { icon: <Store size={14} />, label: 'Pendapatan Konsinyasi', val: consignmentRevenue },
                  { icon: <Coins size={14} />, label: 'Pendapatan Lain-lain', val: totalPendapatanLain },
                ].map((r, i) => (
                  <div key={i} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{r.icon}</div>
                    <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{r.label}</span>
                    <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(r.val)}</span>
                    <span className="text-xs tabular w-10 text-right" style={{ color: 'var(--text-muted)' }}>
                      {totalPendapatan > 0 ? Math.round((r.val / totalPendapatan) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                <ArrowDownCircle size={15} style={{ color: 'var(--danger)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Rincian Beban (Kas)</p>
              </div>
              {expenseByCategory.size === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Tidak ada pengeluaran di periode ini.</p>
              ) : (
                <>
                  <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                    {[...expenseByCategory.entries()].sort((a, b) => b[1] - a[1]).map(([cat, val]) => {
                      const foldedIntoHpp = expenses.some(e => e.category === cat && isCogsSourcedExpense(e));
                      return (
                        <div key={cat} className="px-5 py-3 flex items-center gap-3">
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: EXPENSE_CATEGORY_COLORS[cat] ?? '#9CA3AF', flexShrink: 0 }} />
                          <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {cat}
                            {foldedIntoHpp && <span className="text-[10px] font-medium ml-1.5" style={{ color: 'var(--text-muted)' }}>(→ masuk HPP saat terjual)</span>}
                          </span>
                          <span className="text-sm font-bold tabular" style={{ color: 'var(--danger)' }}>{formatRp(val)}</span>
                          <span className="text-xs tabular w-10 text-right" style={{ color: 'var(--text-muted)' }}>
                            {totalBeban > 0 ? Math.round((val / totalBeban) * 100) : 0}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] px-5 py-3" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-2)' }}>
                    Total kas keluar periode ini: <span className="font-bold">{formatRp(totalBeban)}</span>. Baris bertanda &quot;→ masuk HPP&quot; sudah dihitung sebagai HPP saat barangnya laku, jadi tidak dijumlah lagi di Beban Operasional supaya tidak dobel.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <GlossaryPanel open={showGlossary} onToggle={() => setShowGlossary(v => !v)} items={GLOSSARY_JURNAL} />

          <div className="card p-4 flex items-center gap-3 flex-wrap">
            <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Saldo Awal (opsional)</label>
            <NumberInput value={saldoAwalRaw}
              onChange={raw => { setSaldoAwalRaw(raw); localStorage.setItem(SALDO_AWAL_KEY, raw); }}
              className="input w-full sm:w-[180px]" style={{ height: 36 }} placeholder="0" />
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Saldo kas nyata sebelum mulai pencatatan di aplikasi ini (disimpan di browser ini saja, bukan data akuntansi baku). Dipakai juga sebagai dasar &quot;Saldo Kas Saat Ini&quot; di bagian atas halaman.
            </p>
          </div>

          {journalWithSaldo.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada transaksi di periode ini.</p>
            </div>
          ) : (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              <div className="hidden lg:flex px-4 py-2.5 items-center gap-3" style={{ borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                <span className="text-[10px] font-bold uppercase tracking-wide flex-shrink-0 w-24" style={{ color: 'var(--text-muted)' }}>Tanggal</span>
                <span className="flex-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Keterangan</span>
                <span className="text-[10px] font-bold uppercase tracking-wide w-28 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Debit</span>
                <span className="text-[10px] font-bold uppercase tracking-wide w-28 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Kredit</span>
                <span className="text-[10px] font-bold uppercase tracking-wide w-28 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Saldo</span>
              </div>
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
              {journalDisplay.map((j, i) => (
                <div key={i} className="px-4 py-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                  <div className="flex items-center gap-3 lg:contents">
                    <span className="text-xs tabular flex-shrink-0 w-24 flex flex-col leading-tight" style={{ color: 'var(--text-muted)' }}>
                      <span>{j.seconds ? new Date(j.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' }) : '–'}</span>
                      {j.seconds ? <span className="text-[10px] opacity-70">{new Date(j.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span> : null}
                    </span>
                    {j.invoiceNo ? (
                      <button type="button" onClick={() => onOpenOrder?.(j.invoiceNo!)}
                        className="flex-1 min-w-0 text-sm text-left truncate hover:underline"
                        style={{ color: 'var(--accent)' }} title="Lihat transaksi di menu Pesanan">
                        {j.description}
                      </button>
                    ) : (
                      <span className="flex-1 min-w-0 text-sm truncate" style={{ color: 'var(--text-primary)' }}>{j.description}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pl-0 lg:contents">
                    <div className="lg:w-28 lg:flex-shrink-0 min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Debit</p>
                      <p className="text-sm font-bold tabular truncate lg:text-right" style={{ color: j.debit > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                        {j.debit > 0 ? formatRp(j.debit) : '–'}
                      </p>
                    </div>
                    <div className="lg:w-28 lg:flex-shrink-0 min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Kredit</p>
                      <p className="text-sm font-bold tabular truncate lg:text-right" style={{ color: j.kredit > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {j.kredit > 0 ? formatRp(j.kredit) : '–'}
                      </p>
                    </div>
                    <div className="lg:w-28 lg:flex-shrink-0 min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Saldo</p>
                      <p className="text-sm font-bold tabular truncate lg:text-right" style={{ color: 'var(--text-primary)' }}>
                        {formatRp(j.saldo)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}
        </div>
      )}

      {openDetail === 'omzet' && (
        <SummaryDetailModal title="Rincian Omzet" icon={TrendingUp} color="var(--success)"
          rows={omzetDetailRows} total={totalPendapatan} totalLabel="Total Omzet"
          periodLabel={periodLabel} from={from} to={to}
          emptyMessage="Belum ada pendapatan di periode ini." onClose={() => setOpenDetail(null)} />
      )}
      {openDetail === 'hpp' && (
        <SummaryDetailModal title="Rincian HPP" icon={Package} color="#B45309"
          rows={hppDetailRows} total={hpp} totalLabel="Total HPP"
          periodLabel={periodLabel} from={from} to={to}
          emptyMessage="Belum ada produk terjual di periode ini." onClose={() => setOpenDetail(null)} />
      )}
      {openDetail === 'beban' && (
        <SummaryDetailModal title="Rincian Beban Operasional" icon={Receipt} color="var(--danger)"
          rows={bebanOperasionalDetailRows} total={totalBebanOperasional} totalLabel="Total Beban Operasional"
          periodLabel={periodLabel} from={from} to={to}
          emptyMessage="Belum ada beban operasional di periode ini." onClose={() => setOpenDetail(null)} />
      )}
    </div>
  );
}
