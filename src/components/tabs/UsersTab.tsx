'use client';

import { useEffect, useState } from 'react';
import {
  ShieldCheck, Plus, Pencil, Trash2, X, Check, Loader2, Eye, EyeOff, Search,
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
import SearchableSelect from '@/components/SearchableSelect';
import type { Role, Action } from '@/types/rbac';

const HEADER_BTN_H = 34;

interface AppUser {
  username: string; email: string | null; role: string; createdAt?: { seconds: number };
}

interface EditState {
  username: string; email: string; role: string; password: string;
}

const EMPTY: EditState = { username: '', email: '', role: '', password: '' };

function formatDate(u: AppUser) {
  if (u.createdAt?.seconds) return new Date(u.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
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

interface UsersTabProps { creds: string; currentUsername: string; can: (action: Action) => boolean }

export default function UsersTab({ creds, currentUsername, can }: UsersTabProps) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);

  const [users,   setUsers]   = useState<AppUser[]>([]);
  const [roles,   setRoles]   = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('users');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [editing,    setEditing]    = useState<EditState | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const load = async () => {
    setLoading(true);
    const [uRes, rRes] = await Promise.all([
      fetch('/api/users', { headers }),
      fetch('/api/roles', { headers }),
    ]);
    if (uRes.ok) setUsers((await uRes.json() as { users: AppUser[] }).users);
    if (rRes.ok) setRoles((await rRes.json() as { roles: Role[] }).roles);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const roleName = (id: string) => roles.find(r => r.id === id)?.name ?? id;
  const isSelf = (username: string) => username.toLowerCase() === currentUsername.toLowerCase();

  const openNew   = () => { setEditing({ ...EMPTY, role: roles.find(r => r.id !== 'super-admin')?.id ?? '' }); setIsNew(true); setError(''); setShowPassword(false); };
  const openEdit  = (u: AppUser) => { setEditing({ username: u.username, email: u.email ?? '', role: u.role, password: '' }); setIsNew(false); setError(''); setShowPassword(false); };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    if (!editing.username.trim()) { setError('Username wajib diisi.'); return; }
    if (isNew && !editing.password) { setError('Password wajib diisi.'); return; }
    if (!editing.role) { setError('Role wajib dipilih.'); return; }
    setSaving(true); setError('');

    const body: Record<string, unknown> = {
      email: editing.email || undefined,
      role: isSelf(editing.username) ? undefined : editing.role,
    };
    if (editing.password) body.password = editing.password;

    const r = isNew
      ? await fetch('/api/users', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, username: editing.username }) })
      : await fetch(`/api/users/${editing.username}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Pengguna berhasil ditambahkan.' : 'Pengguna berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal menyimpan pengguna.');
    }
    setSaving(false);
  };

  const del = async (u: AppUser) => {
    if (!await confirm({ message: `Hapus pengguna "${u.username}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(u.username);
    const r = await fetch(`/api/users/${u.username}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      setSelected(s => { const n = new Set(s); n.delete(u.username); return n; });
      toast.success(`Pengguna "${u.username}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus pengguna.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} pengguna yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const r = await fetch('/api/users/bulk-delete', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number; skippedSelf: number };
      await load();
      setSelected(new Set());
      const extra = d.skippedSelf > 0 ? ` (akun sendiri dilewati)` : '';
      toast.success(`${d.deleted} pengguna berhasil dihapus.${extra}`);
    } else {
      toast.error('Gagal menghapus pengguna yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (username: string) =>
    setSelected(s => { const n = new Set(s); n.has(username) ? n.delete(username) : n.add(username); return n; });

  const exportExcel = async (rows: AppUser[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada pengguna untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Pengguna');

      const COLS = [
        { header: 'No',        key: 'no',       width: 6  },
        { header: 'Username',  key: 'username', width: 22 },
        { header: 'Email',     key: 'email',    width: 28 },
        { header: 'Role',      key: 'role',     width: 20 },
        { header: 'Terdaftar', key: 'joined',   width: 16 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN PENGGUNA — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} pengguna (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((u, i) => {
        const row = ws.addRow({
          no: i + 1, username: u.username, email: u.email || '-', role: roleName(u.role), joined: formatDate(u),
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
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' };
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
      a.download = `pengguna-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} pengguna (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (rows: AppUser[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada pengguna untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR PENGGUNA',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '6%', align: 'center' },
              { header: 'Username', width: '22%', bold: true },
              { header: 'Email', width: '30%' },
              { header: 'Role', width: '22%' },
              { header: 'Terdaftar', width: '20%' },
            ],
            rows: rows.map((u, i) => [i + 1, u.username, u.email || '-', roleName(u.role), formatDate(u)]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pengguna-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} pengguna (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const filtered = users.filter(u => !search
    || u.username.toLowerCase().includes(search.toLowerCase())
    || (u.email ?? '').toLowerCase().includes(search.toLowerCase())
    || roleName(u.role).toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const selectablePage = paginated.filter(u => !isSelf(u.username));
  const togglePageAll = () => {
    const ids = selectablePage.map(u => u.username);
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
      {users.length > 0 && (
        <div className="flex flex-row items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari username, email, atau role…"
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
            {can('create') && (
              <button onClick={openNew} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                <Plus size={13} /> <span className="hidden sm:inline">Tambah Pengguna</span>
              </button>
            )}
          </div>
        </div>
      )}

      {users.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
            <ShieldCheck size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada pengguna</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>Klik &quot;Tambah Pengguna&quot; untuk membuat akun admin baru.</p>
          {can('create') && (
            <button onClick={openNew} className="btn-primary mx-auto px-5 py-2.5 text-sm">
              <Plus size={14} /> Tambah Pengguna Pertama
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Select-all bar */}
          {can('delete') && paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={selectablePage.length > 0 && selectablePage.every(u => selected.has(u.username))}
                indeterminate={selectablePage.some(u => selected.has(u.username)) && !selectablePage.every(u => selected.has(u.username))}
                disabled={selectablePage.length === 0}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} pengguna di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada pengguna yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((u, idx) => {
                const isDeleting = deletingId === u.username;
                const self       = isSelf(u.username);
                const isSelected = selected.has(u.username);
                const rowNum     = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
                return (
                  <div key={u.username} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, transition: 'background 0.1s' }}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      {can('delete') && (
                        <Tooltip label={self ? 'Tidak dapat memilih akun sendiri' : (isSelected ? 'Batalkan pilihan' : 'Pilih')}>
                          <span><Checkbox checked={isSelected} disabled={self} onChange={() => toggleSelect(u.username)} /></span>
                        </Tooltip>
                      )}
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                        {rowNum}
                      </span>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-xs" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {u.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                          {u.username}
                          {self && <span className="badge badge-gray">Anda</span>}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {[u.email, `Terdaftar ${formatDate(u)}`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className="badge badge-amber flex-shrink-0">{roleName(u.role)}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {can('edit') && (
                          <Tooltip label="Edit">
                            <button onClick={() => openEdit(u)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                              <Pencil size={13} />
                            </button>
                          </Tooltip>
                        )}
                        {can('delete') && (
                          <Tooltip label={self ? 'Tidak dapat menghapus akun sendiri' : 'Hapus'}>
                            <button onClick={() => del(u)} disabled={isDeleting || self} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
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
              {paginated.map(u => {
                const isDeleting = deletingId === u.username;
                const self       = isSelf(u.username);
                const isSelected = selected.has(u.username);
                return (
                  <div key={u.username} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    {can('delete') && (
                      <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                        <Checkbox checked={isSelected} disabled={self} onChange={() => toggleSelect(u.username)} />
                      </div>
                    )}
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center font-bold text-base mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {u.username.slice(0, 2).toUpperCase()}
                      </div>
                      <p className="text-sm font-bold truncate max-w-full flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        {u.username}
                        {self && <span className="badge badge-gray">Anda</span>}
                      </p>
                      <span className="badge badge-amber">{roleName(u.role)}</span>
                      <p className="text-xs truncate max-w-full" style={{ color: 'var(--text-muted)' }}>
                        {u.email || `Terdaftar ${formatDate(u)}`}
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      {can('edit') && (
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(u)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                      )}
                      {can('delete') && (
                        <Tooltip label={self ? 'Tidak dapat menghapus akun sendiri' : 'Hapus'}>
                          <button onClick={() => del(u)} disabled={isDeleting || self} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
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
                  {filtered.length} pengguna · halaman {safePage} dari {totalPages}
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
            <button onClick={() => exportExcel(users.filter(u => selected.has(u.username)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(users.filter(u => selected.has(u.username)), 'terpilih')} disabled={exportingPdf}
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
                <div className="modal-icon"><ShieldCheck size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Pengguna' : 'Edit Pengguna'}</p>
                  <p className="modal-subtitle">{isNew ? 'Buat akun admin baru' : `Edit: ${editing.username}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="field-label">Username <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input value={editing.username} disabled={!isNew}
                    onChange={e => setEditing({ ...editing, username: e.target.value })}
                    className="input" placeholder="cth: budi" autoFocus={isNew} />
                </div>
                <div>
                  <label className="field-label">Email (opsional)</label>
                  <input value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })}
                    className="input" placeholder="cth: budi@email.com" />
                </div>
                <div>
                  <label className="field-label">Role <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchableSelect
                    value={editing.role}
                    disabled={isSelf(editing.username)}
                    onChange={role => setEditing({ ...editing, role })}
                    options={roles.map(r => ({ value: r.id, label: r.name }))}
                    placeholder="— Pilih role —"
                    searchPlaceholder="Cari role…"
                  />
                  {isSelf(editing.username) && (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Anda tidak dapat mengubah role Anda sendiri.</p>
                  )}
                </div>
                <div>
                  <label className="field-label">{isNew ? 'Password' : 'Password baru (opsional)'} {isNew && <span style={{ color: 'var(--danger)' }}>*</span>}</label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} value={editing.password}
                      onChange={e => setEditing({ ...editing, password: e.target.value })}
                      className="input" style={{ paddingRight: 40 }}
                      placeholder={isNew ? 'Password akun' : 'Kosongkan jika tidak diubah'} />
                    <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
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
              <button onClick={save} disabled={saving}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Pengguna'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
