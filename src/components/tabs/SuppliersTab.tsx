'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Truck, Plus, Pencil, Trash2, X, Check, Loader2, Search,
  ChevronLeft, ChevronRight,
  Upload,
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

const API = '';
const HEADER_BTN_H = 34;

const TEMPLATE_COLS = [
  { header: 'Nama*',     key: 'name',    width: 24 },
  { header: 'Telepon',   key: 'phone',   width: 20 },
  { header: 'Alamat',    key: 'address', width: 32 },
  { header: 'Catatan',   key: 'note',    width: 28 },
] as const;

type TemplateKey = typeof TEMPLATE_COLS[number]['key'];

function detectColumn(header: string): TemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('nama')) return 'name';
  if (h.includes('telp') || h.includes('hp') || h.includes('whatsapp') || h.includes('phone')) return 'phone';
  if (h.includes('alamat') || h.includes('address')) return 'address';
  if (h.includes('catatan') || h.includes('note')) return 'note';
  return null;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.trim().slice(0, 2) || '?').toUpperCase();
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

interface Supplier {
  id: string; code?: string; name: string; phone: string; address: string; note: string;
  createdAt?: { seconds: number };
}

const EMPTY_SUPPLIER: Omit<Supplier, 'id'> = { name: '', phone: '', address: '', note: '' };

