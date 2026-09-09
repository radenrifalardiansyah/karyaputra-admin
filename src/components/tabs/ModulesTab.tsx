'use client';

import { useEffect, useState } from 'react';
import {
  Blocks, Plus, Pencil, Trash2, X, Check, Loader2, ChevronUp, ChevronDown, EyeOff,
  Search, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import IconPicker from '@/components/IconPicker';
import { resolveIcon } from '@/lib/icon-registry';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import type { ModuleDoc, Action } from '@/types/rbac';

const HEADER_BTN_H = 34;

interface EditState { id: string; name: string; icon: string; isActive: boolean }
const EMPTY: EditState = { id: '', name: '', icon: 'Blocks', isActive: true };

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function Checkbox({ checked, indeterminate, disabled, onChange }: {
  checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: () => void;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); if (!disabled) onChange(); }}
      disabled={disabled}
      className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors disabled:opacity-30"
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

interface ModulesTabProps { creds: string; can: (action: Action) => boolean; onChanged?: () => void }

export default function ModulesTab({ creds, can, onChanged }: ModulesTabProps) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);

  const [modules, setModules] = useState<ModuleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('modules');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [editing,    setEditing]    = useState<EditState | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const r = await fetch('/api/modules', { headers });
    if (r.ok) setModules((await r.json() as { modules: ModuleDoc[] }).modules.sort((a, b) => a.order - b.order));
    if (!silent) setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew   = () => { setEditing({ ...EMPTY }); setIsNew(true); setError(''); };
  const openEdit  = (m: ModuleDoc) => { setEditing({ id: m.id, name: m.name, icon: m.icon, isActive: m.isActive }); setIsNew(false); setError(''); };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Nama modul wajib diisi.'); return; }
    setSaving(true); setError('');

    const r = isNew
      ? await fetch('/api/modules', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editing.id ? slugify(editing.id) : slugify(editing.name), name: editing.name, icon: editing.icon }),
        })
      : await fetch(`/api/modules/${editing.id}`, {
          method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editing.name, icon: editing.icon, isActive: editing.isActive }),
        });

    if (r.ok) {
      await load(true);
      onChanged?.();
      closeEdit();
      toast.success(isNew ? 'Modul berhasil ditambahkan.' : 'Modul berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal menyimpan modul.');
    }
    setSaving(false);
  };

  const del = async (m: ModuleDoc) => {
    if (!await confirm({ message: `Hapus modul "${m.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(m.id);
    const r = await fetch(`/api/modules/${m.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load(true);
      onChanged?.();
      setSelected(s => { const n = new Set(s); n.delete(m.id); return n; });
      toast.success(`Modul "${m.name}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus modul.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} modul yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const r = await fetch('/api/modules/bulk-delete', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number; skippedInUse: number };
      await load(true);
      onChanged?.();
      setSelected(new Set());
      const extra = d.skippedInUse > 0 ? ` (${d.skippedInUse} modul masih memiliki menu, dilewati)` : '';
      toast.success(`${d.deleted} modul berhasil dihapus.${extra}`);
    } else {
      toast.error('Gagal menghapus modul yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportExcel = async (rows: ModuleDoc[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada modul untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Modul');

      const COLS = [
        { header: 'No',      key: 'no',     width: 6  },
        { header: 'Urutan',  key: 'order',  width: 10 },
        { header: 'Nama',    key: 'name',   width: 24 },
        { header: 'ID',      key: 'id',     width: 20 },
        { header: 'Ikon',    key: 'icon',   width: 16 },
        { header: 'Status',  key: 'status', width: 14 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN MODUL — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} modul (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((m, i) => {
        const row = ws.addRow({
          no: i + 1, order: m.order + 1, name: m.name, id: m.id, icon: m.icon,
          status: m.isActive ? 'Aktif' : 'Nonaktif',
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
        row.getCell('no').alignment     = { horizontal: 'center', vertical: 'middle' };
        row.getCell('order').alignment  = { horizontal: 'center', vertical: 'middle' };
        row.getCell('status').alignment = { horizontal: 'center', vertical: 'middle' };
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
      a.download = `modul-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} modul (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (rows: ModuleDoc[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada modul untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR MODUL',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '6%', align: 'center' },
              { header: 'Urutan', width: '10%', align: 'center' },
              { header: 'Nama', width: '26%', bold: true },
              { header: 'ID', width: '24%' },
              { header: 'Ikon', width: '18%' },
              { header: 'Status', width: '16%', align: 'center' },
            ],
            rows: rows.map((m, i) => [i + 1, m.order + 1, m.name, m.id, m.icon, m.isActive ? 'Aktif' : 'Nonaktif']),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `modul-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} modul (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const filtered = modules.filter(m => !search
    || m.name.toLowerCase().includes(search.toLowerCase())
    || m.id.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  // Reordering swaps entries by position in the *full* order — locking it
  // whenever search or pagination hides part of that order keeps the
  // up/down arrows from silently producing a wrong sequence.
  const reorderLocked = search.trim() !== '' || totalPages > 1;

  const move = async (m: ModuleDoc, dir: -1 | 1) => {
    const idx    = modules.findIndex(x => x.id === m.id);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= modules.length) return;
    const next = modules.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setModules(next);
    setReordering(true);
    await fetch('/api/modules/reorder', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: next.map((mm, i) => ({ id: mm.id, order: i })) }),
    });
    onChanged?.();
    setReordering(false);
  };

  const togglePageAll = () => {
    const ids = paginated.map(m => m.id);
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) ids.forEach(id => n.delete(id));
      else             ids.forEach(id => n.add(id));
      return n;
    });
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Header: search + actions in one row */}
      <div className="flex flex-row items-center gap-2 sm:gap-3">
        {modules.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari nama atau ID modul…"
            />
          </div>
        )}
        <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
          {modules.length > 0 && (
            <Tooltip label="Export Excel">
              <button onClick={() => exportExcel(filtered, 'sesuai filter')} disabled={exporting} aria-label="Export Excel"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
              </button>
            </Tooltip>
          )}
          {modules.length > 0 && (
            <Tooltip label="Export PDF">
              <button onClick={() => exportPdf(filtered, 'sesuai filter')} disabled={exportingPdf} aria-label="Export PDF"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
              </button>
            </Tooltip>
          )}
          {modules.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
          {can('create') && (
            <button onClick={openNew} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
              <Plus size={13} /> <span className="hidden sm:inline">Tambah Modul</span>
            </button>
          )}
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Urutan menentukan posisi grup di sidebar.
        {reorderLocked && ' Kosongkan pencarian & tampilkan "Semua" pada ukuran halaman untuk mengubah urutan.'}
      </p>

      {modules.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🧩</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada modul</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik &quot;Tambah Modul&quot; untuk membuat grup menu baru.</p>
        </div>
      ) : (
        <>
          {/* Select-all bar */}
          {can('delete') && paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={paginated.every(m => selected.has(m.id))}
                indeterminate={paginated.some(m => selected.has(m.id)) && !paginated.every(m => selected.has(m.id))}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} modul di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada modul yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((m, idx) => {
                const Icon = resolveIcon(m.icon);
                const isDeleting = deletingId === m.id;
                const isSelected = selected.has(m.id);
                return (
                  <div key={m.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, opacity: m.isActive ? 1 : 0.55, transition: 'background 0.1s' }}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      {can('delete') && <Checkbox checked={isSelected} onChange={() => toggleSelect(m.id)} />}
                      <span className="flex-shrink-0 text-center text-[10px] font-bold tabular-nums" style={{ minWidth: 18, color: 'var(--text-muted)' }}>
                        {m.order + 1}
                      </span>
                      <div className="flex flex-col flex-shrink-0">
                        <Tooltip label={reorderLocked ? 'Kosongkan pencarian & filter halaman untuk mengubah urutan' : 'Naikkan'}>
                          <button onClick={() => move(m, -1)} disabled={reorderLocked || reordering || modules.findIndex(x => x.id === m.id) === 0} className="btn-ghost p-0.5 disabled:opacity-20">
                            <ChevronUp size={13} />
                          </button>
                        </Tooltip>
                        <Tooltip label={reorderLocked ? 'Kosongkan pencarian & filter halaman untuk mengubah urutan' : 'Turunkan'}>
                          <button onClick={() => move(m, 1)} disabled={reorderLocked || reordering || modules.findIndex(x => x.id === m.id) === modules.length - 1} className="btn-ghost p-0.5 disabled:opacity-20">
                            <ChevronDown size={13} />
                          </button>
                        </Tooltip>
                      </div>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                          {m.name}
                          {!m.isActive && <span className="badge badge-gray flex items-center gap-1"><EyeOff size={10} /> Nonaktif</span>}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{m.id}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {can('edit') && (
                          <Tooltip label="Edit">
                            <button onClick={() => openEdit(m)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                              <Pencil size={13} />
                            </button>
                          </Tooltip>
                        )}
                        {can('delete') && (
                          <Tooltip label="Hapus">
                            <button onClick={() => del(m)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                              {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(m => {
                const Icon = resolveIcon(m.icon);
                const isDeleting = deletingId === m.id;
                const isSelected = selected.has(m.id);
                return (
                  <div key={m.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2, opacity: m.isActive ? 1 : 0.55 }}>
                    {can('delete') && (
                      <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                        <Checkbox checked={isSelected} onChange={() => toggleSelect(m.id)} />
                      </div>
                    )}
                    <span className="absolute top-3 right-3 text-[10px] font-bold tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      #{m.order + 1}
                    </span>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        <Icon size={20} />
                      </div>
                      <p className="text-sm font-bold truncate max-w-full flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        {m.name}
                        {!m.isActive && <span className="badge badge-gray flex items-center gap-1"><EyeOff size={10} /> Nonaktif</span>}
                      </p>
                      <p className="text-xs truncate max-w-full" style={{ color: 'var(--text-muted)' }}>{m.id}</p>
                    </div>
                    <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <Tooltip label={reorderLocked ? 'Kosongkan pencarian & filter halaman untuk mengubah urutan' : 'Naikkan'}>
                        <button onClick={() => move(m, -1)} disabled={reorderLocked || reordering || modules.findIndex(x => x.id === m.id) === 0} className="btn-ghost p-1.5 disabled:opacity-20">
                          <ChevronUp size={12} />
                        </button>
                      </Tooltip>
                      <Tooltip label={reorderLocked ? 'Kosongkan pencarian & filter halaman untuk mengubah urutan' : 'Turunkan'}>
                        <button onClick={() => move(m, 1)} disabled={reorderLocked || reordering || modules.findIndex(x => x.id === m.id) === modules.length - 1} className="btn-ghost p-1.5 disabled:opacity-20">
                          <ChevronDown size={12} />
                        </button>
                      </Tooltip>
                      {can('edit') && (
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(m)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                      )}
                      {can('delete') && (
                        <Tooltip label="Hapus">
                          <button onClick={() => del(m)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </Tooltip>
                      )}
                    </div>
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
                  {filtered.length} modul · halaman {safePage} dari {totalPages}
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
      {can('delete') && selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportExcel(modules.filter(m => selected.has(m.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(modules.filter(m => selected.has(m.id)), 'terpilih')} disabled={exportingPdf}
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

      {editing && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Blocks size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Modul' : 'Edit Modul'}</p>
                  <p className="modal-subtitle">{isNew ? 'Buat grup menu baru' : `Edit: ${editing.name}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="flex items-center gap-3">
                  <IconPicker value={editing.icon} onChange={icon => setEditing({ ...editing, icon })} />
                  <div className="flex-1">
                    <label className="field-label">Nama Modul <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                      className="input" placeholder="cth: Users" autoFocus />
                  </div>
                </div>
                {isNew && (
                  <div>
                    <label className="field-label">ID (opsional, huruf kecil & tanda hubung)</label>
                    <input value={editing.id} onChange={e => setEditing({ ...editing, id: e.target.value })}
                      className="input" placeholder={slugify(editing.name) || 'otomatis dari nama'} />
                  </div>
                )}
                {!isNew && (
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} className="w-4 h-4" />
                    <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Tampilkan modul ini di sidebar</span>
                  </label>
                )}
                {error && (
                  <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={save} disabled={saving || !editing.name.trim()}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Modul'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
