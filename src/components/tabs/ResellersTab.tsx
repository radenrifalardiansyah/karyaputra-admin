'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Pencil, Trash2, X, Check, Loader2, Search,
  ChevronLeft, ChevronRight, Users,
  UserCheck, UserX, Clock, UserSearch, Landmark, Wallet, Upload,
  User, Building2,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import FilterSelect from '@/components/FilterSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import PageSizeSelect from '@/components/PageSizeSelect';

const API       = '';
const HEADER_BTN_H = 34;

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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.trim().slice(0, 2) || '?').toUpperCase();
}

type Status = 'pending' | 'approved' | 'rejected';
type CustomerType = 'personal' | 'company';

interface Reseller {
  id: string; customerId?: string;
  name: string; phone: string; code?: string; email?: string;
  address?: string; city?: string;
  type?: CustomerType;
  bankName?: string; bankAccount?: string; bankHolder?: string;
  status: Status;
  createdAt?: { seconds: number };
}

interface CustomerOption { id: string; name: string; phone?: string; city?: string; code?: string; }
interface BankOption { id: string; name: string; bankCode?: string; ewallet?: boolean; logoUrl?: string; }

function customerLabel(c: { name: string; phone?: string; code?: string }) {
  return `${c.code ? `${c.code} · ` : ''}${c.name}${c.phone ? ` · ${c.phone}` : ''}`;
}

const STATUS_MAP = {
  pending:  { label: 'Menunggu',  cls: 'badge-amber', icon: Clock },
  approved: { label: 'Disetujui', cls: 'badge-green', icon: UserCheck },
  rejected: { label: 'Ditolak',   cls: 'badge-red',   icon: UserX },
} as const;

const CUSTOMER_TYPE_MAP = {
  personal: { label: 'Personal',   cls: 'badge-blue',  icon: User },
  company:  { label: 'Perusahaan', cls: 'badge-amber', icon: Building2 },
} as const;

function formatDate(r: Reseller) {
  if (r.createdAt?.seconds)
    return new Date(r.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return '–';
}

// ─── Excel import ─────────────────────────────────────────────────────────────
const RESELLER_TEMPLATE_COLS = [
  { header: 'No. HP*',       key: 'phone',       width: 18 },
  { header: 'Nama*',         key: 'name',        width: 24 },
  { header: 'Kota',          key: 'city',        width: 16 },
  { header: 'Alamat',        key: 'address',     width: 32 },
  { header: 'Bank',          key: 'bankName',    width: 16 },
  { header: 'No. Rekening',  key: 'bankAccount', width: 18 },
  { header: 'Atas Nama',     key: 'bankHolder',  width: 20 },
  { header: 'Status',        key: 'status',      width: 14 },
] as const;

type ResellerTemplateKey = typeof RESELLER_TEMPLATE_COLS[number]['key'];

function detectResellerColumn(header: string): ResellerTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('hp') || h.includes('whatsapp') || h.includes('telp') || h.includes('phone')) return 'phone';
  if (h.includes('rekening')) return 'bankAccount';
  if (h.includes('atas nama')) return 'bankHolder';
  if (h.includes('bank')) return 'bankName';
  if (h.includes('kota') || h.includes('city')) return 'city';
  if (h.includes('alamat') || h.includes('address')) return 'address';
  if (h.includes('status')) return 'status';
  if (h.includes('nama')) return 'name';
  return null;
}

function normalizeResellerStatus(v: string): Status {
  const s = v.toLowerCase();
  if (s.includes('setuju')) return 'approved';
  if (s.includes('tolak')) return 'rejected';
  return 'pending';
}

interface EditingReseller {
  id: string;
  customerId: string;
  customerLabel: string;
  manual: boolean;
  manualCustomer: { name: string; phone: string; address: string; city: string };
  bankName: string; bankAccount: string; bankHolder: string;
  status: Status;
}

const EMPTY_EDITING: Omit<EditingReseller, 'id'> = {
  customerId: '', customerLabel: '', manual: false,
  manualCustomer: { name: '', phone: '', address: '', city: '' },
  bankName: '', bankAccount: '', bankHolder: '', status: 'pending',
};

