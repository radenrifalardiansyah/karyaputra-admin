'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Wallet as WalletIcon, Plus, Pencil, Trash2, X, Check, Loader2, Power, ArrowRightLeft,
  Search, ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import IconPicker from '@/components/IconPicker';
import ColorPicker from '@/components/ColorPicker';
import NumberInput from '@/components/NumberInput';
import SearchSelect from '@/components/SearchSelect';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import { useVisiblePolling } from '@/lib/useVisiblePolling';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { resolveIcon } from '@/lib/icon-registry';
import { activeWalletOptions, type WalletDoc } from '@/lib/useWallets';

const API = '';
const HEADER_BTN_H = 34;
// wallets/balances/transfers are all Postgres-backed and cheap to re-fetch — safe to poll.
const WALLETS_POLL_MS = 30_000;

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDateDisplay(iso: string) {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

const WALLET_TYPE_LABEL: Record<string, string> = { cash: 'Tunai', bank: 'Bank', ewallet: 'E-Wallet', other: 'Lainnya' };
const WALLET_TYPES = ['cash', 'bank', 'ewallet', 'other'] as const;

interface Transfer { id: string; fromWalletId: string; toWalletId: string; amount: number; date: string; note?: string }

type WalletForm = { name: string; type: WalletDoc['type']; icon: string; color: string; initialBalance: string; bankName: string };
const emptyForm = (): WalletForm => ({ name: '', type: 'cash', icon: 'Wallet', color: '#16A34A', initialBalance: '', bankName: '' });

interface MasterBankOption { name: string; bankCode?: string; logoUrl?: string }

type TransferForm = { fromWalletId: string; toWalletId: string; amount: string; date: string; note: string };
const emptyTransferForm = (): TransferForm => ({ fromWalletId: '', toWalletId: '', amount: '', date: todayISO(), note: '' });

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

export default function WalletsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);

  const [wallets, setWallets] = useState<WalletDoc[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [unassigned, setUnassigned] = useState(0);

  const [editing, setEditing] = useState<({ id: string } & WalletForm) | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [bankOptions, setBankOptions] = useState<MasterBankOption[]>([]);

  useEffect(() => {
    fetch(`${API}/api/master-banks`, { headers })
      .then(r => r.ok ? r.json() as Promise<{ banks: MasterBankOption[] }> : Promise.resolve({ banks: [] }))
      .then(d => setBankOptions(d.banks))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Daftar dompet: search, tabel/kartu, ceklis, export ──────────────
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [view, setView] = useViewMode('wallets');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [transferEditing, setTransferEditing] = useState<({ id: string } & TransferForm) | null>(null);
  const [transferIsNew, setTransferIsNew] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferDeletingId, setTransferDeletingId] = useState<string | null>(null);
  const [transferError, setTransferError] = useState('');

  // ── Riwayat transfer: search, tabel/kartu, ceklis, export ───────────
  const [transferSearch, setTransferSearch] = useState('');
  const [transferPage, setTransferPage] = useState(1);
  const [transferPageSize, setTransferPageSize] = useState(10);
  const [transferView, setTransferView] = useViewMode('wallet-transfers');
  const [transferSelected, setTransferSelected] = useState<Set<string>>(new Set());
  const [transferBulkDeleting, setTransferBulkDeleting] = useState(false);
  const [transferExporting, setTransferExporting] = useState(false);
  const [transferExportingPdf, setTransferExportingPdf] = useState(false);

  // Generasi request — `load()` dipanggil ulang setelah tiap aksi CRUD dompet/transfer (lihat
  // pemanggil di bawah); dua aksi yang dipicu cepat berurutan bisa membuat dua `load()` tumpang
  // tindih, dan tanpa penjaga ini yang datang belakangan belum tentu yang paling baru.
  const loadIdRef = useRef(0);
  // Saldo per dompet + "Belum Ditentukan" dihitung server-side lewat /api/wallets/balances
  // (Tahap 6 migrasi, lihat plan gleaming-wondering-quokka.md) — dulu di sini fetch 5 endpoint
  // histori penuh (income/expenses/capital/orders/consignment-recap) lalu hitung sendiri di client.
  // `silent` skips the `loading` flip so the background auto-refresh poll below doesn't
  // replace the whole tab with the full-page spinner every tick.
  const load = async (silent = false) => {
    const myLoadId = ++loadIdRef.current;
    if (!silent) setLoading(true);
    try {
      const [wRes, bRes, tRes] = await Promise.all([
        fetch(`${API}/api/wallets`, { headers }),
        fetch(`${API}/api/wallets/balances`, { headers }),
        fetch(`${API}/api/wallet-transfers`, { headers }),
      ]);
      const walletList: WalletDoc[] = wRes.ok ? (await wRes.json() as { wallets: WalletDoc[] }).wallets : [];
      const { balances: nextBalances, unassigned: nextUnassigned } = bRes.ok
        ? await bRes.json() as { balances: Record<string, number>; unassigned: number }
        : { balances: {}, unassigned: 0 };
      const transferList: Transfer[] = tRes.ok ? (await tRes.json() as { transfers: Transfer[] }).transfers : [];
      if (myLoadId !== loadIdRef.current) return;

      setWallets(walletList);
      setTransfers(transferList);
      setBalances(nextBalances);
      setUnassigned(nextUnassigned);
    } finally {
      // Selalu matikan spinner awal, terlepas dari menang/kalahnya balapan `myLoadId` —
      // mount-effect (non-silent) dan poll pertama dari useVisiblePolling (silent) sama-sama
      // jalan di commit yang sama; kalau load awal kalah balapan, guard di atas skip
      // penyetelan data-nya, tapi spinner tetap wajib mati karena data terbaru sudah/akan
      // disetel oleh load yang menang.
      if (!silent) setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // /api/wallets & /api/wallet-transfers are Postgres-backed — safe to poll for balances/
  // transfers made from another device/session while this tab stays open.
  useVisiblePolling(() => load(true), WALLETS_POLL_MS, []);

  const walletOptions = activeWalletOptions(wallets, balances);
  const walletName = (id: string) => wallets.find(w => w.id === id)?.name ?? '(dompet dihapus)';

  // ─── Dompet: CRUD ────────────────────────────────────────────────
  const openNew = () => { setEditing({ id: '', ...emptyForm() }); setIsNew(true); setError(''); };
  const openEdit = (w: WalletDoc) => {
    setEditing({ id: w.id, name: w.name, type: w.type, icon: w.icon, color: w.color, initialBalance: String(w.initialBalance), bankName: w.bankName ?? '' });
    setIsNew(false); setError('');
  };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Nama dompet wajib diisi.'); return; }
    setSaving(true); setError('');
    const payload = {
      name: editing.name.trim(), type: editing.type, icon: editing.icon, color: editing.color,
      initialBalance: parseFloat(editing.initialBalance) || 0,
      bankName: editing.type === 'bank' ? editing.bankName.trim() : '',
    };
    const r = isNew
      ? await fetch(`${API}/api/wallets`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/wallets/${editing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Dompet berhasil ditambahkan.' : 'Dompet berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal menyimpan dompet.');
      toast.error(d.error ?? 'Gagal menyimpan dompet.');
    }
    setSaving(false);
  };

  const toggleActive = async (w: WalletDoc) => {
    setTogglingId(w.id);
    const r = await fetch(`${API}/api/wallets/${w.id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !w.isActive }),
    });
    if (r.ok) {
      await load();
      toast.success(w.isActive ? `Dompet "${w.name}" dinonaktifkan.` : `Dompet "${w.name}" diaktifkan kembali.`);
    } else {
      toast.error('Gagal mengubah status dompet.');
    }
    setTogglingId(null);
  };

  const del = async (w: WalletDoc) => {
    if (!await confirm({ message: `Hapus dompet "${w.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(w.id);
    const r = await fetch(`${API}/api/wallets/${w.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      setSelected(s => { const n = new Set(s); n.delete(w.id); return n; });
      toast.success(`Dompet "${w.name}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus dompet.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} dompet yang dipilih? Dompet dengan riwayat transaksi akan dilewati. Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const r = await fetch(`${API}/api/wallets/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number; skipped: number };
      await load();
      setSelected(new Set());
      toast.success(`${d.deleted} dompet berhasil dihapus.${d.skipped > 0 ? ` ${d.skipped} dilewati karena masih punya riwayat transaksi.` : ''}`);
    } else {
      toast.error('Gagal menghapus dompet yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const filtered = wallets
    .filter(w => !search
      || w.name.toLowerCase().includes(search.toLowerCase())
      || WALLET_TYPE_LABEL[w.type].toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const bankLogoByName = new Map(
    bankOptions.filter(b => b.logoUrl).map(b => [b.name.toLowerCase(), b.logoUrl as string])
  );
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const togglePageAll = () => {
    const pageIds     = paginated.map(w => w.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const exportExcel = async (rows: WalletDoc[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada dompet untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Dompet');
      ws.columns = [
        { key: 'no', width: 6 }, { key: 'nama', width: 22 }, { key: 'tipe', width: 14 },
        { key: 'status', width: 12 }, { key: 'saldoAwal', width: 18 }, { key: 'saldoSaatIni', width: 18 },
      ];

      ws.mergeCells(1, 1, 1, 6);
      const t = ws.getCell(1, 1);
      t.value = 'DAFTAR DOMPET — CEMILAN TEH RISMA';
      t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, 6);
      const s = ws.getCell(2, 1);
      s.value = `${rows.length} dompet (${label})`;
      s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      s.alignment = { horizontal: 'center', vertical: 'middle' };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const headerRow = ws.getRow(3);
      ['No', 'Nama', 'Tipe', 'Status', 'Saldo Awal', 'Saldo Saat Ini'].forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];

      rows.forEach((w, idx) => {
        const row = ws.getRow(4 + idx);
        row.getCell(1).value = idx + 1;
        row.getCell(2).value = w.name;
        row.getCell(3).value = WALLET_TYPE_LABEL[w.type];
        row.getCell(4).value = w.isActive ? 'Aktif' : 'Nonaktif';
        row.getCell(5).value = w.initialBalance;
        row.getCell(5).numFmt = '"Rp"#,##0';
        row.getCell(6).value = balances[w.id] ?? 0;
        row.getCell(6).numFmt = '"Rp"#,##0';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dompet-${todayISO()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} dompet ke Excel.`);
    } finally { setExporting(false); }
  };

  const exportPdf = async (rows: WalletDoc[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada dompet untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR DOMPET',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '6%', align: 'center' },
              { header: 'Nama', width: '24%', bold: true },
              { header: 'Tipe', width: '15%' },
              { header: 'Status', width: '13%', align: 'center' },
              { header: 'Saldo Awal', width: '21%', align: 'right' },
              { header: 'Saldo Saat Ini', width: '21%', align: 'right', bold: true },
            ],
            rows: rows.map((w, i) => [
              i + 1, w.name, WALLET_TYPE_LABEL[w.type], w.isActive ? 'Aktif' : 'Nonaktif',
              formatRp(w.initialBalance), formatRp(balances[w.id] ?? 0),
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dompet-${todayISO()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} dompet ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally { setExportingPdf(false); }
  };

  // ─── Transfer: CRUD ──────────────────────────────────────────────
  const openNewTransfer = () => { setTransferEditing({ id: '', ...emptyTransferForm() }); setTransferIsNew(true); setTransferError(''); };
  const openEditTransfer = (t: Transfer) => {
    setTransferEditing({ id: t.id, fromWalletId: t.fromWalletId, toWalletId: t.toWalletId, amount: String(t.amount), date: t.date, note: t.note ?? '' });
    setTransferIsNew(false); setTransferError('');
  };
  const closeTransferEdit = () => { setTransferEditing(null); setTransferIsNew(false); setTransferError(''); };

  // Saldo dompet asal yang dipakai untuk validasi tombol — saat edit, tambahkan kembali jumlah
  // transfer lama supaya tidak keblokir oleh kontribusi transfer yang sedang diedit itu sendiri
  // (server melakukan pengecekan yang sama, definitif, lewat computeWalletBalance).
  const transferFromAvailable = (() => {
    if (!transferEditing?.fromWalletId) return 0;
    const base = balances[transferEditing.fromWalletId] ?? 0;
    if (!transferIsNew) {
      const original = transfers.find(t => t.id === transferEditing.id);
      if (original && original.fromWalletId === transferEditing.fromWalletId) return base + original.amount;
    }
    return base;
  })();

  const saveTransfer = async () => {
    if (!transferEditing) return;
    const amountNum = parseFloat(transferEditing.amount) || 0;
    if (!transferEditing.fromWalletId || !transferEditing.toWalletId) { setTransferError('Dompet asal dan tujuan wajib dipilih.'); return; }
    if (transferEditing.fromWalletId === transferEditing.toWalletId) { setTransferError('Dompet asal dan tujuan tidak boleh sama.'); return; }
    if (amountNum <= 0) { setTransferError('Jumlah transfer harus lebih dari 0.'); return; }
    if (amountNum > transferFromAvailable) { setTransferError(`Saldo "${walletName(transferEditing.fromWalletId)}" tidak cukup (saldo saat ini ${formatRp(transferFromAvailable)}).`); return; }
    if (!transferEditing.date) { setTransferError('Tanggal wajib diisi.'); return; }
    setTransferSaving(true); setTransferError('');
    const payload = {
      fromWalletId: transferEditing.fromWalletId, toWalletId: transferEditing.toWalletId,
      amount: amountNum, date: transferEditing.date, note: transferEditing.note,
    };
    const r = transferIsNew
      ? await fetch(`${API}/api/wallet-transfers`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/wallet-transfers/${transferEditing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) {
      await load();
      closeTransferEdit();
      toast.success(transferIsNew ? 'Transfer berhasil dicatat.' : 'Transfer berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setTransferError(d.error ?? 'Gagal menyimpan transfer.');
      toast.error(d.error ?? 'Gagal menyimpan transfer.');
    }
    setTransferSaving(false);
  };

  const delTransfer = async (t: Transfer) => {
    if (!await confirm({
      message: `Hapus transfer ${walletName(t.fromWalletId)} → ${walletName(t.toWalletId)} sebesar ${formatRp(t.amount)}? Tindakan ini tidak bisa dibatalkan.`,
      danger: true,
    })) return;
    setTransferDeletingId(t.id);
    const r = await fetch(`${API}/api/wallet-transfers/${t.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      setTransferSelected(s => { const n = new Set(s); n.delete(t.id); return n; });
      toast.success('Transfer berhasil dihapus.');
    } else {
      toast.error('Gagal menghapus transfer.');
    }
    setTransferDeletingId(null);
  };

  const transferBulkDelete = async () => {
    if (transferSelected.size === 0) return;
    if (!await confirm({ message: `Hapus ${transferSelected.size} transfer yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setTransferBulkDeleting(true);
    const r = await fetch(`${API}/api/wallet-transfers/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...transferSelected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number };
      await load();
      setTransferSelected(new Set());
      toast.success(`${d.deleted} transfer berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus transfer yang dipilih.');
    }
    setTransferBulkDeleting(false);
  };

  const toggleTransferSelect = (id: string) =>
    setTransferSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const transferFiltered = transfers
    .filter(t => !transferSearch
      || walletName(t.fromWalletId).toLowerCase().includes(transferSearch.toLowerCase())
      || walletName(t.toWalletId).toLowerCase().includes(transferSearch.toLowerCase())
      || (t.note ?? '').toLowerCase().includes(transferSearch.toLowerCase()));
  const transferTotalPages = Math.max(1, Math.ceil(transferFiltered.length / transferPageSize));
  const transferSafePage   = Math.min(transferPage, transferTotalPages);
  const transferPaginated  = transferFiltered.slice((transferSafePage - 1) * transferPageSize, transferSafePage * transferPageSize);
  const transferGoPage     = (p: number) => setTransferPage(Math.max(1, Math.min(p, transferTotalPages)));
  const transferResetPage  = () => setTransferPage(1);

  const transferTogglePageAll = () => {
    const pageIds     = transferPaginated.map(t => t.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => transferSelected.has(id));
    setTransferSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const exportTransferExcel = async (rows: Transfer[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada transfer untuk diexport.'); return; }
    setTransferExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Transfer Dompet');
      ws.columns = [
        { key: 'no', width: 6 }, { key: 'tgl', width: 16 }, { key: 'dari', width: 20 },
        { key: 'ke', width: 20 }, { key: 'jml', width: 18 }, { key: 'catatan', width: 32 },
      ];

      ws.mergeCells(1, 1, 1, 6);
      const t = ws.getCell(1, 1);
      t.value = 'RIWAYAT TRANSFER ANTAR DOMPET — CEMILAN TEH RISMA';
      t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, 6);
      const s = ws.getCell(2, 1);
      s.value = `${rows.length} transfer (${label})`;
      s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      s.alignment = { horizontal: 'center', vertical: 'middle' };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const headerRow = ws.getRow(3);
      ['No', 'Tanggal', 'Dari', 'Ke', 'Jumlah', 'Catatan'].forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];

      rows.forEach((t, idx) => {
        const row = ws.getRow(4 + idx);
        row.getCell(1).value = idx + 1;
        row.getCell(2).value = formatDateDisplay(t.date);
        row.getCell(3).value = walletName(t.fromWalletId);
        row.getCell(4).value = walletName(t.toWalletId);
        row.getCell(5).value = t.amount;
        row.getCell(5).numFmt = '"Rp"#,##0';
        row.getCell(6).value = t.note ?? '';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transfer-dompet-${todayISO()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} transfer ke Excel.`);
    } finally { setTransferExporting(false); }
  };

  const exportTransferPdf = async (rows: Transfer[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada transfer untuk diexport.'); return; }
    setTransferExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'TRANSFER ANTAR DOMPET',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '6%', align: 'center' },
              { header: 'Tanggal', width: '16%' },
              { header: 'Dari', width: '19%' },
              { header: 'Ke', width: '19%' },
              { header: 'Jumlah', width: '16%', align: 'right', bold: true },
              { header: 'Catatan', width: '24%' },
            ],
            rows: rows.map((t, i) => [
              i + 1, formatDateDisplay(t.date), walletName(t.fromWalletId), walletName(t.toWalletId), formatRp(t.amount), t.note || '',
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transfer-dompet-${todayISO()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} transfer ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally { setTransferExportingPdf(false); }
  };

  const totalAktif = wallets.filter(w => w.isActive).reduce((s, w) => s + (balances[w.id] ?? 0), 0);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <>
    <TopbarPortal>
      <Tooltip label="Refresh">
        <button onClick={() => load()} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </Tooltip>
    </TopbarPortal>
    <div className="p-4 lg:p-6 space-y-5">

      {/* Ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
            <WalletIcon size={16} />
          </div>
          <div>
            <p className="text-lg font-extrabold tabular leading-none" style={{ color: 'var(--success)' }}>{formatRp(totalAktif)}</p>
            <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Total Saldo Dompet Aktif</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
            <WalletIcon size={16} />
          </div>
          <div>
            <p className="text-lg font-extrabold tabular leading-none" style={{ color: 'var(--text-secondary)' }}>{formatRp(unassigned)}</p>
            <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Belum Ditentukan (transaksi lama)</p>
          </div>
        </div>
      </div>

      {/* Header: search + actions */}
      <div className="flex flex-row items-center gap-2 sm:gap-3">
        {wallets.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari nama atau tipe dompet…"
            />
          </div>
        )}
        <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
          {wallets.length > 0 && (
            <Tooltip label="Export Excel">
              <button onClick={() => exportExcel(filtered, 'sesuai filter')} disabled={exporting} aria-label="Export Excel"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
              </button>
            </Tooltip>
          )}
          {wallets.length > 0 && (
            <Tooltip label="Export PDF">
              <button onClick={() => exportPdf(filtered, 'sesuai filter')} disabled={exportingPdf} aria-label="Export PDF"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
              </button>
            </Tooltip>
          )}
          {wallets.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
          <button onClick={openNewTransfer} className="btn-ghost text-xs" style={{ height: HEADER_BTN_H }} disabled={wallets.filter(w => w.isActive).length < 2}>
            <ArrowRightLeft size={13} /> <span className="hidden sm:inline">Transfer Antar Dompet</span>
          </button>
          <button onClick={openNew} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
            <Plus size={13} /> <span className="hidden sm:inline">Tambah Dompet</span>
          </button>
        </div>
      </div>

      {wallets.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">👛</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada dompet</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Klik &quot;Tambah Dompet&quot; untuk membuat dompet pertama (mis. Kas Tunai, BCA, atau e-wallet).
          </p>
        </div>
      ) : (
        <>
          {paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={paginated.every(w => selected.has(w.id))}
                indeterminate={paginated.some(w => selected.has(w.id)) && !paginated.every(w => selected.has(w.id))}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} dompet di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada dompet yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((w, idx) => {
                const Icon = resolveIcon(w.icon);
                const bankLogo = w.bankName ? bankLogoByName.get(w.bankName.toLowerCase()) : undefined;
                const balance = balances[w.id] ?? 0;
                const isDeleting = deletingId === w.id;
                const isToggling = togglingId === w.id;
                const isSelected = selected.has(w.id);
                const rowNum = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
                return (
                  <div key={w.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, opacity: w.isActive ? 1 : 0.6 }}>
                    <div className="flex items-center gap-2 px-4 py-3.5">
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(w.id)} />
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                        {rowNum}
                      </span>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden p-1.5" style={{ background: bankLogo ? 'var(--surface)' : `${w.color}22`, color: w.color }}>
                        {bankLogo
                          ? /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={bankLogo} alt={w.bankName} className="w-full h-full" style={{ objectFit: 'contain' }} />
                          : <Icon size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{w.name}</p>
                          <span className="badge badge-gray text-[10px]">{WALLET_TYPE_LABEL[w.type]}</span>
                          {!w.isActive && <span className="badge badge-gray text-[10px]">Nonaktif</span>}
                        </div>
                        {w.bankName && (
                          <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{w.bankName}</p>
                        )}
                      </div>
                      <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: balance >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>
                        {formatRp(balance)}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(w)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                            <Pencil size={13} />
                          </button>
                        </Tooltip>
                        <Tooltip label={w.isActive ? 'Nonaktifkan' : 'Aktifkan'}>
                          <button onClick={() => toggleActive(w)} disabled={isToggling} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--text-muted)' }}>
                            {isToggling ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button onClick={() => del(w)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(w => {
                const Icon = resolveIcon(w.icon);
                const bankLogo = w.bankName ? bankLogoByName.get(w.bankName.toLowerCase()) : undefined;
                const balance = balances[w.id] ?? 0;
                const isDeleting = deletingId === w.id;
                const isToggling = togglingId === w.id;
                const isSelected = selected.has(w.id);
                return (
                  <div key={w.id} className="card overflow-hidden relative" style={{ opacity: w.isActive ? 1 : 0.55, outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(w.id)} />
                    </div>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden mb-1 p-2" style={{ background: bankLogo ? 'var(--surface)' : `${w.color}22`, color: w.color }}>
                        {bankLogo
                          ? /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={bankLogo} alt={w.bankName} className="w-full h-full" style={{ objectFit: 'contain' }} />
                          : <Icon size={22} />}
                      </div>
                      <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{w.name}</p>
                      <div className="flex items-center gap-1">
                        <span className="badge badge-gray text-[10px]">{WALLET_TYPE_LABEL[w.type]}</span>
                        {!w.isActive && <span className="badge badge-gray text-[10px]">Nonaktif</span>}
                      </div>
                      {w.bankName && (
                        <p className="text-[11px] truncate max-w-full" style={{ color: 'var(--text-muted)' }}>{w.bankName}</p>
                      )}
                      <p className="text-base font-extrabold tabular mt-1" style={{ color: balance >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>
                        {formatRp(balance)}
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <Tooltip label="Edit">
                        <button onClick={() => openEdit(w)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                          <Pencil size={12} />
                        </button>
                      </Tooltip>
                      <Tooltip label={w.isActive ? 'Nonaktifkan' : 'Aktifkan'}>
                        <button onClick={() => toggleActive(w)} disabled={isToggling} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--text-muted)' }}>
                          {isToggling ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                        </button>
                      </Tooltip>
                      <Tooltip label="Hapus">
                        <button onClick={() => del(w)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                          {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} dompet · halaman {safePage} dari {totalPages}
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

      {/* Bulk action bar — dompet */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportExcel(wallets.filter(w => selected.has(w.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(wallets.filter(w => selected.has(w.id)), 'terpilih')} disabled={exportingPdf}
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

      {/* Riwayat transfer antar dompet */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Riwayat Transfer Antar Dompet</p>

        {transfers.length > 0 && (
          <div className="flex flex-row items-center gap-2 sm:gap-3 mb-3">
            <div className="relative flex-1 min-w-0">
              <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                value={transferSearch}
                onChange={e => { setTransferSearch(e.target.value); transferResetPage(); }}
                className="input text-sm w-full"
                style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                placeholder="Cari dompet asal, tujuan, atau catatan…"
              />
            </div>
            <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
              <Tooltip label="Export Excel">
                <button onClick={() => exportTransferExcel(transferFiltered, 'sesuai filter')} disabled={transferExporting} aria-label="Export Excel"
                  className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {transferExporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                </button>
              </Tooltip>
              <Tooltip label="Export PDF">
                <button onClick={() => exportTransferPdf(transferFiltered, 'sesuai filter')} disabled={transferExportingPdf} aria-label="Export PDF"
                  className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {transferExportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                </button>
              </Tooltip>
              <ViewToggle mode={transferView} onChange={setTransferView} height={HEADER_BTN_H} />
            </div>
          </div>
        )}

        {transfers.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada transfer antar dompet.</p>
          </div>
        ) : (
          <>
            {transferPaginated.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 card mb-3" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                <Checkbox
                  checked={transferPaginated.every(t => transferSelected.has(t.id))}
                  indeterminate={transferPaginated.some(t => transferSelected.has(t.id)) && !transferPaginated.every(t => transferSelected.has(t.id))}
                  onChange={transferTogglePageAll}
                />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {transferSelected.size > 0 ? `${transferSelected.size} dipilih` : `${transferPaginated.length} transfer di halaman ini`}
                </span>
              </div>
            )}

            {transferPaginated.length === 0 ? (
              <div className="card py-8 text-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tidak ada transfer yang cocok.</p>
              </div>
            ) : transferView === 'table' ? (
              <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                {transferPaginated.map((t, idx) => {
                  const isDeleting = transferDeletingId === t.id;
                  const isSelected = transferSelected.has(t.id);
                  const rowNum = (transferSafePage - 1) * (Number.isFinite(transferPageSize) ? transferPageSize : 0) + idx + 1;
                  return (
                    <div key={t.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                      <div className="flex items-center gap-2 px-4 py-3.5">
                        <Checkbox checked={isSelected} onChange={() => toggleTransferSelect(t.id)} />
                        <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                          {rowNum}
                        </span>
                        <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                          <ArrowRightLeft size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {walletName(t.fromWalletId)} → {walletName(t.toWalletId)}
                          </p>
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(t.date)}{t.note ? ` · ${t.note}` : ''}</p>
                        </div>
                        <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{formatRp(t.amount)}</span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Tooltip label="Edit">
                            <button onClick={() => openEditTransfer(t)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                              <Pencil size={13} />
                            </button>
                          </Tooltip>
                          <Tooltip label="Hapus">
                            <button onClick={() => delTransfer(t)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                              {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {transferPaginated.map(t => {
                  const isDeleting = transferDeletingId === t.id;
                  const isSelected = transferSelected.has(t.id);
                  return (
                    <div key={t.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                      <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                        <Checkbox checked={isSelected} onChange={() => toggleTransferSelect(t.id)} />
                      </div>
                      <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                        <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                          <ArrowRightLeft size={20} />
                        </div>
                        <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>
                          {walletName(t.fromWalletId)} → {walletName(t.toWalletId)}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(t.date)}</p>
                        <p className="text-base font-extrabold tabular mt-1" style={{ color: 'var(--text-primary)' }}>{formatRp(t.amount)}</p>
                      </div>
                      <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                        <Tooltip label="Edit">
                          <button onClick={() => openEditTransfer(t)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button onClick={() => delTransfer(t)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {transferFiltered.length > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-2 mt-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {transferFiltered.length} transfer · halaman {transferSafePage} dari {transferTotalPages}
                  </p>
                  <PageSizeSelect value={transferPageSize} onChange={n => { setTransferPageSize(n); transferResetPage(); }} />
                </div>
                {transferTotalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Tooltip label="Halaman sebelumnya">
                      <button onClick={() => transferGoPage(transferSafePage - 1)} disabled={transferSafePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                        <ChevronLeft size={14} />
                      </button>
                    </Tooltip>
                    {Array.from({ length: transferTotalPages }, (_, i) => i + 1)
                      .filter(n => n === 1 || n === transferTotalPages || Math.abs(n - transferSafePage) <= 1)
                      .reduce<(number | '…')[]>((acc, n, i, arr) => {
                        if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                        acc.push(n); return acc;
                      }, [])
                      .map((n, i) =>
                        n === '…'
                          ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                          : <button key={n} onClick={() => transferGoPage(n as number)}
                              className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                              style={transferSafePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                              {n}
                            </button>
                      )
                    }
                    <Tooltip label="Halaman berikutnya">
                      <button onClick={() => transferGoPage(transferSafePage + 1)} disabled={transferSafePage === transferTotalPages} className="btn-ghost p-2 disabled:opacity-30">
                        <ChevronRight size={14} />
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bulk action bar — transfer */}
      {transferSelected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{transferSelected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportTransferExcel(transfers.filter(t => transferSelected.has(t.id)), 'terpilih')} disabled={transferExporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {transferExporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportTransferPdf(transfers.filter(t => transferSelected.has(t.id)), 'terpilih')} disabled={transferExportingPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {transferExportingPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              PDF
            </button>
            <button onClick={transferBulkDelete} disabled={transferBulkDeleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {transferBulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setTransferSelected(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Transfer modal */}
      {transferEditing && (
        <div className="modal-overlay" onClick={closeTransferEdit}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ArrowRightLeft size={17} /></div>
                <div>
                  <p className="modal-title">{transferIsNew ? 'Transfer Antar Dompet' : 'Edit Transfer'}</p>
                  <p className="modal-subtitle">{transferIsNew ? 'Pindahkan saldo dari satu dompet ke dompet lain' : 'Perbarui catatan transfer'}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeTransferEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="field-label">Dari Dompet <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={transferEditing.fromWalletId} onChange={v => setTransferEditing({ ...transferEditing, fromWalletId: v })}
                    options={walletOptions} placeholder="– Pilih Dompet Asal –" searchPlaceholder="Cari dompet…" />
                  {transferEditing.fromWalletId && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Saldo tersedia: {formatRp(transferFromAvailable)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="field-label">Ke Dompet <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={transferEditing.toWalletId} onChange={v => setTransferEditing({ ...transferEditing, toWalletId: v })}
                    options={walletOptions.filter(o => o.value !== transferEditing.fromWalletId)} placeholder="– Pilih Dompet Tujuan –" searchPlaceholder="Cari dompet…" />
                </div>

                <div>
                  <label className="field-label">Tanggal <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="date" value={transferEditing.date} onChange={e => setTransferEditing({ ...transferEditing, date: e.target.value })} className="input" />
                </div>

                <div>
                  <label className="field-label">Jumlah (Rp) <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <NumberInput value={transferEditing.amount} onChange={raw => setTransferEditing({ ...transferEditing, amount: raw })} placeholder="0" />
                </div>

                <div>
                  <label className="field-label">Catatan (opsional)</label>
                  <textarea value={transferEditing.note} onChange={e => setTransferEditing({ ...transferEditing, note: e.target.value })}
                    className="input" style={{ resize: 'vertical', minHeight: 60 }} placeholder="cth: Tarik tunai dari BCA" />
                </div>

                {transferError && (
                  <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {transferError}
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeTransferEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={saveTransfer}
                disabled={transferSaving || !transferEditing.fromWalletId || !transferEditing.toWalletId || (parseFloat(transferEditing.amount) || 0) > transferFromAvailable}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {transferSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {transferSaving ? 'Menyimpan…' : 'Simpan Transfer'}
              </button>
            </div>
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
                <div className="modal-icon"><WalletIcon size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Dompet' : 'Edit Dompet'}</p>
                  <p className="modal-subtitle">{isNew ? 'Buat dompet/sumber dana baru' : `Edit: ${editing.name}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="flex items-center gap-3">
                  <IconPicker value={editing.icon} onChange={icon => setEditing({ ...editing, icon })} />
                  <ColorPicker value={editing.color} onChange={color => setEditing({ ...editing, color })} />
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Nama Dompet <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                      className="input" placeholder="cth: Kas Tunai, BCA, OVO" autoFocus />
                  </div>
                </div>

                <div>
                  <label className="field-label">Tipe</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {WALLET_TYPES.map(t => (
                      <button key={t} type="button" onClick={() => setEditing({ ...editing, type: t })}
                        className="flex-1 px-2 py-2.5 text-xs font-bold transition-all"
                        style={editing.type === t ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {WALLET_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </div>

                {editing.type === 'bank' && (
                  <div>
                    <label className="field-label">Bank</label>
                    <SearchSelect
                      value={editing.bankName}
                      onChange={v => setEditing({ ...editing, bankName: v })}
                      options={bankOptions.map(b => ({ value: b.name, label: b.name, sublabel: b.bankCode ? `Kode: ${b.bankCode}` : undefined, imageUrl: b.logoUrl }))}
                      placeholder="– Pilih bank –"
                      searchPlaceholder="Cari bank…"
                    />
                  </div>
                )}

                <div>
                  <label className="field-label">Saldo Awal (Rp)</label>
                  <NumberInput value={editing.initialBalance} onChange={raw => setEditing({ ...editing, initialBalance: raw })} placeholder="0" />
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
                {saving ? 'Menyimpan…' : 'Simpan Dompet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
