'use client';

import { useEffect, useState } from 'react';
import {
  IdCard, Plus, Pencil, Trash2, X, Check, Loader2, Lock, Search,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import PageSizeSelect from '@/components/PageSizeSelect';
import type { Role, Action } from '@/types/rbac';

const HEADER_BTN_H = 34;

interface EditState { id: string; name: string; description: string }
const EMPTY: EditState = { id: '', name: '', description: '' };

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function formatDate(r: Role) {
  const c = r.createdAt as { seconds?: number } | undefined;
  if (c?.seconds) return new Date(c.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return '–';
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

interface RolesTabProps { creds: string; can: (action: Action) => boolean }

export default function RolesTab({ creds, can }: RolesTabProps) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);

  const [roles,   setRoles]   = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('roles');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [editing,    setEditing]    = useState<EditState | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/roles', { headers });
    if (r.ok) setRoles((await r.json() as { roles: Role[] }).roles);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew   = () => { setEditing({ ...EMPTY }); setIsNew(true); setError(''); };
  const openEdit  = (r: Role) => { setEditing({ id: r.id, name: r.name, description: r.description ?? '' }); setIsNew(false); setError(''); };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Nama role wajib diisi.'); return; }
    setSaving(true); setError('');

    const r = isNew
      ? await fetch('/api/roles', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: slugify(editing.id || editing.name), name: editing.name, description: editing.description }),
        })
      : await fetch(`/api/roles/${editing.id}`, {
          method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editing.name, description: editing.description }),
        });

    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Role berhasil ditambahkan.' : 'Role berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal menyimpan role.');
    }
    setSaving(false);
  };

  const del = async (role: Role) => {
    if (!await confirm({ message: `Hapus role "${role.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(role.id);
    const r = await fetch(`/api/roles/${role.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      setSelected(s => { const n = new Set(s); n.delete(role.id); return n; });
      toast.success(`Role "${role.name}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus role.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} role yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const r = await fetch('/api/roles/bulk-delete', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number; skippedSystem: number; skippedInUse: number };
      await load();
      setSelected(new Set());
      const extra = [
        d.skippedSystem > 0 ? `${d.skippedSystem} role sistem dilewati` : '',
        d.skippedInUse  > 0 ? `${d.skippedInUse} role masih digunakan dilewati` : '',
      ].filter(Boolean).join(', ');
      toast.success(`${d.deleted} role berhasil dihapus.${extra ? ` (${extra})` : ''}`);
    } else {
      toast.error('Gagal menghapus role yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportExcel = async (rows: Role[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada role untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Role');

      const COLS = [
        { header: 'No',        key: 'no',          width: 6  },
        { header: 'Nama',      key: 'name',        width: 24 },
        { header: 'ID',        key: 'id',          width: 20 },
        { header: 'Deskripsi', key: 'description', width: 34 },
        { header: 'Sistem',    key: 'system',      width: 10 },
        { header: 'Dibuat',    key: 'joined',      width: 16 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN ROLE — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} role (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((r, i) => {
        const row = ws.addRow({
          no: i + 1, name: r.name, id: r.id, description: r.description || '-',
          system: r.isSystem ? 'Ya' : 'Tidak', joined: formatDate(r),
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
        row.getCell('no').alignment          = { horizontal: 'center', vertical: 'middle' };
        row.getCell('system').alignment      = { horizontal: 'center', vertical: 'middle' };
        row.getCell('description').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
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
      a.download = `role-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} role (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (rows: Role[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada role untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR ROLE',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '5%', align: 'center' },
              { header: 'Nama', width: '18%', bold: true },
              { header: 'ID', width: '16%' },
              { header: 'Deskripsi', width: '35%' },
              { header: 'Sistem', width: '10%', align: 'center' },
              { header: 'Dibuat', width: '16%' },
            ],
            rows: rows.map((r, i) => [i + 1, r.name, r.id, r.description || '-', r.isSystem ? 'Ya' : 'Tidak', formatDate(r)]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `role-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} role (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const filtered = roles.filter(r => !search
    || r.name.toLowerCase().includes(search.toLowerCase())
    || r.id.toLowerCase().includes(search.toLowerCase())
    || (r.description ?? '').toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const selectablePage = paginated.filter(r => !r.isSystem);
  const togglePageAll = () => {
    const ids = selectablePage.map(r => r.id);
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
        {roles.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari nama, ID, atau deskripsi…"
            />
          </div>
        )}
        <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
          {roles.length > 0 && (
            <Tooltip label="Export Excel">
              <button onClick={() => exportExcel(filtered, 'sesuai filter')} disabled={exporting} aria-label="Export Excel"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
              </button>
            </Tooltip>
          )}
          {roles.length > 0 && (
            <Tooltip label="Export PDF">
              <button onClick={() => exportPdf(filtered, 'sesuai filter')} disabled={exportingPdf} aria-label="Export PDF"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
              </button>
            </Tooltip>
          )}
          {roles.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
          {can('create') && (
            <button onClick={openNew} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
              <Plus size={13} /> <span className="hidden sm:inline">Tambah Role</span>
            </button>
          )}
        </div>
      </div>

      {roles.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🪪</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada role</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik &quot;Tambah Role&quot; untuk membuat role baru.</p>
        </div>
      ) : (
        <>
          {/* Select-all bar */}
          {can('delete') && paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={selectablePage.length > 0 && selectablePage.every(r => selected.has(r.id))}
                indeterminate={selectablePage.some(r => selected.has(r.id)) && !selectablePage.every(r => selected.has(r.id))}
                disabled={selectablePage.length === 0}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} role di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada role yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((r, idx) => {
                const isDeleting = deletingId === r.id;
                const isSystem   = !!r.isSystem;
                const isSelected = selected.has(r.id);
                const rowNum     = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
                return (
                  <div key={r.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, transition: 'background 0.1s' }}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      {can('delete') && (
                        <Tooltip label={isSystem ? 'Role sistem tidak dapat dihapus' : (isSelected ? 'Batalkan pilihan' : 'Pilih')}>
                          <span><Checkbox checked={isSelected} disabled={isSystem} onChange={() => toggleSelect(r.id)} /></span>
                        </Tooltip>
                      )}
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                        {rowNum}
                      </span>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {isSystem ? <Lock size={16} /> : <IdCard size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                          {r.name}
                          {isSystem && <span className="badge badge-gray">Sistem</span>}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{r.description || r.id}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {can('edit') && (
                          <Tooltip label={isSystem ? 'Role sistem tidak dapat diubah' : 'Edit'}>
                            <button onClick={() => openEdit(r)} disabled={isSystem} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--accent)' }}>
                              <Pencil size={13} />
                            </button>
                          </Tooltip>
                        )}
                        {can('delete') && (
                          <Tooltip label={isSystem ? 'Role sistem tidak dapat dihapus' : 'Hapus'}>
                            <button onClick={() => del(r)} disabled={isDeleting || isSystem} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
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
              {paginated.map(r => {
                const isDeleting = deletingId === r.id;
                const isSystem   = !!r.isSystem;
                const isSelected = selected.has(r.id);
                return (
                  <div key={r.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    {can('delete') && (
                      <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                        <Checkbox checked={isSelected} disabled={isSystem} onChange={() => toggleSelect(r.id)} />
                      </div>
                    )}
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {isSystem ? <Lock size={20} /> : <IdCard size={20} />}
                      </div>
                      <p className="text-sm font-bold truncate max-w-full flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        {r.name}
                        {isSystem && <span className="badge badge-gray">Sistem</span>}
                      </p>
                      <p className="text-xs truncate max-w-full" style={{ color: 'var(--text-muted)' }}>{r.description || r.id}</p>
                    </div>
                    <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      {can('edit') && (
                        <Tooltip label={isSystem ? 'Role sistem tidak dapat diubah' : 'Edit'}>
                          <button onClick={() => openEdit(r)} disabled={isSystem} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--accent)' }}>
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                      )}
                      {can('delete') && (
                        <Tooltip label={isSystem ? 'Role sistem tidak dapat dihapus' : 'Hapus'}>
                          <button onClick={() => del(r)} disabled={isDeleting || isSystem} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
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
                  {filtered.length} role · halaman {safePage} dari {totalPages}
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
            <button onClick={() => exportExcel(roles.filter(r => selected.has(r.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(roles.filter(r => selected.has(r.id)), 'terpilih')} disabled={exportingPdf}
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
                <div className="modal-icon"><IdCard size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Role' : 'Edit Role'}</p>
                  <p className="modal-subtitle">{isNew ? 'Buat role baru' : `Edit: ${editing.name}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="field-label">Nama Role <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                    className="input" placeholder="cth: Supervisor Gudang" autoFocus />
                </div>
                {isNew && (
                  <div>
                    <label className="field-label">ID (opsional, huruf kecil & tanda hubung)</label>
                    <input value={editing.id} onChange={e => setEditing({ ...editing, id: e.target.value })}
                      className="input" placeholder={slugify(editing.name) || 'otomatis dari nama'} />
                  </div>
                )}
                <div>
                  <label className="field-label">Deskripsi (opsional)</label>
                  <textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}
                    className="input" style={{ resize: 'vertical', minHeight: 70 }} placeholder="Deskripsi singkat tentang role ini" />
                </div>
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
                {saving ? 'Menyimpan…' : 'Simpan Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
