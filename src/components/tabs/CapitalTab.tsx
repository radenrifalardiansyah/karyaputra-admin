'use client';

import { useState, useEffect } from 'react';
import {
  Landmark, Plus, Pencil, Trash2, X, Check, Loader2, Search,
  ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle,
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
import NumberInput from '@/components/NumberInput';
import SearchSelect from '@/components/SearchSelect';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { RecordHistoryButton, RecordHistoryPanel } from '@/components/RecordHistory';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';

const API = '';
const HEADER_BTN_H = 34;

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

interface CapitalEntry {
  id: string; type: 'modal' | 'prive'; amount: number; date: string; note: string;
  createdAt?: { seconds: number };
  walletId?: string | null;
}

type EntryForm = { type: 'modal' | 'prive'; amount: string; date: string; note: string; walletId: string };
const emptyForm = (): EntryForm => ({ type: 'modal', amount: '', date: todayISO(), note: '', walletId: '' });

export default function CapitalTab({ creds }: { creds: string }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);
  const wallets = useWallets(creds);
  const [walletBalances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

  const [entries,     setEntries]     = useState<CapitalEntry[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [historyId,  setHistoryId]  = useState<string | null>(null);
  const toggleHistory = (id: string) => setHistoryId(cur => cur === id ? null : id);
  const [search,      setSearch]      = useState('');
  const [typeFilter,  setTypeFilter]  = useState<'semua' | 'modal' | 'prive'>('semua');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('capital');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [editing,    setEditing]    = useState<{ id: string } & EntryForm | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');
  const [exporting,  setExporting]  = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/capital`, { headers });
    if (r.ok) { const { entries: e } = await r.json() as { entries: CapitalEntry[] }; setEntries(e); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditing({ id: '', ...emptyForm() }); setIsNew(true); setError(''); };
  const openEdit = (e: CapitalEntry) => {
    setEditing({ id: e.id, type: e.type, amount: String(e.amount), date: e.date, note: e.note, walletId: e.walletId ?? '' });
    setIsNew(false); setError('');
  };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    const amountNum = parseFloat(editing.amount) || 0;
    if (amountNum <= 0) { setError('Jumlah harus lebih dari 0.'); return; }
    if (!editing.date) { setError('Tanggal wajib diisi.'); return; }
    if (!editing.walletId) { setError('Dompet wajib dipilih.'); return; }
    setSaving(true); setError('');
    const payload = { type: editing.type, amount: amountNum, date: editing.date, note: editing.note, walletId: editing.walletId };
    const r = isNew
      ? await fetch(`${API}/api/capital`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/capital/${editing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) {
      await load();
      refetchBalances();
      closeEdit();
      toast.success(isNew ? 'Tercatat.' : 'Berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      const msg = d.error ?? 'Gagal menyimpan.';
      toast.error(msg);
      setError(msg);
    }
    setSaving(false);
  };

  const del = async (id: string) => {
    if (!await confirm({ message: 'Hapus catatan ini? Tindakan ini tidak bisa dibatalkan.', danger: true })) return;
    setDeletingId(id);
    const r = await fetch(`${API}/api/capital/${id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      refetchBalances();
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      toast.success('Berhasil dihapus.');
    } else {
      toast.error('Gagal menghapus.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} catatan yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const count = selected.size;
    const r = await fetch(`${API}/api/capital/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      setEntries(es => es.filter(e => !selected.has(e.id)));
      refetchBalances();
      setSelected(new Set());
      toast.success(`${count} catatan berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Ringkasan ─────────────────────────────────────
  const totalModal = entries.filter(e => e.type === 'modal').reduce((s, e) => s + e.amount, 0);
  const totalPrive = entries.filter(e => e.type === 'prive').reduce((s, e) => s + e.amount, 0);
  const saldoModal = totalModal - totalPrive;

  const filtered = entries
    .filter(e => {
      const matchType = typeFilter === 'semua' || e.type === typeFilter;
      const matchQ = !search || (e.note ?? '').toLowerCase().includes(search.toLowerCase());
      return matchType && matchQ;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const togglePageAll = () => {
    const pageIds     = paginated.map(e => e.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const exportExcel = async (rows: CapitalEntry[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada catatan untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Modal & Prive');
      ws.columns = [
        { key: 'tgl', width: 16 }, { key: 'tipe', width: 16 }, { key: 'jml', width: 18 }, { key: 'catatan', width: 36 },
      ];

      ws.mergeCells(1, 1, 1, 4);
      const t = ws.getCell(1, 1);
      t.value = 'DAFTAR MODAL & PRIVE — CEMILAN TEH RISMA';
      t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, 4);
      const s = ws.getCell(2, 1);
      s.value = `${rows.length} catatan (${label})`;
      s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      s.alignment = { horizontal: 'center', vertical: 'middle' };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const headerRow = ws.getRow(3);
      ['Tanggal', 'Tipe', 'Jumlah', 'Catatan'].forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];

      rows.forEach((e, i) => {
        const rowNum = 4 + i;
        const row = ws.getRow(rowNum);
        row.getCell(1).value = formatDateDisplay(e.date);
        row.getCell(2).value = e.type === 'modal' ? 'Modal Masuk' : 'Prive Pemilik';
        row.getCell(3).value = e.amount;
        row.getCell(3).numFmt = '"Rp"#,##0';
        row.getCell(4).value = e.note ?? '';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `modal-prive-${todayISO()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} catatan ke Excel.`);
    } finally { setExporting(false); }
  };

  const exportPdf = async (rows: CapitalEntry[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada catatan untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'MODAL & PRIVE',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'Tanggal', width: '16%' },
              { header: 'Tipe', width: '18%' },
              { header: 'Jumlah', width: '18%', align: 'right', bold: true },
              { header: 'Catatan', width: '48%' },
            ],
            rows: rows.map(e => [
              formatDateDisplay(e.date), e.type === 'modal' ? 'Modal Masuk' : 'Prive Pemilik', formatRp(e.amount), e.note || '',
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `modal-prive-${todayISO()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} catatan ke PDF.`);
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
          { icon: <ArrowUpCircle   size={16} />, label: 'Total Modal Masuk', val: totalModal, color: 'var(--success)', bg: 'var(--success-bg)' },
          { icon: <ArrowDownCircle size={16} />, label: 'Total Prive',       val: totalPrive, color: 'var(--danger)',  bg: 'var(--danger-bg)' },
          { icon: <Landmark       size={16} />, label: 'Saldo Modal Bersih', val: saldoModal, color: 'var(--accent)',  bg: 'var(--accent-bg)' },
        ].map((c, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: c.bg, color: c.color }}>
              {c.icon}
            </div>
            <div>
              <p className="text-lg font-extrabold tabular leading-none" style={{ color: c.color }}>{formatRp(c.val)}</p>
              <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs -mt-2" style={{ color: 'var(--text-muted)' }}>
        Modal & Prive tidak masuk hitungan Laba Rugi operasional di Laporan Keuangan — ini murni keluar-masuk uang pribadi ke usaha.
      </p>

      {/* Header: search + actions in one row */}
      {entries.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-full sm:w-[180px] flex-shrink-0">
            <FilterSelect
              value={typeFilter}
              onChange={v => { setTypeFilter(v as 'semua' | 'modal' | 'prive'); resetPage(); }}
              height={HEADER_BTN_H}
              searchPlaceholder="Cari tipe…"
              options={[{ value: 'semua', label: 'Semua Tipe' }, { value: 'modal', label: 'Modal Masuk' }, { value: 'prive', label: 'Prive' }]}
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
                placeholder="Cari catatan…"
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
                <Plus size={13} /> <span className="hidden sm:inline">Catat Modal/Prive</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
            <Landmark size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada catatan Modal/Prive</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            Klik &quot;Catat Modal/Prive&quot; kalau ada suntikan modal atau pengambilan uang pribadi dari usaha.
          </p>
          <button onClick={openNew} className="btn-primary mx-auto px-5 py-2.5 text-sm">
            <Plus size={14} /> Catat Modal/Prive Pertama
          </button>
        </div>
      ) : (
        <>
          {paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={paginated.every(e => selected.has(e.id))}
                indeterminate={paginated.some(e => selected.has(e.id)) && !paginated.every(e => selected.has(e.id))}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} catatan di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada catatan yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((e, idx) => {
                const isDeleting = deletingId === e.id;
                const isSelected = selected.has(e.id);
                const isModal = e.type === 'modal';
                return (
                  <div key={e.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, transition: 'background 0.1s' }}>
                    <div className="flex items-center gap-2 px-4 py-3.5">
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(e.id)} />
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: isModal ? 'var(--success-bg)' : 'var(--danger-bg)', color: isModal ? 'var(--success)' : 'var(--danger)' }}>
                        {isModal ? <ArrowUpCircle size={16} /> : <ArrowDownCircle size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{isModal ? 'Modal Masuk' : 'Prive Pemilik'}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(e.date, e.createdAt)}</p>
                      </div>
                      <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: isModal ? 'var(--success)' : 'var(--danger)' }}>
                        {isModal ? '+' : '−'}{formatRp(e.amount)}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(e)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                            <Pencil size={13} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button onClick={() => del(e.id)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </Tooltip>
                        {e.note && (
                          <Tooltip label="Lihat catatan">
                            <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)} className="btn-ghost p-2">
                              <ChevronRight size={13} style={{ transform: expandedId === e.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                            </button>
                          </Tooltip>
                        )}
                        <RecordHistoryButton open={historyId === e.id} onToggle={() => toggleHistory(e.id)} />
                      </div>
                    </div>
                    {expandedId === e.id && e.note && (
                      <div className="px-4 pb-4 pt-1" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{e.note}</p>
                      </div>
                    )}
                    {historyId === e.id && <RecordHistoryPanel creds={creds} entity="capital" entityId={e.id} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(e => {
                const isDeleting = deletingId === e.id;
                const isSelected = selected.has(e.id);
                const isModal = e.type === 'modal';
                return (
                  <div key={e.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(e.id)} />
                    </div>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: isModal ? 'var(--success-bg)' : 'var(--danger-bg)', color: isModal ? 'var(--success)' : 'var(--danger)' }}>
                        {isModal ? <ArrowUpCircle size={20} /> : <ArrowDownCircle size={20} />}
                      </div>
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{isModal ? 'Modal Masuk' : 'Prive Pemilik'}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(e.date, e.createdAt)}</p>
                      <p className="text-base font-extrabold tabular mt-1" style={{ color: isModal ? 'var(--success)' : 'var(--danger)' }}>
                        {isModal ? '+' : '−'}{formatRp(e.amount)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      {e.note ? (
                        <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)} className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                          Catatan <ChevronRight size={12} style={{ transform: expandedId === e.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                        </button>
                      ) : <span />}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(e)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button onClick={() => del(e.id)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </Tooltip>
                        <RecordHistoryButton open={historyId === e.id} onToggle={() => toggleHistory(e.id)} />
                      </div>
                    </div>
                    {expandedId === e.id && e.note && (
                      <div className="px-4 pb-4 pt-1" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{e.note}</p>
                      </div>
                    )}
                    {historyId === e.id && <RecordHistoryPanel creds={creds} entity="capital" entityId={e.id} />}
                  </div>
                );
              })}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} catatan · halaman {safePage} dari {totalPages}
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
            <button onClick={() => exportExcel(entries.filter(e => selected.has(e.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(entries.filter(e => selected.has(e.id)), 'terpilih')} disabled={exportingPdf}
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
                <div className="modal-icon"><Landmark size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Catat Modal/Prive' : 'Edit Catatan'}</p>
                  <p className="modal-subtitle">{isNew ? 'Simpan uang masuk/keluar pribadi ke usaha' : 'Perbarui catatan'}</p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={closeEdit} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="field-label">Tipe</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['modal', 'prive'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setEditing({ ...editing, type: t })}
                        className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                        style={editing.type === t ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {t === 'modal' ? 'Modal Masuk' : 'Prive Pemilik'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="field-label">Tanggal <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} className="input" />
                </div>

                <div>
                  <label className="field-label">Dompet <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={editing.walletId} onChange={v => setEditing({ ...editing, walletId: v })}
                    options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                  {editing.type === 'prive' && editing.walletId && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Saldo saat ini: {formatRp(walletBalances[editing.walletId] ?? 0)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="field-label">Jumlah (Rp) <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <NumberInput value={editing.amount} onChange={raw => setEditing({ ...editing, amount: raw })}
                    placeholder="0" autoFocus />
                </div>

                <div>
                  <label className="field-label">Catatan (opsional)</label>
                  <textarea value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })}
                    className="input" style={{ resize: 'vertical', minHeight: 70 }} placeholder="cth: Setor modal awal usaha" />
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
                {saving ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