function formatDate(s: Supplier) {
  if (s.createdAt?.seconds)
    return new Date(s.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return '–';
}

export default function SuppliersTab({ creds }: { creds: string }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);

  const [suppliers,   setSuppliers]   = useState<Supplier[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('suppliers');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [editing,    setEditing]    = useState<(Omit<Supplier, 'id'> & { id: string }) | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');
  const [importing,  setImporting]  = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [exporting,  setExporting]  = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/suppliers`, { headers });
    if (r.ok) { const { suppliers: s } = await r.json() as { suppliers: Supplier[] }; setSuppliers(s); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Excel template + import ────────────────────────────────────────
  const downloadTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Supplier');
    const colCount = TEMPLATE_COLS.length;
    ws.columns = TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT DATA SUPPLIER — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. '
      + 'Mulai isi data supplier dari baris 4 ke bawah, satu supplier per baris. Kolom Telepon diformat teks — simpan sebagai angka biasa, contoh: 081234567890.';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 34;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
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
    ws.getColumn('phone').numFmt = '@';

    const exampleRow = ws.addRow({
      name: 'UD Sumber Tani', phone: '081234567890',
      address: 'Jl. Pasar Induk No. 12', note: 'Contoh — timpa dengan data supplier Anda',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-supplier.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importFromExcel = async (file: File) => {
    setImporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, TemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, TemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('name')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Nama" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: Omit<Supplier, 'id'>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw = Object.fromEntries(TEMPLATE_COLS.map(c => [c.key, ''])) as Record<TemplateKey, string>;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (raw.name.trim()) rows.push({ ...EMPTY_SUPPLIER, ...raw });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data supplier valid pada file tersebut.');
        return;
      }

      const r = await fetch(`${API}/api/suppliers/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ suppliers: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number; skippedDuplicate: number };
        await load();
        const extra = [
          d.skippedDuplicate > 0 ? `${d.skippedDuplicate} telepon duplikat dilewati` : '',
          d.skippedInvalid   > 0 ? `${d.skippedInvalid} baris tidak lengkap dilewati` : '',
        ].filter(Boolean).join(', ');
        toast.success(`${d.created} supplier berhasil diimpor.${extra ? ` (${extra})` : ''}`);
      } else {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        toast.error(d.error ?? 'Gagal mengimpor data supplier.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImporting(false);
    }
  };

  const exportExcel = async (rows: Supplier[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada supplier untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Supplier');

      const COLS = [
        { header: 'No',        key: 'no',      width: 6  },
        { header: 'Kode',      key: 'code',    width: 12 },
        { header: 'Nama',      key: 'name',    width: 24 },
        { header: 'Telepon',   key: 'phone',   width: 18 },
        { header: 'Alamat',    key: 'address', width: 32 },
        { header: 'Catatan',   key: 'note',    width: 28 },
        { header: 'Terdaftar', key: 'joined',  width: 16 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN SUPPLIER — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} supplier (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((s, i) => {
        const row = ws.addRow({
          no: i + 1, code: s.code || '-', name: s.name, phone: s.phone || '-', address: s.address || '-',
          note: s.note || '-', joined: formatDate(s),
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
        row.getCell('no').alignment      = { horizontal: 'center', vertical: 'middle' };
        row.getCell('address').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        row.getCell('note').alignment    = { horizontal: 'left', vertical: 'top', wrapText: true };
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
      a.download = `supplier-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} supplier (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (rows: Supplier[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada supplier untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR SUPPLIER',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '5%', align: 'center' },
              { header: 'Kode', width: '10%' },
              { header: 'Nama', width: '18%', bold: true },
              { header: 'Telepon', width: '14%' },
              { header: 'Alamat', width: '25%' },
              { header: 'Catatan', width: '18%' },
              { header: 'Terdaftar', width: '10%' },
            ],
            rows: rows.map((s, i) => [i + 1, s.code || '-', s.name, s.phone || '-', s.address || '-', s.note || '-', formatDate(s)]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `supplier-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} supplier (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const openNew   = () => { setEditing({ id: '', ...EMPTY_SUPPLIER }); setIsNew(true); setError(''); };
  const openEdit  = (s: Supplier) => { setEditing({ ...s }); setIsNew(false); setError(''); };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Nama wajib diisi.'); return; }
    setSaving(true); setError('');
    const { id, ...rest } = editing;
    const r = isNew
      ? await fetch(`${API}/api/suppliers`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(rest) })
      : await fetch(`${API}/api/suppliers/${id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(rest) });
    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Supplier berhasil ditambahkan.' : 'Supplier berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal menyimpan supplier.');
      toast.error(d.error ?? 'Gagal menyimpan supplier.');
    }
    setSaving(false);
  };

  const del = async (id: string, name: string) => {
    if (!await confirm({ message: `Hapus supplier "${name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(id);
    const r = await fetch(`${API}/api/suppliers/${id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      toast.success(`Supplier "${name}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus supplier.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} supplier yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const r = await fetch(`${API}/api/suppliers/bulk-delete`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number; skippedInUse: number };
      // Refetch, bukan filter optimis lokal — sebagian id terpilih bisa dilewati server
      // (skippedInUse, mis. masih punya riwayat pembelian bahan baku).
      await load();
      setSelected(new Set());
      const extra = d.skippedInUse > 0 ? ` (${d.skippedInUse} masih punya riwayat pembelian, dilewati)` : '';
      toast.success(`${d.deleted} supplier berhasil dihapus.${extra}`);
    } else {
      toast.error('Gagal menghapus supplier yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const filtered = suppliers
    .filter(s => !search
      || s.name.toLowerCase().includes(search.toLowerCase())
      || (s.code ?? '').toLowerCase().includes(search.toLowerCase())
      || s.phone.toLowerCase().includes(search.toLowerCase())
      || s.address.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const togglePageAll = () => {
    const pageIds     = paginated.map(s => s.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
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
      {suppliers.length > 0 && (
        <div className="flex flex-row items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari nama, kode, telepon, atau alamat…"
            />
          </div>
          <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
            <Tooltip label="Unduh Template">
              <button onClick={downloadTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                <ExcelIcon size={14} />
              </button>
            </Tooltip>
            <Tooltip label={importing ? 'Mengimpor…' : 'Upload Excel'}>
              <button onClick={() => importFileRef.current?.click()} disabled={importing} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              </button>
            </Tooltip>
            <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) importFromExcel(f); e.target.value = ''; }} />
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
              <Plus size={13} /> <span className="hidden sm:inline">Tambah Supplier</span>
            </button>
          </div>
        </div>
      )}

      {suppliers.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
            <Truck size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada supplier</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            Klik &quot;Tambah Supplier&quot; untuk menambahkan data supplier pertama, atau unduh template lalu upload Excel untuk impor massal.
          </p>
          <button onClick={openNew} className="btn-primary mx-auto px-5 py-2.5 text-sm">
            <Plus size={14} /> Tambah Supplier Pertama
          </button>
        </div>
      ) : (
        <>
          {/* Select-all bar */}
          {paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={paginated.every(s => selected.has(s.id))}
                indeterminate={paginated.some(s => selected.has(s.id)) && !paginated.every(s => selected.has(s.id))}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} supplier di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada supplier yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((s, idx) => {
                const isDeleting = deletingId === s.id;
                const isSelected = selected.has(s.id);
                const rowNum     = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
                return (
                  <div key={s.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, transition: 'background 0.1s' }}>
                    <div className="flex items-center gap-2 px-4 py-3.5">
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(s.id)} />
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                        {rowNum}
                      </span>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-xs" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {initials(s.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                          {s.code && (
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                              {s.code}
                            </span>
                          )}
                        </div>
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {[s.phone, s.address].filter(Boolean).join(' · ') || '–'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(s)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                            <Pencil size={13} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button onClick={() => del(s.id, s.name)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </Tooltip>
                        <Tooltip label="Lihat detail">
                          <button onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} className="btn-ghost p-2">
                            <ChevronRight size={13} style={{ transform: expandedId === s.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                    {expandedId === s.id && <SupplierDetail s={s} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(s => {
                const isDeleting = deletingId === s.id;
                const isSelected = selected.has(s.id);
                return (
                  <div key={s.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(s.id)} />
                    </div>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center font-bold text-base mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {initials(s.name)}
                      </div>
                      <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                      {s.code && (
                        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                          {s.code}
                        </span>
                      )}
                      <p className="text-xs truncate max-w-full" style={{ color: 'var(--text-muted)' }}>
                        {[s.phone, s.address].filter(Boolean).join(' · ') || 'Tidak ada kontak'}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <button onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                        Detail <ChevronRight size={12} style={{ transform: expandedId === s.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(s)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button onClick={() => del(s.id, s.name)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                    {expandedId === s.id && <SupplierDetail s={s} />}
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
                  {filtered.length} supplier · halaman {safePage} dari {totalPages}
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
            <button onClick={() => exportExcel(suppliers.filter(s => selected.has(s.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(suppliers.filter(s => selected.has(s.id)), 'terpilih')} disabled={exportingPdf}
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
                <div className="modal-icon"><Truck size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Supplier' : 'Edit Supplier'}</p>
                  <p className="modal-subtitle">{isNew ? 'Simpan data supplier baru' : `Edit: ${editing.name}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="field-label">Nama Supplier <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                    className="input" placeholder="cth: UD Sumber Tani" autoFocus />
                </div>
                <div>
                  <label className="field-label">Telepon (opsional)</label>
                  <input value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })}
                    className="input" placeholder="Contoh: 081234567890" />
                </div>
                <div>
                  <label className="field-label">Alamat (opsional)</label>
                  <input value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })}
                    className="input" placeholder="Alamat lengkap" />
                </div>
                <div>
                  <label className="field-label">Catatan (opsional)</label>
                  <textarea value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })}
                    className="input" style={{ resize: 'vertical', minHeight: 70 }} placeholder="Catatan tambahan tentang supplier" />
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
              <button onClick={save} disabled={saving || !editing.name.trim()}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SupplierDetail({ s }: { s: Supplier }) {
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {[
          { label: 'Kode Supplier', val: s.code },
          { label: 'Telepon', val: s.phone },
          { label: 'Terdaftar', val: formatDate(s) },
        ].map((f, i) => (
          <div key={i} className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>{f.label}</p>
            <p className="text-xs font-medium break-words" style={{ color: 'var(--text-secondary)' }}>{f.val || '–'}</p>
          </div>
        ))}
        <div className="col-span-2 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Alamat</p>
          <p className="text-xs font-medium break-words" style={{ color: 'var(--text-secondary)' }}>{s.address || '–'}</p>
        </div>
        {s.note && (
          <div className="col-span-2 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Catatan</p>
            <p className="text-xs font-medium break-words" style={{ color: 'var(--text-secondary)' }}>{s.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}
