'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Coins, Plus, Pencil, Trash2, X, Check, Loader2, Search,
  ChevronLeft, ChevronRight, TrendingUp, CalendarDays, Wallet,
  ShoppingCart, Globe, Store, Lock,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import FilterSelect from '@/components/FilterSelect';
import PageSizeSelect from '@/components/PageSizeSelect';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { RecordHistoryButton, RecordHistoryPanel } from '@/components/RecordHistory';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';

const API = '';
const HEADER_BTN_H = 34;

const INCOME_CATEGORIES = ['Penjualan Lain', 'Komisi', 'Refund/Retur Diterima', 'Bunga Bank', 'Klaim Asuransi', 'Lainnya'];

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function todayISO() {
  return toISO(new Date());
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Periode — sama seperti pemilih periode di Laporan Keuangan ───────────────
type PeriodKey = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
const PERIOD_OPTIONS: { id: PeriodKey; label: string }[] = [
  { id: 'today', label: 'Hari Ini' },
  { id: '7d',    label: '7 Hari' },
  { id: '30d',   label: '30 Hari' },
  { id: 'month', label: 'Bulan Ini' },
  { id: 'year',  label: 'Tahun Ini' },
  { id: 'custom', label: 'Custom' },
];

function periodRange(period: PeriodKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = toISO(now);
  switch (period) {
    case 'today': return { from: today, to: today };
    case '7d': { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: toISO(d), to: today }; }
    case '30d': { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: toISO(d), to: today }; }
    case 'month': { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { from: toISO(d), to: today }; }
    case 'year': { const d = new Date(now.getFullYear(), 0, 1); return { from: toISO(d), to: today }; }
    case 'custom': return { from: customFrom || today, to: customTo || today };
  }
}