export default function ResellersTab({ creds }: { creds: string }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const storeHeader = useStoreHeader(creds);

  const [resellers,   setResellers]   = useState<Reseller[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [search,      setSearch]      = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'semua'>('semua');
  const [typeFilter,   setTypeFilter]   = useState<CustomerType | 'semua'>('semua');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('resellers');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkStatusUpdating, setBulkStatusUpdating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [customers,   setCustomers]   = useState<CustomerOption[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [pickerOpen,  setPickerOpen]  = useState(false);

  const [bankOptions,   setBankOptions]   = useState<BankOption[]>([]);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [bankKind, setBankKind] = useState<'bank' | 'ewallet'>('bank');

  const [editing,     setEditing]     = useState<EditingReseller | null>(null);
  const [isNew,       setIsNew]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);
  const [error,       setError]       = useState('');

  const headers = { 'x-admin-auth': creds };

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/resellers`, { headers });
    if (r.ok) { const { resellers: rs } = await r.json() as { resellers: Reseller[] }; setResellers(rs); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const loadCustomers = async () => {
    const r = await fetch(`${API}/api/customers`, { headers });
    if (r.ok) { const { customers: c } = await r.json() as { customers: CustomerOption[] }; setCustomers(c); }
  };

  const loadBanks = async () => {
    const r = await fetch(`${API}/api/master-banks`, { headers });
    if (r.ok) { const { banks: b } = await r.json() as { banks: BankOption[] }; setBankOptions(b); }
  };

  const openNew = () => {
    setEditing({ id: '', ...EMPTY_EDITING });
    setIsNew(true); setError(''); setCustomerQuery(''); setPickerOpen(false); setBankKind('bank');
    loadCustomers(); loadBanks();
  };
  const openEdit = (r: Reseller) => {
    setEditing({
      id: r.id,
      customerId: r.customerId ?? '',
      customerLabel: customerLabel(r),
      manual: false,
      manualCustomer: { name: '', phone: '', address: '', city: '' },
      bankName: r.bankName ?? '', bankAccount: r.bankAccount ?? '', bankHolder: r.bankHolder ?? '',
      status: r.status,
    });
    setIsNew(false); setError(''); setCustomerQuery(''); setPickerOpen(false); setBankKind('bank');
    loadCustomers(); loadBanks();
  };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const filteredCustomerOptions = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c =>
      c.name.toLowerCase().includes(q)
      || (c.phone ?? '').toLowerCase().includes(q)
      || (c.code ?? '').toLowerCase().includes(q));
  }, [customers, customerQuery]);

  useEffect(() => {
    if (!editing?.bankName || bankOptions.length === 0) return;
    const match = bankOptions.find(b => b.name.toLowerCase() === editing.bankName.trim().toLowerCase());
    if (match) setBankKind(match.ewallet ? 'ewallet' : 'bank');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankOptions]);

  const filteredBankOptions = useMemo(() => {
    const byKind = bankOptions.filter(b => (bankKind === 'ewallet') === !!b.ewallet);
    const q = (editing?.bankName ?? '').trim().toLowerCase();
    if (!q) return byKind;
    return byKind.filter(b => b.name.toLowerCase().includes(q) || (b.bankCode ?? '').includes(q));
  }, [bankOptions, bankKind, editing?.bankName]);

  const pickCustomer = (c: CustomerOption) => {
    if (!editing) return;
    setEditing({ ...editing, customerId: c.id, customerLabel: customerLabel(c) });
    setPickerOpen(false); setCustomerQuery('');
  };

  const toggleManual = (manual: boolean) => {
    if (!editing) return;
    setEditing({ ...editing, manual, customerId: manual ? '' : editing.customerId });
    setPickerOpen(false);
  };

  const save = async () => {
    if (!editing) return;
    if (editing.manual) {
      if (!editing.manualCustomer.name.trim()) { setError('Nama pelanggan wajib diisi.'); return; }
    } else if (!editing.customerId) {
      setError('Pilih pelanggan terlebih dahulu.'); return;
    }

    setSaving(true); setError('');
    const body = {
      ...(editing.manual
        ? { customer: editing.manualCustomer }
        : { customerId: editing.customerId }),
      bankName: editing.bankName, bankAccount: editing.bankAccount, bankHolder: editing.bankHolder,
      status: editing.status,
    };
    const r = isNew
      ? await fetch(`${API}/api/resellers`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`${API}/api/resellers/${editing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Reseller berhasil ditambahkan.' : 'Reseller berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal menyimpan reseller.');
      toast.error(d.error ?? 'Gagal menyimpan reseller.');
    }
    setSaving(false);
  };

  const del = async (id: string, name: string) => {
    if (!await confirm({ message: `Hapus reseller "${name}"? Data pelanggan terkait tidak akan terhapus.`, danger: true })) return;
    setDeletingId(id);
    const r = await fetch(`${API}/api/resellers/${id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      toast.success(`Reseller "${name}" berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus reseller.');
    }
    setDeletingId(null);
  };

  const updateStatus = async (id: string, status: 'approved' | 'rejected') => {
    const r = await fetch(`${API}/api/resellers/${id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (r.ok) {
      setResellers(rs => rs.map(x => x.id === id ? { ...x, status } : x));
      toast.success(status === 'approved' ? 'Reseller berhasil disetujui.' : 'Reseller berhasil ditolak.');
    } else {
      toast.error('Gagal mengubah status reseller.');
    }
  };

  const bulkUpdateStatus = async (status: 'approved' | 'rejected') => {
    if (selected.size === 0) return;
    const verb = status === 'approved' ? 'menyetujui' : 'menolak';
    if (!await confirm({ message: `${status === 'approved' ? 'Setujui' : 'Tolak'} ${selected.size} reseller yang dipilih?` })) return;
    setBulkStatusUpdating(true);
    const count = selected.size;
    const ids = [...selected];
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/resellers/${id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })));
    const okIds = ids.filter((_, i) => results[i].ok);
    setResellers(rs => rs.map(r => okIds.includes(r.id) ? { ...r, status } : r));
    setSelected(new Set());
    if (okIds.length === count) toast.success(`${count} reseller berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}.`);
    else toast.error(`Gagal ${verb} ${count - okIds.length} dari ${count} reseller.`);
    setBulkStatusUpdating(false);
  };

  const exportExcel = async (rows: Reseller[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada reseller untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Reseller');

      const COLS = [
        { header: 'No',           key: 'no',          width: 6  },
        { header: 'Kode',         key: 'code',        width: 10 },
        { header: 'Nama',         key: 'name',        width: 24 },
        { header: 'Jenis',        key: 'type',        width: 14 },
        { header: 'No. HP',       key: 'phone',       width: 18 },
        { header: 'Email',        key: 'email',       width: 24 },
        { header: 'Kota',         key: 'city',        width: 16 },
        { header: 'Alamat',       key: 'address',     width: 32 },
        { header: 'Bank',         key: 'bankName',    width: 16 },
        { header: 'No. Rekening', key: 'bankAccount', width: 18 },
        { header: 'Atas Nama',    key: 'bankHolder',  width: 20 },
        { header: 'Status',       key: 'status',      width: 14 },
        { header: 'Bergabung',    key: 'joined',      width: 16 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN RESELLER — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} reseller (${label}) · Diexport ${todayLabel}`;
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

      const STATUS_FONT_COLOR: Record<Status, string> = {
        pending: 'FFD97706', approved: 'FF16A34A', rejected: 'FFDC2626',
      };

      rows.forEach((r, i) => {
        const row = ws.addRow({
          no: i + 1,
          code: r.code || '-',
          name: r.name,
          type: CUSTOMER_TYPE_MAP[r.type ?? 'personal'].label,
          phone: r.phone || '-',
          email: r.email || '-',
          city: r.city || '-',
          address: r.address || '-',
          bankName: r.bankName || '-',
          bankAccount: r.bankAccount || '-',
          bankHolder: r.bankHolder || '-',
          status: STATUS_MAP[r.status].label,
          joined: formatDate(r),
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
        row.getCell('type').alignment   = { horizontal: 'center', vertical: 'middle' };
        row.getCell('address').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        const statusCell = row.getCell('status');
        statusCell.font = { bold: true, color: { argb: STATUS_FONT_COLOR[r.status] } };
        statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
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
      a.download = `reseller-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} reseller (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (rows: Reseller[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada reseller untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR RESELLER',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            // Bank/No. Rekening/Atas Nama digabung jadi satu kolom (beda dari Excel yang punya
            // 3 kolom terpisah) — 13 kolom terlalu sempit untuk A4 landscape.
            columns: [
              { header: 'No', width: '4%', align: 'center' },
              { header: 'Kode', width: '6%' },
              { header: 'Nama', width: '13%', bold: true },
              { header: 'Jenis', width: '8%' },
              { header: 'No. HP', width: '10%' },
              { header: 'Email', width: '12%' },
              { header: 'Kota', width: '8%' },
              { header: 'Alamat', width: '15%' },
              { header: 'Rekening Bank', width: '15%' },
              { header: 'Status', width: '9%', align: 'center' },
            ],
            rows: rows.map((r, i) => [
              i + 1, r.code || '-', r.name, CUSTOMER_TYPE_MAP[r.type ?? 'personal'].label, r.phone || '-',
              r.email || '-', r.city || '-', r.address || '-',
              r.bankName ? `${r.bankName} · ${r.bankAccount || '-'} a.n. ${r.bankHolder || '-'}` : '-',
              STATUS_MAP[r.status].label,
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reseller-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} reseller (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const downloadResellerTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Reseller');
    const colCount = RESELLER_TEMPLATE_COLS.length;
    ws.columns = RESELLER_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT DATA RESELLER — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. '
      + 'Jika No. HP sudah terdaftar sebagai pelanggan, reseller akan ditautkan ke pelanggan tersebut — jika belum, pelanggan baru dibuat otomatis. '
      + 'Kolom Status diisi "Menunggu", "Disetujui", atau "Ditolak" (kosong dianggap Menunggu).';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 34;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    RESELLER_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
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
      phone: '081234567890', name: 'Budi Santoso', city: 'Bandung', address: 'Jl. Merdeka No. 1',
      bankName: 'BCA', bankAccount: '1234567890', bankHolder: 'Budi Santoso', status: 'Menunggu',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-reseller.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importResellersFromExcel = async (file: File) => {
    setImporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, ResellerTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, ResellerTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectResellerColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('phone') || fields.has('name')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "No. HP" atau "Nama" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: Record<string, unknown>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw: Record<string, string> = Object.fromEntries(RESELLER_TEMPLATE_COLS.map(c => [c.key, '']));
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (!raw.phone.trim() && !raw.name.trim()) return;
        rows.push({
          phone: raw.phone, name: raw.name, city: raw.city, address: raw.address,
          bankName: raw.bankName, bankAccount: raw.bankAccount, bankHolder: raw.bankHolder,
          status: normalizeResellerStatus(raw.status),
        });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data reseller valid pada file tersebut.');
        return;
      }

      const r = await fetch(`${API}/api/resellers/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resellers: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number; skippedDuplicate: number };
        await load();
        const extra = [
          d.skippedDuplicate > 0 ? `${d.skippedDuplicate} sudah jadi reseller dilewati` : '',
          d.skippedInvalid   > 0 ? `${d.skippedInvalid} baris tidak lengkap dilewati` : '',
        ].filter(Boolean).join(', ');
        toast.success(`${d.created} reseller berhasil diimpor.${extra ? ` (${extra})` : ''}`);
      } else {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        toast.error(d.error ?? 'Gagal mengimpor data reseller.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImporting(false);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} reseller yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const count = selected.size;
    const ids = [...selected];
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/resellers/${id}`, { method: 'DELETE', headers })));
    const okIds = ids.filter((_, i) => results[i].ok);
    setResellers(rs => rs.filter(r => !okIds.includes(r.id)));
    setSelected(new Set());
    if (okIds.length === count) toast.success(`${count} reseller berhasil dihapus.`);
    else toast.error(`Hanya ${okIds.length} dari ${count} reseller berhasil dihapus.`);
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const filtered = resellers.filter(r =>
    (statusFilter === 'semua' || r.status === statusFilter)
    && (typeFilter === 'semua' || (r.type ?? 'personal') === typeFilter)
    && (!search
      || r.name.toLowerCase().includes(search.toLowerCase())
      || r.phone.toLowerCase().includes(search.toLowerCase())
      || (r.city ?? '').toLowerCase().includes(search.toLowerCase())
      || (r.bankAccount ?? '').toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const togglePageAll = () => {
    const pageIds     = paginated.map(r => r.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const counts = {
    total:    resellers.length,
    pending:  resellers.filter(r => r.status === 'pending').length,
    approved: resellers.filter(r => r.status === 'approved').length,
    rejected: resellers.filter(r => r.status === 'rejected').length,
    personal: resellers.filter(r => (r.type ?? 'personal') === 'personal').length,
    company:  resellers.filter(r => (r.type ?? 'personal') === 'company').length,
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Header: search + actions in one row */}
      {resellers.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-full sm:w-[200px] flex-shrink-0">
            <FilterSelect
              value={statusFilter}
              onChange={v => { setStatusFilter(v as Status | 'semua'); resetPage(); }}
              height={HEADER_BTN_H}
              searchPlaceholder="Cari status…"
              options={[
                { value: 'semua', label: 'Semua Status', count: counts.total },
                ...(['pending', 'approved', 'rejected'] as const).map(s => ({
                  value: s, label: STATUS_MAP[s].label, count: counts[s],
                })),
              ]}
            />
          </div>
          <div className="w-full sm:w-[180px] flex-shrink-0">
            <FilterSelect
              value={typeFilter}
              onChange={v => { setTypeFilter(v as CustomerType | 'semua'); resetPage(); }}
              height={HEADER_BTN_H}
              searchPlaceholder="Cari jenis…"
              options={[
                { value: 'semua', label: 'Semua Jenis', count: counts.total },
                ...(['personal', 'company'] as const).map(t => ({
                  value: t, label: CUSTOMER_TYPE_MAP[t].label, count: counts[t],
                })),
              ]}
            />
          </div>
          <div className="flex flex-row items-center gap-2 sm:gap-3 sm:flex-1">
            <div className="relative flex-1 min-w-0">
              <Search size={14} style={{
                position: 'absolute', left: 14, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
              }} />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); resetPage(); }}
                className="input text-sm w-full"
                style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                placeholder="Cari nama, No. HP, kota, atau No. rekening…"
              />
            </div>
            <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
              <Tooltip label="Unduh Template">
                <button onClick={downloadResellerTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  <ExcelIcon size={14} />
                </button>
              </Tooltip>
              <Tooltip label={importing ? 'Mengimpor…' : 'Upload Excel'}>
                <button onClick={() => importFileRef.current?.click()} disabled={importing} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                </button>
              </Tooltip>
              <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) importResellersFromExcel(f); e.target.value = ''; }} />
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
                <Plus size={13} /> <span className="hidden sm:inline">Tambah Reseller</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {resellers.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
            <Users size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada reseller</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            Klik &quot;Tambah Reseller&quot; untuk menjadikan pelanggan sebagai reseller.
          </p>
          <button onClick={openNew} className="btn-primary mx-auto px-5 py-2.5 text-sm">
            <Plus size={14} /> Tambah Reseller Pertama
          </button>
        </div>
      ) : (
        <>
          {/* Select-all bar */}
          {paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card"
              style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={paginated.every(r => selected.has(r.id))}
                indeterminate={paginated.some(r => selected.has(r.id)) && !paginated.every(r => selected.has(r.id))}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} reseller di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada reseller yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((r, idx) => {
                const isDeleting = deletingId === r.id;
                const isSelected = selected.has(r.id);
                const rowNum     = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
                return (
                  <div key={r.id}
                    style={{
                      borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined,
                      background: isSelected ? 'rgba(212,105,30,0.05)' : undefined,
                      transition: 'background 0.1s',
                    }}>
                    <div className="flex items-center gap-2 px-4 py-3.5">
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(r.id)} />

                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center"
                        style={{ color: 'var(--text-muted)' }}>
                        {rowNum}
                      </span>

                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-xs"
                        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {initials(r.name)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{r.name}</p>
                          <span className={`badge ${STATUS_MAP[r.status].cls} text-[10px]`}>
                            {STATUS_MAP[r.status].label}
                          </span>
                          <span className={`badge ${CUSTOMER_TYPE_MAP[r.type ?? 'personal'].cls} text-[10px]`}>
                            {CUSTOMER_TYPE_MAP[r.type ?? 'personal'].label}
                          </span>
                        </div>
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {[r.phone, r.city].filter(Boolean).join(' · ') || '–'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        {r.status === 'pending' && (
                          <>
                            <Tooltip label="Setujui">
                              <button onClick={() => updateStatus(r.id, 'approved')} className="btn-ghost p-2" style={{ color: 'var(--success)' }} title="Setujui">
                                <Check size={13} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Tolak">
                              <button onClick={() => updateStatus(r.id, 'rejected')} className="btn-ghost p-2" style={{ color: 'var(--danger)' }} title="Tolak">
                                <X size={13} />
                              </button>
                            </Tooltip>
                          </>
                        )}
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(r)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                            <Pencil size={13} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button onClick={() => del(r.id, r.name)} disabled={isDeleting}
                            className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </Tooltip>
                        <Tooltip label={expandedId === r.id ? 'Sembunyikan detail' : 'Lihat detail'}>
                          <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="btn-ghost p-2">
                            <ChevronRight size={13} style={{ transform: expandedId === r.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    {expandedId === r.id && <ResellerDetail r={r} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(r => {
                const isDeleting = deletingId === r.id;
                const isSelected = selected.has(r.id);
                return (
                  <div key={r.id} className="card overflow-hidden relative"
                    style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(r.id)} />
                    </div>

                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center font-bold text-base mb-1"
                        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {initials(r.name)}
                      </div>
                      <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{r.name}</p>
                      <div className="flex items-center gap-1.5 flex-wrap justify-center">
                        <span className={`badge ${STATUS_MAP[r.status].cls} text-[10px]`}>
                          {STATUS_MAP[r.status].label}
                        </span>
                        <span className={`badge ${CUSTOMER_TYPE_MAP[r.type ?? 'personal'].cls} text-[10px]`}>
                          {CUSTOMER_TYPE_MAP[r.type ?? 'personal'].label}
                        </span>
                      </div>
                      <p className="text-xs truncate max-w-full" style={{ color: 'var(--text-muted)' }}>
                        {r.phone}{r.city ? ` · ${r.city}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                        Detail <ChevronRight size={12} style={{ transform: expandedId === r.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {r.status === 'pending' && (
                          <>
                            <Tooltip label="Setujui">
                              <button onClick={() => updateStatus(r.id, 'approved')} className="btn-ghost p-1.5" style={{ color: 'var(--success)' }} title="Setujui">
                                <Check size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Tolak">
                              <button onClick={() => updateStatus(r.id, 'rejected')} className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }} title="Tolak">
                                <X size={12} />
                              </button>
                            </Tooltip>
                          </>
                        )}
                        <Tooltip label="Edit">
                          <button onClick={() => openEdit(r)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button onClick={() => del(r.id, r.name)} disabled={isDeleting}
                            className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    {expandedId === r.id && <ResellerDetail r={r} />}
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
                  {filtered.length} reseller · halaman {safePage} dari {totalPages}
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
            <button onClick={() => exportExcel(resellers.filter(r => selected.has(r.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(resellers.filter(r => selected.has(r.id)), 'terpilih')} disabled={exportingPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              PDF
            </button>
            <button onClick={() => bulkUpdateStatus('approved')} disabled={bulkStatusUpdating || bulkDeleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--success)', color: '#fff' }}>
              {bulkStatusUpdating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Setujui
            </button>
            <button onClick={() => bulkUpdateStatus('rejected')} disabled={bulkStatusUpdating || bulkDeleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkStatusUpdating ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
              Tolak
            </button>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={bulkDelete} disabled={bulkDeleting || bulkStatusUpdating}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--surface-2)', color: 'var(--danger)' }}>
              {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setSelected(new Set())}
              className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
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
                <div className="modal-icon">
                  <Users size={17} />
                </div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Reseller' : 'Edit Reseller'}</p>
                  <p className="modal-subtitle">{isNew ? 'Jadikan pelanggan sebagai reseller' : `Edit: ${editing.customerLabel}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={closeEdit} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Customer picker / manual entry */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="field-label" style={{ marginBottom: 0 }}>Pelanggan <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <button type="button" onClick={() => toggleManual(!editing.manual)}
                      className="text-[11px] font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                      <UserSearch size={11} />
                      {editing.manual ? 'Pilih dari pelanggan existing' : 'Tidak ditemukan? Input manual'}
                    </button>
                  </div>

                  {editing.manual ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <input
                        value={editing.manualCustomer.name}
                        onChange={e => setEditing({ ...editing, manualCustomer: { ...editing.manualCustomer, name: e.target.value } })}
                        className="input" placeholder="Nama pelanggan baru" autoFocus
                      />
                      <input
                        value={editing.manualCustomer.phone}
                        onChange={e => setEditing({ ...editing, manualCustomer: { ...editing.manualCustomer, phone: e.target.value } })}
                        className="input" placeholder="No. HP / WhatsApp (opsional)"
                      />
                      <div style={{ display: 'flex', gap: 10 }}>
                        <input
                          value={editing.manualCustomer.city}
                          onChange={e => setEditing({ ...editing, manualCustomer: { ...editing.manualCustomer, city: e.target.value } })}
                          className="input" style={{ flex: 1 }} placeholder="Kota (opsional)"
                        />
                      </div>
                      <input
                        value={editing.manualCustomer.address}
                        onChange={e => setEditing({ ...editing, manualCustomer: { ...editing.manualCustomer, address: e.target.value } })}
                        className="input" placeholder="Alamat (opsional)"
                      />
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        Data ini akan otomatis dibuat sebagai pelanggan baru.
                      </p>
                    </div>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      {editing.customerId ? (
                        <div className="flex items-center justify-between gap-2 px-3.5 rounded-xl"
                          style={{ height: 42, background: 'var(--accent-bg)', border: '1.5px solid var(--accent-light)' }}>
                          <span className="text-sm font-semibold truncate" style={{ color: 'var(--accent)' }}>{editing.customerLabel}</span>
                          <button type="button" onClick={() => setEditing({ ...editing, customerId: '', customerLabel: '' })}
                            className="text-[11px] font-semibold flex-shrink-0" style={{ color: 'var(--accent)' }}>
                            Ganti
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <Search size={13} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                            <input
                              value={customerQuery}
                              onChange={e => { setCustomerQuery(e.target.value); setPickerOpen(true); }}
                              onFocus={() => setPickerOpen(true)}
                              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                              className="input text-sm w-full" style={{ paddingLeft: 34 }}
                              placeholder="Cari nama, No. HP, atau kode pelanggan…"
                              autoFocus
                            />
                          </div>
                          {pickerOpen && (
                            <div className="absolute left-0 right-0 mt-1 rounded-xl z-10"
                              style={{
                                background: 'var(--surface)', border: '1.5px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                maxHeight: 220, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
                              }}>
                              {filteredCustomerOptions.length === 0 ? (
                                <p className="text-xs px-3.5 py-3" style={{ color: 'var(--text-muted)' }}>Tidak ada pelanggan yang cocok.</p>
                              ) : filteredCustomerOptions.map(c => (
                                <button key={c.id} type="button" onMouseDown={() => pickCustomer(c)}
                                  className="w-full text-left px-3.5 py-2.5 flex items-center gap-2 transition-colors"
                                  style={{ borderTop: '1px solid var(--border-2)' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                  {c.code && (
                                    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                                      style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                      {c.code}
                                    </span>
                                  )}
                                  <span className="text-sm font-semibold truncate flex-1" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{c.phone}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="field-label">Status</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['pending', 'approved', 'rejected'] as const).map(s => {
                      const S = STATUS_MAP[s].icon;
                      const active = editing.status === s;
                      return (
                        <button key={s} type="button" onClick={() => setEditing({ ...editing, status: s })}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 transition-all"
                          style={{
                            height: 38, fontSize: 13, fontWeight: 600,
                            ...(active ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-muted)' }),
                          }}>
                          <S size={14} /> {STATUS_MAP[s].label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ position: 'relative' }}>
                  <label className="field-label">Metode Pembayaran (opsional)</label>
                  <div className="flex rounded-xl overflow-hidden border mb-2" style={{ borderColor: 'var(--border)' }}>
                    {([
                      { key: 'bank' as const,    label: 'Bank',     Icon: Landmark },
                      { key: 'ewallet' as const, label: 'E-Wallet', Icon: Wallet },
                    ]).map(({ key, label, Icon }) => {
                      const active = bankKind === key;
                      return (
                        <button key={key} type="button"
                          onClick={() => { setBankKind(key); setEditing({ ...editing, bankName: '' }); setBankPickerOpen(true); }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 transition-all"
                          style={{
                            height: 38, fontSize: 13, fontWeight: 600,
                            ...(active ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-muted)' }),
                          }}>
                          <Icon size={14} /> {label}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    value={editing.bankName}
                    onChange={e => { setEditing({ ...editing, bankName: e.target.value }); setBankPickerOpen(true); }}
                    onFocus={() => setBankPickerOpen(true)}
                    onBlur={() => setTimeout(() => setBankPickerOpen(false), 150)}
                    className="input"
                    placeholder={bankKind === 'ewallet' ? 'Cari atau ketik nama e-wallet…' : 'Cari atau ketik nama bank…'}
                  />
                  {bankPickerOpen && filteredBankOptions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 rounded-xl z-10"
                      style={{
                        background: 'var(--surface)', border: '1.5px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                        maxHeight: 200, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
                      }}>
                      {filteredBankOptions.map(b => (
                        <button key={b.id} type="button"
                          onMouseDown={() => { setEditing({ ...editing, bankName: b.name }); setBankPickerOpen(false); }}
                          className="w-full text-left px-3.5 py-2.5 text-sm font-medium transition-colors flex items-center gap-2"
                          style={{ borderTop: '1px solid var(--border-2)', color: 'var(--text-primary)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          {b.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={b.logoUrl} alt="" className="w-5 h-5 rounded flex-shrink-0" style={{ objectFit: 'contain', background: 'var(--surface-2)' }} />
                          ) : null}
                          {b.bankCode && (
                            <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                              {b.bankCode}
                            </span>
                          )}
                          {b.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="field-label">No. Rekening (opsional)</label>
                    <input
                      value={editing.bankAccount}
                      onChange={e => setEditing({ ...editing, bankAccount: e.target.value })}
                      className="input" placeholder="1234567890"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Atas Nama (opsional)</label>
                    <input
                      value={editing.bankHolder}
                      onChange={e => setEditing({ ...editing, bankHolder: e.target.value })}
                      className="input" placeholder="Nama pemilik rekening"
                    />
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
              <button onClick={closeEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={save} disabled={saving}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Reseller'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResellerDetail({ r }: { r: Reseller }) {
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {[
          { label: 'Kode Pelanggan', val: r.code },
          { label: 'Jenis', val: CUSTOMER_TYPE_MAP[r.type ?? 'personal'].label },
          { label: 'No. HP', val: r.phone },
          { label: 'Email', val: r.email },
          { label: 'Kota', val: r.city },
          { label: 'Bank', val: r.bankName },
          { label: 'No. Rekening', val: r.bankAccount },
          { label: 'Atas Nama', val: r.bankHolder },
          { label: 'Bergabung', val: formatDate(r) },
        ].map((f, i) => (
          <div key={i} className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>{f.label}</p>
            <p className="text-xs font-medium break-words" style={{ color: 'var(--text-secondary)' }}>{f.val || '–'}</p>
          </div>
        ))}
        <div className="col-span-2 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Alamat</p>
          <p className="text-xs font-medium break-words" style={{ color: 'var(--text-secondary)' }}>{r.address || '–'}</p>
        </div>
      </div>
    </div>
  );
}