function formatDateDisplay(iso: string, createdAt?: { seconds: number } | null) {
  if (!iso) return '–';
  const dateStr = new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!createdAt?.seconds) return dateStr;
  const timeStr = new Date(createdAt.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
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

// `auto` menandai baris yang bukan entri manual — hasil sinkronisasi dari data yang sudah ada
// di menu Pesanan (kasir/online) & Mitra (rekap konsinyasi), supaya menu ini menampilkan SEMUA
// uang masuk, bukan cuma pemasukan lain-lain. Baris `auto` read-only (edit/hapus lewat sumbernya).
type AutoSource = 'kasir' | 'online' | 'konsinyasi';

interface IncomeItem { description: string; amount: number }

interface Income {
  id: string; category: string; description: string; amount: number; date: string; note: string;
  items?: IncomeItem[];
  createdAt?: { seconds: number };
  auto?: AutoSource;
  walletId?: string | null;
}

interface OrderForIncome {
  id: string; invoiceNo?: string; customerName?: string; total?: number;
  source?: 'kasir' | 'portal'; status?: string; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAt?: { seconds: number } | null;
  walletId?: string | null;
}
interface RecapForIncome {
  id: string; locationName?: string; totalRevenue?: number;
  paymentStatus?: 'lunas' | 'belum_lunas'; createdAt?: { seconds: number } | null;
  walletId?: string | null;
}

const AUTO_ICON: Record<AutoSource, typeof ShoppingCart> = { kasir: ShoppingCart, online: Globe, konsinyasi: Store };
function AutoAvatar({ source, size = 16 }: { source: AutoSource; size?: number }) {
  const Icon = AUTO_ICON[source];
  return <Icon size={size} />;
}
const AUTO_LOCK_MESSAGE: Record<AutoSource, string> = {
  kasir: 'Ini penjualan kasir — edit/hapus dari menu Pesanan.',
  online: 'Ini pesanan online — edit/hapus dari menu Pesanan.',
  konsinyasi: 'Ini rekap konsinyasi — edit/hapus dari menu Mitra.',
};

type IncomeItemForm = { description: string; amount: string };
const emptyItem = (): IncomeItemForm => ({ description: '', amount: '' });

type IncomeForm = { category: string; categoryCustom: string; items: IncomeItemForm[]; date: string; note: string; walletId: string };
const emptyForm = (): IncomeForm => ({ category: 'Penjualan Lain', categoryCustom: '', items: [emptyItem()], date: todayISO(), note: '', walletId: '' });

export default function IncomeTab({ creds }: { creds: string }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);
  const wallets = useWallets(creds);
  const [walletBalances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

  const [income,      setIncome]      = useState<Income[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [historyId,  setHistoryId]  = useState<string | null>(null);
  const toggleHistory = (id: string) => setHistoryId(cur => cur === id ? null : id);
  const [search,      setSearch]      = useState('');
  const [categoryFilter, setCategoryFilter] = useState('semua');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('income');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [period,     setPeriod]     = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const { from, to } = periodRange(period, customFrom, customTo);

  const [editing,    setEditing]    = useState<{ id: string } & IncomeForm | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');
  const [exporting,  setExporting]  = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Generasi request — dua fetch untuk periode berbeda bisa tumpang tindih (klik cepat ganti
  // filter sebelum respons pertama selesai), dan tidak ada jaminan urutan respons sama dengan
  // urutan request dikirim. Tanpa penjaga ini, respons periode LAMA yang kebetulan datang
  // belakangan bisa menimpa data periode BARU yang sudah lebih dulu tampil.
  const loadIdRef = useRef(0);
  const load = async () => {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    // from/to non-kosong juga otomatis bypass limit 50 default di /api/orders & /api/consignment/recap.
    const qs = `from=${from}&to=${to}`;
    const [iRes, oRes, rRes] = await Promise.all([
      fetch(`${API}/api/income?${qs}`, { headers }),
      fetch(`${API}/api/orders?${qs}`, { headers }),
      fetch(`${API}/api/consignment/recap?${qs}`, { headers }),
    ]);
    if (myLoadId !== loadIdRef.current) return; // request lain (lebih baru) sudah menggantikan ini
    const manual: Income[] = iRes.ok ? (await iRes.json() as { income: Income[] }).income : [];
    const orders: OrderForIncome[] = oRes.ok ? (await oRes.json() as { orders: OrderForIncome[] }).orders : [];
    const recaps: RecapForIncome[] = rRes.ok ? (await rRes.json() as { recaps: RecapForIncome[] }).recaps : [];

    // Sama persis dengan definisi "uang masuk terhitung" di Laporan Keuangan — pesanan yang
    // belum dikonfirmasi ('baru' — online atau kasir berisi item "Buka PO"), belum lunas,
    // atau dibatalkan tidak ikut dihitung.
    const countedOrders = orders.filter(o =>
      (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
    const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');
    const dateOf = (c?: { seconds: number } | null) => c?.seconds ? new Date(c.seconds * 1000).toISOString().slice(0, 10) : todayISO();

    const fromOrders: Income[] = countedOrders.map(o => ({
      id: `order-${o.id}`,
      category: o.source === 'portal' ? 'Penjualan Online' : 'Penjualan Kasir',
      description: `${o.source === 'portal' ? 'Online' : 'Kasir'} - ${o.invoiceNo || o.customerName || ''}`,
      amount: o.total ?? 0, date: dateOf(o.createdAt),
      note: `Otomatis dari pesanan ${o.source === 'portal' ? 'online' : 'kasir'}${o.invoiceNo ? ` (Invoice ${o.invoiceNo})` : ''}${o.customerName ? ` — ${o.customerName}` : ''}.`,
      auto: o.source === 'portal' ? 'online' : 'kasir',
      walletId: o.walletId ?? null,
      createdAt: o.createdAt ?? undefined,
    }));
    const fromRecaps: Income[] = countedRecaps.map(r => ({
      id: `recap-${r.id}`,
      category: 'Pendapatan Konsinyasi',
      description: `Konsinyasi - ${r.locationName ?? ''}`,
      amount: r.totalRevenue ?? 0, date: dateOf(r.createdAt),
      note: `Otomatis dari rekap konsinyasi${r.locationName ? ` di ${r.locationName}` : ''}.`,
      auto: 'konsinyasi',
      walletId: r.walletId ?? null,
      createdAt: r.createdAt ?? undefined,
    }));

    setIncome([...manual, ...fromOrders, ...fromRecaps]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [period, customFrom, customTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditing({ id: '', ...emptyForm() }); setIsNew(true); setError(''); };
  const openEdit = (i: Income) => {
    if (i.auto) { toast.error(AUTO_LOCK_MESSAGE[i.auto]); return; }
    const known = INCOME_CATEGORIES.includes(i.category);
    const items = i.items && i.items.length > 0
      ? i.items.map(it => ({ description: it.description, amount: String(it.amount) }))
      : [{ description: i.description, amount: String(i.amount) }];
    setEditing({
      id: i.id, category: known ? i.category : 'Lainnya', categoryCustom: known ? '' : i.category,
      items, date: i.date, note: i.note, walletId: i.walletId ?? '',
    });
    setIsNew(false); setError('');
  };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const addItem    = () => setEditing(e => e ? { ...e, items: [...e.items, emptyItem()] } : e);
  const removeItem = (idx: number) => setEditing(e => e ? { ...e, items: e.items.filter((_, i) => i !== idx) } : e);
  const updateItem = (idx: number, patch: Partial<IncomeItemForm>) =>
    setEditing(e => e ? { ...e, items: e.items.map((it, i) => i === idx ? { ...it, ...patch } : it) } : e);

  const save = async () => {
    if (!editing) return;
    const finalCategory = editing.category === 'Lainnya' && editing.categoryCustom.trim() ? editing.categoryCustom.trim() : editing.category;
    const items = editing.items.map(it => ({ description: it.description.trim(), amount: parseFloat(it.amount) || 0 }));
    if (items.some(it => !it.description)) { setError('Keterangan tiap item wajib diisi.'); return; }
    if (items.some(it => it.amount <= 0)) { setError('Jumlah tiap item harus lebih dari 0.'); return; }
    if (!editing.date) { setError('Tanggal wajib diisi.'); return; }
    if (!editing.walletId) { setError('Dompet tujuan wajib dipilih.'); return; }
    setSaving(true); setError('');
    const amountNum   = items.reduce((s, it) => s + it.amount, 0);
    const description = items.map(it => it.description).join(', ');
    const payload = { category: finalCategory, description, amount: amountNum, items, date: editing.date, note: editing.note, walletId: editing.walletId };
    const r = isNew
      ? await fetch(`${API}/api/income`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/income/${editing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) {
      await load();
      refetchBalances();
      closeEdit();
      toast.success(isNew ? 'Pemasukan berhasil dicatat.' : 'Pemasukan berhasil diperbarui.');
    } else {
      toast.error('Gagal menyimpan pemasukan.');
      setError('Gagal menyimpan pemasukan.');
    }
    setSaving(false);
  };

  const del = async (i: Income) => {
    if (i.auto) { toast.error(AUTO_LOCK_MESSAGE[i.auto]); return; }
    if (!await confirm({ message: `Hapus pemasukan "${i.description}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(i.id);
    const r = await fetch(`${API}/api/income/${i.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      refetchBalances();
      setSelected(s => { const n = new Set(s); n.delete(i.id); return n; });
      toast.success('Pemasukan berhasil dihapus.');
    } else {
      toast.error('Gagal menghapus pemasukan.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} pemasukan yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const r = await fetch(`${API}/api/income/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number };
      await load();
      refetchBalances();
      setSelected(new Set());
      toast.success(`${d.deleted} pemasukan berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus pemasukan yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) => {
    if (income.find(i => i.id === id)?.auto) return;
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ── Ringkasan (sesuai periode terpilih) ───────────────────────
  const periodLabel = PERIOD_OPTIONS.find(p => p.id === period)?.label ?? '';
  const totalPeriode = income.reduce((s, i) => s + i.amount, 0);
  const daysInRange  = Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1);
  const avgPerDay    = totalPeriode / daysInRange;

  const categoryOptions = [
    { value: 'semua', label: 'Semua Kategori' },
    ...[...new Set([...INCOME_CATEGORIES, ...income.map(i => i.category)])].map(c => ({ value: c, label: c })),
  ];

  const filtered = income
    .filter(i => {
      const matchCat = categoryFilter === 'semua' || i.category === categoryFilter;
      const matchQ = !search
        || i.description.toLowerCase().includes(search.toLowerCase())
        || i.category.toLowerCase().includes(search.toLowerCase())
        || (i.note ?? '').toLowerCase().includes(search.toLowerCase());
      return matchCat && matchQ;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const togglePageAll = () => {
    const pageIds     = paginated.filter(i => !i.auto).map(i => i.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const exportExcel = async (rows: Income[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada pemasukan untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Pemasukan');
      ws.columns = [
        { key: 'tgl', width: 16 }, { key: 'kat', width: 18 }, { key: 'ket', width: 32 },
        { key: 'jml', width: 18 }, { key: 'catatan', width: 32 },
      ];

      ws.mergeCells(1, 1, 1, 5);
      const t = ws.getCell(1, 1);
      t.value = 'DAFTAR PEMASUKAN LAIN-LAIN — CEMILAN TEH RISMA';
      t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, 5);
      const s = ws.getCell(2, 1);
      s.value = `${rows.length} pemasukan (${label})`;
      s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      s.alignment = { horizontal: 'center', vertical: 'middle' };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const headerRow = ws.getRow(3);
      ['Tanggal', 'Kategori', 'Keterangan', 'Jumlah', 'Catatan'].forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];

      rows.forEach((i, idx) => {
        const rowNum = 4 + idx;
        const row = ws.getRow(rowNum);
        row.getCell(1).value = formatDateDisplay(i.date);
        row.getCell(2).value = i.category;
        row.getCell(3).value = i.description;
        row.getCell(4).value = i.amount;
        row.getCell(4).numFmt = '"Rp"#,##0';
        row.getCell(5).value = i.note ?? '';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pemasukan-${todayISO()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} pemasukan ke Excel.`);
    } finally { setExporting(false); }
  };

  const exportPdf = async (rows: Income[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada pemasukan untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'PEMASUKAN LAIN-LAIN',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'Tanggal', width: '14%' },
              { header: 'Kategori', width: '16%' },
              { header: 'Keterangan', width: '30%' },
              { header: 'Jumlah', width: '16%', align: 'right', bold: true },
              { header: 'Catatan', width: '24%' },
            ],
            rows: rows.map(i => [formatDateDisplay(i.date), i.category, i.description, formatRp(i.amount), i.note || '']),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pemasukan-${todayISO()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} pemasukan ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally { setExportingPdf(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: <TrendingUp   size={16} />, label: `Pemasukan ${periodLabel}`, val: formatRp(totalPeriode), color: 'var(--success)', bg: 'var(--success-bg)' },
          { icon: <CalendarDays size={16} />, label: 'Rata-rata / Hari', val: formatRp(avgPerDay), color: 'var(--accent)', bg: 'var(--accent-bg)' },
          { icon: <Wallet       size={16} />, label: 'Jumlah Transaksi', val: String(income.length), color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
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

      {/* Pemilih periode */}
      {income.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {PERIOD_OPTIONS.map(p => (
            <button key={p.id} onClick={() => { setPeriod(p.id); resetPage(); }}
              className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
              style={period === p.id ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              {p.label}
            </button>
          ))}
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); resetPage(); }} className="input" style={{ height: 36 }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
              <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); resetPage(); }} className="input" style={{ height: 36 }} />
            </div>
          )}
        </div>
      )}

      {/* Header: search + actions in one row */}
      {income.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-full sm:w-[200px] flex-shrink-0">
            <FilterSelect
              value={categoryFilter}
              onChange={v => { setCategoryFilter(v); resetPage(); }}
              height={HEADER_BTN_H}
              searchPlaceholder="Cari kategori…"
              options={categoryOptions}
            />
          </div>
          <div className="flex flex-row items-center gap-2 sm:gap-3 sm:flex-1">
            <div className="relative flex-1 min-w-0">
              <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); resetPage(); }}
                className="input text-sm w-full"
                style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                placeholder="Cari keterangan, kategori, atau catatan…"
              />
            </div>
            <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
              <Tooltip label="Export Excel">
                <button onClick={() => exportExcel(filtered, 'sesuai filter')} disabled={exporting} aria-label="Export Excel"
                  className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                </button>
              </Tooltip>
              <Tooltip label="Export PDF">
                <button onClick={() => exportPdf(filtered, 'sesuai filter')} disabled={exportingPdf} aria-label="Export PDF"
                  className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                </button>
              </Tooltip>
              <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
              <button onClick={openNew} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                <Plus size={13} /> <span className="hidden sm:inline">Catat Pemasukan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {income.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
            <Coins size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada pemasukan tercatat</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            Penjualan kasir/online & rekap konsinyasi akan otomatis muncul di sini. Klik &quot;Catat Pemasukan&quot;
            untuk menambah pemasukan di luar penjualan (komisi, refund, bunga bank, dll).
          </p>
          <button onClick={openNew} className="btn-primary mx-auto px-5 py-2.5 text-sm">
            <Plus size={14} /> Catat Pemasukan Pertama
          </button>
        </div>
      ) : (
        <>
          {paginated.length > 0 && (() => {
            const selectableIds = paginated.filter(i => !i.auto).map(i => i.id);
            return (
              <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                <Checkbox
                  checked={selectableIds.length > 0 && selectableIds.every(id => selected.has(id))}
                  indeterminate={selectableIds.some(id => selected.has(id)) && !selectableIds.every(id => selected.has(id))}
                  onChange={togglePageAll}
                />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} pemasukan di halaman ini`}
                </span>
              </div>
            );
          })()}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada pemasukan yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((i, idx) => {
                const isDeleting = deletingId === i.id;
                const isSelected = selected.has(i.id);
                return (
                  <div key={i.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, transition: 'background 0.1s' }}>
                    <div className="flex items-center gap-2 px-4 py-3.5">
                      {i.auto
                        ? <Lock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, width: 18 }} />
                        : <Checkbox checked={isSelected} onChange={() => toggleSelect(i.id)} />}
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                        {i.auto ? <AutoAvatar source={i.auto} /> : <Coins size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{i.description}</p>
                          <span className="badge badge-gray text-[10px]">{i.category}</span>
                          {i.auto && <span className="badge badge-blue text-[10px]">Otomatis</span>}
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(i.date, i.createdAt)}</p>
                      </div>
                      <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--success)' }}>+{formatRp(i.amount)}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!i.auto && (
                          <>
                            <Tooltip label="Edit">
                              <button onClick={() => openEdit(i)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                                <Pencil size={13} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Hapus">
                              <button onClick={() => del(i)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                                {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                              </button>
                            </Tooltip>
                          </>
                        )}
                        {i.note && (
                          <Tooltip label="Catatan">
                            <button onClick={() => setExpandedId(expandedId === i.id ? null : i.id)} className="btn-ghost p-2">
                              <ChevronRight size={13} style={{ transform: expandedId === i.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                            </button>
                          </Tooltip>
                        )}
                        <RecordHistoryButton open={historyId === i.id} onToggle={() => toggleHistory(i.id)} />
                      </div>
                    </div>
                    {expandedId === i.id && i.note && (
                      <div className="px-4 pb-4 pt-1" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Catatan</p>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{i.note}</p>
                      </div>
                    )}
                    {historyId === i.id && <RecordHistoryPanel creds={creds} entity="income" entityId={i.id} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(i => {
                const isDeleting = deletingId === i.id;
                const isSelected = selected.has(i.id);
                return (
                  <div key={i.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      {i.auto
                        ? <Lock size={13} style={{ color: 'var(--text-muted)', display: 'block', margin: 2.5 }} />
                        : <Checkbox checked={isSelected} onChange={() => toggleSelect(i.id)} />}
                    </div>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                        {i.auto ? <AutoAvatar source={i.auto} size={20} /> : <Coins size={20} />}
                      </div>
                      <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{i.description}</p>
                      <div className="flex items-center gap-1">
                        <span className="badge badge-gray text-[10px]">{i.category}</span>
                        {i.auto && <span className="badge badge-blue text-[10px]">Otomatis</span>}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(i.date, i.createdAt)}</p>
                      <p className="text-base font-extrabold tabular mt-1" style={{ color: 'var(--success)' }}>+{formatRp(i.amount)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      {i.note ? (
                        <button onClick={() => setExpandedId(expandedId === i.id ? null : i.id)} className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                          Catatan <ChevronRight size={12} style={{ transform: expandedId === i.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                        </button>
                      ) : <span />}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!i.auto && (
                          <>
                            <Tooltip label="Edit">
                              <button onClick={() => openEdit(i)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                                <Pencil size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Hapus">
                              <button onClick={() => del(i)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                                {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </Tooltip>
                          </>
                        )}
                        <RecordHistoryButton open={historyId === i.id} onToggle={() => toggleHistory(i.id)} />
                      </div>
                    </div>
                    {expandedId === i.id && i.note && (
                      <div className="px-4 pb-4 pt-1" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{i.note}</p>
                      </div>
                    )}
                    {historyId === i.id && <RecordHistoryPanel creds={creds} entity="income" entityId={i.id} />}
                  </div>
                );
              })}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} pemasukan · halaman {safePage} dari {totalPages}
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
                            style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
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
            <button onClick={() => exportExcel(income.filter(i => selected.has(i.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(income.filter(i => selected.has(i.id)), 'terpilih')} disabled={exportingPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              PDF
            </button>
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

      {/* Add/Edit modal */}
      {editing && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Coins size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Catat Pemasukan' : 'Edit Pemasukan'}</p>
                  <p className="modal-subtitle">{isNew ? 'Simpan pemasukan lain-lain baru' : `Edit: ${editing.items.map(it => it.description).filter(Boolean).join(', ') || '(tanpa keterangan)'}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={closeEdit} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Kategori</label>
                    <SearchSelect value={editing.category} onChange={v => setEditing({ ...editing, category: v })}
                      options={INCOME_CATEGORIES.map(c => ({ value: c, label: c }))}
                      searchPlaceholder="Cari kategori…" />
                  </div>
                  <div>
                    <label className="field-label">Tanggal <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} className="input" />
                  </div>
                </div>

                {editing.category === 'Lainnya' && (
                  <div>
                    <label className="field-label">Sebutkan Kategori</label>
                    <input value={editing.categoryCustom} onChange={e => setEditing({ ...editing, categoryCustom: e.target.value })}
                      className="input" placeholder="cth: Jual Barang Bekas, Hadiah, dll" />
                  </div>
                )}

                <div>
                  <label className="field-label">Dompet Tujuan <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={editing.walletId} onChange={v => setEditing({ ...editing, walletId: v })}
                    options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                  {editing.walletId && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Saldo saat ini: {formatRp(walletBalances[editing.walletId] ?? 0)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="field-label">Item / Keterangan <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {editing.items.map((item, idx) => (
                      <div key={idx} className="grid gap-2" style={{ gridTemplateColumns: '3fr 1fr auto', alignItems: 'center' }}>
                        <input value={item.description} onChange={e => updateItem(idx, { description: e.target.value })}
                          className="input" placeholder="cth: Komisi jadi reseller produk lain" autoFocus={idx === 0} />
                        <NumberInput value={item.amount} onChange={raw => updateItem(idx, { amount: raw })} placeholder="Jumlah (Rp)" />
                        <Tooltip label="Hapus item">
                          <button onClick={() => removeItem(idx)} disabled={editing.items.length === 1}
                            className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            <X size={14} />
                          </button>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                  <button onClick={addItem} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Item
                  </button>
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--success-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Pemasukan</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--success)' }}>
                    {formatRp(editing.items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0))}
                  </span>
                </div>

                <div>
                  <label className="field-label">Catatan (opsional)</label>
                  <textarea value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })}
                    className="input" style={{ resize: 'vertical', minHeight: 70 }} placeholder="Catatan tambahan" />
                </div>

                {error && (
                  <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={save} disabled={saving} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Pemasukan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
