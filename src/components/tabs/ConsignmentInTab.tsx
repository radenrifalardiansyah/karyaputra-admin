'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Users, PackagePlus, Undo2, Wallet as WalletIcon, PieChart,
  Plus, Pencil, Trash2, X, Check, Loader2, Trash, RefreshCw, Search, ChevronLeft, ChevronRight, Upload,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import { useViewMode } from '@/lib/useViewMode';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';
import type { PosProduct } from '@/lib/pos-types';
import { variantOptionsLabel } from '@/lib/pos-types';
import { type PeriodKey, periodRange } from '@/lib/period';
import ConsignmentInAnalyticsSection, { type ConsignmentInAnalyticsData } from '@/components/dashboard/ConsignmentInAnalyticsSection';

// Fitur "Titip Masuk" (konsinyasi MASUK — partner luar menitip barang ke toko kita untuk dijual,
// kebalikan arah dari tab "Mitra"/ConsignmentTab yang menitip KELUAR). Barang titipan adalah row
// `products` biasa (owner_type='consigned_in') — stoknya ikut logic products/warehouse_stock
// existing, jadi langsung bisa dijual di Kasir. UI mengikuti pola tab Mitra (search + ViewToggle
// tabel/kartu + pagination + modal untuk input) supaya konsisten dengan menu lain. Lihat plan
// snug-sparking-ocean.md.

const API = '';
const HEADER_BTN_H = 34;

// Kunci gabungan produk+varian dipakai di dropdown Terima Titipan/Retur (SearchSelect cuma punya
// satu `value` string) — sama pola dengan stockKey() di stock-pg.ts, ditulis ulang di sini karena
// stock-pg.ts mengimpor driver Postgres yang tidak boleh ikut ke bundle client.
const variantKey = (productId: string, variantId?: string) => variantId ? `${productId}::${variantId}` : productId;
const parseVariantKey = (key: string): { productId: string; variantId?: string } => {
  const idx = key.indexOf('::');
  return idx === -1 ? { productId: key } : { productId: key.slice(0, idx), variantId: key.slice(idx + 2) };
};

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function formatDate(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Pagination bar — salinan lokal dari pola yang sama di ConsignmentTab.tsx (tidak diekspor dari
// sana, tiap tab yang butuh mendefinisikan sendiri, sama seperti Checkbox lokal di SuppliersTab.tsx).
function Pagination({ total, safePage, totalPages, pageSize, onPageSize, onGoPage, unit }: {
  total: number; safePage: number; totalPages: number; pageSize: number;
  onPageSize: (n: number) => void; onGoPage: (p: number) => void; unit: string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} {unit} · halaman {safePage} dari {totalPages}</p>
        <PageSizeSelect value={pageSize} onChange={onPageSize} />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Tooltip label="Halaman sebelumnya">
            <button onClick={() => onGoPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
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
                : <button key={n} onClick={() => onGoPage(n as number)}
                    className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                    style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                    {n}
                  </button>
            )}
          <Tooltip label="Halaman berikutnya">
            <button onClick={() => onGoPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
              <ChevronRight size={14} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ─── Partner — Excel import/export (pola sama dengan PRODUCT_TEMPLATE_COLS di ProductsTab.tsx) ──
const PARTNER_TEMPLATE_COLS = [
  { header: 'Kode',              key: 'code',                 width: 12 },
  { header: 'Nama*',             key: 'name',                 width: 24 },
  { header: 'Kontak',            key: 'contactName',          width: 18 },
  { header: 'Telepon',           key: 'contactPhone',         width: 16 },
  { header: 'Alamat',            key: 'address',              width: 30 },
  { header: 'Catatan',           key: 'note',                 width: 24 },
  { header: 'Tipe Settlement (Tetap/Persentase)', key: 'defaultSettlementType', width: 22 },
  { header: 'Harga Bayar Tetap', key: 'defaultPayoutPrice',   width: 16 },
  { header: 'Komisi Toko (%)',   key: 'defaultCommissionPct', width: 14 },
] as const;

type PartnerTemplateKey = typeof PARTNER_TEMPLATE_COLS[number]['key'];

function detectPartnerColumn(header: string): PartnerTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('kode')) return 'code';
  if (h.includes('nama')) return 'name';
  if (h.includes('kontak')) return 'contactName';
  if (h.includes('telepon') || h.includes('telp') || h.includes('hp')) return 'contactPhone';
  if (h.includes('alamat')) return 'address';
  if (h.includes('catatan')) return 'note';
  if (h.includes('settlement') || h.includes('tipe')) return 'defaultSettlementType';
  if (h.includes('komisi')) return 'defaultCommissionPct';
  if (h.includes('harga') || h.includes('bayar')) return 'defaultPayoutPrice';
  return null;
}

// ─── Checkbox — salinan lokal dari pola yang sama di ProductsTab.tsx (tidak diekspor, tiap tab
// yang butuh mendefinisikan sendiri, sama seperti Pagination di atas) ──
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

type SubTab = 'partner' | 'terima' | 'retur' | 'settlement' | 'analitik';
const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'partner',    label: 'Partner',    Icon: Users },
  { id: 'terima',     label: 'Terima',     Icon: PackagePlus },
  { id: 'retur',      label: 'Retur',      Icon: Undo2 },
  { id: 'settlement', label: 'Settlement', Icon: WalletIcon },
  { id: 'analitik',   label: 'Analitik',   Icon: PieChart },
];

interface Partner {
  id: string; name: string; code: string; contactName: string; contactPhone: string; address: string; note: string;
  defaultSettlementType: 'fixed' | 'percentage'; defaultPayoutPrice: number | null; defaultCommissionPct: number | null;
}
type PartnerForm = Omit<Partner, 'id' | 'code'>;
const EMPTY_PARTNER: PartnerForm = {
  name: '', contactName: '', contactPhone: '', address: '', note: '',
  defaultSettlementType: 'fixed', defaultPayoutPrice: null, defaultCommissionPct: null,
};

interface Warehouse { id: string; name: string }

interface ShipmentItem { productId: string; productName: string; qty: number }
interface Shipment {
  id: string; partnerId: string; partnerName: string; warehouseId?: string; warehouseName?: string;
  direction: 'in' | 'out'; items: ShipmentItem[]; note?: string; createdAt?: { seconds: number };
}

interface LedgerEntry {
  id: string; orderId: string | null; productId: string; productName: string;
  consignorId: string; consignorName: string; qty: number; payoutAmount: number;
  status: 'unsettled' | 'settled' | 'voided'; createdAt?: { seconds: number };
}
interface LedgerSummaryRow { productId: string; productName: string; qty: number; payoutAmount: number }

interface Settlement {
  id: string; partnerId: string; partnerName: string;
  items: { productId: string; productName: string; qty: number; payoutAmount: number }[];
  totalPayable: number; walletId: string | null; note?: string; createdAt?: { seconds: number };
}

interface Row { productId: string; qty: string }
const EMPTY_ROW: Row = { productId: '', qty: '' };

function EmptyState({ Icon, title, subtitle, actionLabel, onAction }: {
  Icon: React.ElementType; title: string; subtitle: string; actionLabel: string; onAction: () => void;
}) {
  return (
    <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
        <Icon size={28} style={{ color: 'var(--accent)' }} />
      </div>
      <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
      <button onClick={onAction} className="btn-primary mx-auto px-5 py-2.5 text-sm">
        <Plus size={14} /> {actionLabel}
      </button>
    </div>
  );
}

export default function ConsignmentInTab({ creds, products }: { creds: string; products: PosProduct[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const storeHeader = useStoreHeader(creds);
  const headers = { 'x-admin-auth': creds };
  const wallets = useWallets(creds);
  const [walletBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

  const [subTab, setSubTab] = useState<SubTab>('partner');
  const consignedInProducts = products.filter(p => p.ownerType === 'consigned_in');

  // ── Partner ──────────────────────────────────────────────────────
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnerView, setPartnerView] = useViewMode('consignment-in-partners', 'card');
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerPage, setPartnerPage] = useState(1);
  const [partnerPageSize, setPartnerPageSize] = useState(10);
  const [showPForm, setShowPForm] = useState(false);
  const [editingP, setEditingP] = useState<Partner | null>(null);
  const [pForm, setPForm] = useState<PartnerForm>(EMPTY_PARTNER);
  const [savingP, setSavingP] = useState(false);
  const [deletingPId, setDeletingPId] = useState<string | null>(null);
  const [selectedPartners, setSelectedPartners] = useState<Set<string>>(new Set());
  const [bulkDeletingPartners, setBulkDeletingPartners] = useState(false);
  const [exportingPartnersExcel, setExportingPartnersExcel] = useState(false);
  const [exportingPartnersPdf, setExportingPartnersPdf] = useState(false);
  const [importingPartners, setImportingPartners] = useState(false);
  const partnerImportFileRef = useRef<HTMLInputElement>(null);

  const loadPartners = async () => {
    setPartnersLoading(true);
    const r = await fetch(`${API}/api/consignment-in/partners`, { headers });
    if (r.ok) setPartners((await r.json() as { partners: Partner[] }).partners);
    setPartnersLoading(false);
  };
  useEffect(() => { loadPartners(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateP = () => { setEditingP(null); setPForm(EMPTY_PARTNER); setShowPForm(true); };
  const openEditP = (p: Partner) => {
    setEditingP(p);
    setPForm({
      name: p.name, contactName: p.contactName, contactPhone: p.contactPhone, address: p.address, note: p.note,
      defaultSettlementType: p.defaultSettlementType, defaultPayoutPrice: p.defaultPayoutPrice, defaultCommissionPct: p.defaultCommissionPct,
    });
    setShowPForm(true);
  };
  const savePartner = async () => {
    if (!pForm.name.trim()) return;
    setSavingP(true);
    const r = editingP
      ? await fetch(`${API}/api/consignment-in/partners/${editingP.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(pForm) })
      : await fetch(`${API}/api/consignment-in/partners`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(pForm) });
    if (r.ok) { await loadPartners(); setShowPForm(false); toast.success(editingP ? 'Partner berhasil diperbarui.' : 'Partner berhasil ditambahkan.'); }
    else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan partner.'); }
    setSavingP(false);
  };
  const deletePartner = async (p: Partner) => {
    if (!await confirm({ message: `Hapus partner "${p.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingPId(p.id);
    const r = await fetch(`${API}/api/consignment-in/partners/${p.id}`, { method: 'DELETE', headers });
    if (r.ok) { setPartners(prev => prev.filter(x => x.id !== p.id)); toast.success(`"${p.name}" berhasil dihapus.`); }
    else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menghapus partner.'); }
    setDeletingPId(null);
  };

  const togglePartnerSelect = (id: string) =>
    setSelectedPartners(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePartnerPageAll = () => {
    const pageIds = paginatedPartners.map(p => p.id);
    const allSelected = pageIds.every(id => selectedPartners.has(id));
    setSelectedPartners(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const bulkDeletePartners = async () => {
    if (selectedPartners.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedPartners.size} partner yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeletingPartners(true);
    const ids = [...selectedPartners];
    const r = await fetch(`${API}/api/consignment-in/partners/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    const d = await r.json().catch(() => ({ deleted: 0, failed: [] })) as { deleted: number; failed: { id: string; error: string }[] };
    if (d.deleted > 0) {
      setPartners(prev => prev.filter(x => !ids.includes(x.id) || d.failed.some(f => f.id === x.id)));
      setSelectedPartners(new Set());
    }
    if (d.failed.length > 0) {
      toast.error(d.deleted > 0
        ? `${d.deleted} partner terhapus, ${d.failed.length} gagal (masih punya produk/riwayat titipan).`
        : `Gagal menghapus — semua partner terpilih masih punya produk/riwayat titipan.`);
    } else if (d.deleted > 0) {
      toast.success(`${d.deleted} partner berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus partner yang dipilih.');
    }
    setBulkDeletingPartners(false);
  };

  const downloadPartnerTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Partner');
    const colCount = PARTNER_TEMPLATE_COLS.length;
    ws.columns = PARTNER_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT PARTNER TITIP JUAL — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. '
      + 'Kolom Tipe Settlement diisi "Tetap" atau "Persentase" (kosong dianggap Tetap). '
      + 'Isi Harga Bayar Tetap untuk tipe Tetap, atau Komisi Toko (%) untuk tipe Persentase.';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 46;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    PARTNER_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
    headerRow.height = 24;
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFC96018' } }, bottom: { style: 'thin', color: { argb: 'FFC96018' } },
        left: { style: 'thin', color: { argb: 'FFC96018' } }, right: { style: 'thin', color: { argb: 'FFC96018' } },
      };
    });
    ws.views = [{ state: 'frozen', ySplit: HEADER_ROW_NUM }];

    const exampleRow = ws.addRow({
      code: 'TMK001', name: 'Toko Barokah', contactName: 'Bu Siti', contactPhone: '081234567890',
      address: 'Jl. Contoh No. 1', note: 'Contoh — timpa dengan data partner Anda',
      defaultSettlementType: 'Tetap', defaultPayoutPrice: 10000, defaultCommissionPct: '',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'template-partner-titip-jual.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const importPartnersFromExcel = async (file: File) => {
    setImportingPartners(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, PartnerTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, PartnerTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectPartnerColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('name')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Nama" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: Record<string, unknown>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw: Record<string, string> = Object.fromEntries(PARTNER_TEMPLATE_COLS.map(c => [c.key, '']));
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (!raw.name.trim()) return;
        const isPercentage = /persen/i.test(raw.defaultSettlementType.trim());
        rows.push({
          code: raw.code, name: raw.name, contactName: raw.contactName, contactPhone: raw.contactPhone,
          address: raw.address, note: raw.note,
          defaultSettlementType: isPercentage ? 'percentage' : 'fixed',
          defaultPayoutPrice: raw.defaultPayoutPrice ? Number(raw.defaultPayoutPrice.replace(/[^0-9.-]/g, '')) || 0 : null,
          defaultCommissionPct: raw.defaultCommissionPct ? Number(raw.defaultCommissionPct.replace(/[^0-9.-]/g, '')) || 0 : null,
        });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data partner valid pada file tersebut. Pastikan kolom Nama terisi.');
        return;
      }

      const r = await fetch(`${API}/api/consignment-in/partners/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ partners: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number; skippedDuplicate: number };
        await loadPartners();
        const extra = [
          d.skippedDuplicate > 0 ? `${d.skippedDuplicate} Kode duplikat dilewati` : '',
          d.skippedInvalid   > 0 ? `${d.skippedInvalid} baris tidak lengkap dilewati` : '',
        ].filter(Boolean).join(', ');
        toast.success(`${d.created} partner berhasil diimpor.${extra ? ` (${extra})` : ''}`);
      } else {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        toast.error(d.error ?? 'Gagal mengimpor data partner.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImportingPartners(false);
    }
  };

  const exportPartnersExcel = async (rows: Partner[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada partner untuk diexport.'); return; }
    setExportingPartnersExcel(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Partner');

      const COLS = [
        { header: 'No',             key: 'no',                   width: 6  },
        { header: 'Kode',           key: 'code',                 width: 10 },
        { header: 'Nama',           key: 'name',                 width: 26 },
        { header: 'Kontak',         key: 'contactName',          width: 18 },
        { header: 'Telepon',        key: 'contactPhone',         width: 16 },
        { header: 'Alamat',         key: 'address',              width: 30 },
        { header: 'Tipe Settlement', key: 'settlementLabel',     width: 16 },
        { header: 'Harga Bayar Tetap', key: 'defaultPayoutPrice', width: 16 },
        { header: 'Komisi Toko (%)', key: 'defaultCommissionPct', width: 14 },
        { header: 'Catatan',        key: 'note',                 width: 30 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN PARTNER TITIP JUAL — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} partner (${label}) · Diexport ${todayLabel}`;
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
          top: { style: 'thin', color: { argb: 'FFC96018' } }, bottom: { style: 'thin', color: { argb: 'FFC96018' } },
          left: { style: 'thin', color: { argb: 'FFC96018' } }, right: { style: 'thin', color: { argb: 'FFC96018' } },
        };
      });
      ws.views = [{ state: 'frozen', ySplit: HEADER_ROW_NUM }];

      rows.forEach((p, i) => {
        const row = ws.addRow({
          no: i + 1, code: p.code || '-', name: p.name, contactName: p.contactName || '-',
          contactPhone: p.contactPhone || '-', address: p.address || '-',
          settlementLabel: p.defaultSettlementType === 'fixed' ? 'Tetap' : 'Persentase',
          defaultPayoutPrice: p.defaultSettlementType === 'fixed' ? (p.defaultPayoutPrice ?? 0) : null,
          defaultCommissionPct: p.defaultSettlementType === 'percentage' ? (p.defaultCommissionPct ?? 0) : null,
          note: p.note || '-',
        });
        const zebraFill = i % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraFill } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          };
          cell.alignment = { vertical: 'middle', wrapText: false };
        });
        if (p.defaultSettlementType === 'fixed') {
          row.getCell('defaultPayoutPrice').numFmt = '"Rp"#,##0';
          row.getCell('defaultPayoutPrice').alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          row.getCell('defaultCommissionPct').numFmt = '0"%"';
          row.getCell('defaultCommissionPct').alignment = { horizontal: 'right', vertical: 'middle' };
        }
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('settlementLabel').alignment = { horizontal: 'center', vertical: 'middle' };
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
      a.href = url; a.download = `partner-titip-jual-${today}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} partner (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingPartnersExcel(false);
    }
  };

  const exportPartnersPdf = async (rows: Partner[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada partner untuk diexport.'); return; }
    setExportingPartnersPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR PARTNER TITIP JUAL',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '5%', align: 'center' },
              { header: 'Kode', width: '10%' },
              { header: 'Nama', width: '20%', bold: true },
              { header: 'Kontak', width: '15%' },
              { header: 'Telepon', width: '14%' },
              { header: 'Alamat', width: '21%' },
              { header: 'Settlement', width: '15%', align: 'right' },
            ],
            rows: rows.map((p, i) => [
              i + 1,
              p.code || '-',
              p.name,
              p.contactName || '-',
              p.contactPhone || '-',
              p.address || '-',
              p.defaultSettlementType === 'fixed' ? `Tetap ${formatRp(p.defaultPayoutPrice ?? 0)}` : `Komisi ${p.defaultCommissionPct ?? 0}%`,
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url; a.download = `partner-titip-jual-${today}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} partner (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPartnersPdf(false);
    }
  };

  const filteredPartners = partners.filter(p => {
    const q = partnerSearch.toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
      || p.contactPhone.toLowerCase().includes(q) || p.address.toLowerCase().includes(q);
  });
  const totalPartnerPages = Math.max(1, Math.ceil(filteredPartners.length / partnerPageSize));
  const safePartnerPage = Math.min(partnerPage, totalPartnerPages);
  const paginatedPartners = filteredPartners.slice((safePartnerPage - 1) * partnerPageSize, safePartnerPage * partnerPageSize);
  const goPartnerPage = (p: number) => setPartnerPage(Math.max(1, Math.min(p, totalPartnerPages)));

  // ── Gudang ───────────────────────────────────────────────────────
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  useEffect(() => {
    fetch(`${API}/api/warehouses`, { headers }).then(async r => {
      if (r.ok) setWarehouses((await r.json() as { warehouses: Warehouse[] }).warehouses);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Terima Titipan & Retur ke Partner (form dalam modal, riwayat sebagai daftar) ──
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [receivePartnerId, setReceivePartnerId] = useState('');
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');
  const [receiveNote, setReceiveNote] = useState('');
  const [receiveRows, setReceiveRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [savingReceive, setSavingReceive] = useState(false);
  const receivePartnerProducts = consignedInProducts.filter(p => p.consignorId === receivePartnerId);

  const openReceiveForm = () => {
    setReceivePartnerId(''); setReceiveWarehouseId(''); setReceiveNote(''); setReceiveRows([{ ...EMPTY_ROW }]);
    setShowReceiveForm(true);
  };
  const submitReceive = async () => {
    if (!receivePartnerId) { toast.error('Pilih partner dulu.'); return; }
    if (!receiveWarehouseId) { toast.error('Pilih gudang tujuan.'); return; }
    const items = receiveRows
      .filter(r => r.productId && Number(r.qty) > 0)
      .map(r => {
        const { productId, variantId } = parseVariantKey(r.productId);
        const p = receivePartnerProducts.find(pp => pp.id === productId);
        const variant = variantId ? p?.variants?.find(v => v.id === variantId) : undefined;
        const label = variant ? variantOptionsLabel(variant.options) : '';
        return {
          productId, variantId,
          productName: label ? `${p?.name ?? ''} — ${label}` : (p?.name ?? ''),
          qty: Number(r.qty),
        };
      });
    if (items.length === 0) { toast.error('Isi minimal 1 produk & qty.'); return; }
    setSavingReceive(true);
    const partner = partners.find(p => p.id === receivePartnerId);
    const warehouse = warehouses.find(w => w.id === receiveWarehouseId);
    const r = await fetch(`${API}/api/consignment-in/receive`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partnerId: receivePartnerId, partnerName: partner?.name ?? '',
        warehouseId: receiveWarehouseId, warehouseName: warehouse?.name ?? '',
        note: receiveNote, items,
      }),
    });
    if (r.ok) {
      toast.success('Penerimaan titipan berhasil disimpan.');
      setShowReceiveForm(false);
      await loadShipments();
    } else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan.'); }
    setSavingReceive(false);
  };

  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnPartnerId, setReturnPartnerId] = useState('');
  const [returnWarehouseId, setReturnWarehouseId] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [returnRows, setReturnRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [savingReturn, setSavingReturn] = useState(false);
  const returnPartnerProducts = consignedInProducts.filter(p => p.consignorId === returnPartnerId);

  const openReturnForm = () => {
    setReturnPartnerId(''); setReturnWarehouseId(''); setReturnNote(''); setReturnRows([{ ...EMPTY_ROW }]);
    setShowReturnForm(true);
  };
  const submitReturn = async () => {
    if (!returnPartnerId) { toast.error('Pilih partner dulu.'); return; }
    if (!returnWarehouseId) { toast.error('Pilih gudang asal.'); return; }
    const items = returnRows
      .filter(r => r.productId && Number(r.qty) > 0)
      .map(r => {
        const { productId, variantId } = parseVariantKey(r.productId);
        const p = returnPartnerProducts.find(pp => pp.id === productId);
        const variant = variantId ? p?.variants?.find(v => v.id === variantId) : undefined;
        const label = variant ? variantOptionsLabel(variant.options) : '';
        return {
          productId, variantId,
          productName: label ? `${p?.name ?? ''} — ${label}` : (p?.name ?? ''),
          qty: Number(r.qty),
        };
      });
    if (items.length === 0) { toast.error('Isi minimal 1 produk & qty.'); return; }
    setSavingReturn(true);
    const partner = partners.find(p => p.id === returnPartnerId);
    const warehouse = warehouses.find(w => w.id === returnWarehouseId);
    const r = await fetch(`${API}/api/consignment-in/return`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partnerId: returnPartnerId, partnerName: partner?.name ?? '',
        warehouseId: returnWarehouseId, warehouseName: warehouse?.name ?? '',
        note: returnNote, items,
      }),
    });
    if (r.ok) {
      toast.success('Retur ke partner berhasil disimpan.');
      setShowReturnForm(false);
      await loadShipments();
    } else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan.'); }
    setSavingReturn(false);
  };

  // ── Riwayat Terima/Retur ─────────────────────────────────────────
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(true);
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [shipmentView, setShipmentView] = useViewMode('consignment-in-shipments', 'card');
  const [shipmentPage, setShipmentPage] = useState(1);
  const [shipmentPageSize, setShipmentPageSize] = useState(10);
  const loadShipments = async () => {
    setShipmentsLoading(true);
    const r = await fetch(`${API}/api/consignment-in/shipments`, { headers });
    if (r.ok) setShipments((await r.json() as { shipments: Shipment[] }).shipments);
    setShipmentsLoading(false);
  };
  useEffect(() => { loadShipments(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setShipmentSearch(''); setShipmentPage(1); }, [subTab]);

  // ── Settlement ───────────────────────────────────────────────────
  const [showSettleForm, setShowSettleForm] = useState(false);
  const [settleModalPartnerId, setSettleModalPartnerId] = useState('');
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummaryRow[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [settleWalletId, setSettleWalletId] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [savingSettle, setSavingSettle] = useState(false);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(true);
  const [settlementSearch, setSettlementSearch] = useState('');
  const [settlementView, setSettlementView] = useViewMode('consignment-in-settlements', 'card');
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementPageSize, setSettlementPageSize] = useState(10);

  const loadLedger = async (partnerId: string) => {
    if (!partnerId) { setLedgerSummary([]); setLedgerEntries([]); setLedgerTotal(0); return; }
    setLedgerLoading(true);
    const r = await fetch(`${API}/api/consignment-in/ledger?partnerId=${partnerId}&status=unsettled`, { headers });
    if (r.ok) {
      const d = await r.json() as { entries: LedgerEntry[]; summary: LedgerSummaryRow[]; total: number };
      setLedgerEntries(d.entries); setLedgerSummary(d.summary); setLedgerTotal(d.total);
    }
    setLedgerLoading(false);
  };
  const loadSettlements = async () => {
    setSettlementsLoading(true);
    const r = await fetch(`${API}/api/consignment-in/settle`, { headers });
    if (r.ok) setSettlements((await r.json() as { settlements: Settlement[] }).settlements);
    setSettlementsLoading(false);
  };
  useEffect(() => { loadSettlements(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showSettleForm) return;
    loadLedger(settleModalPartnerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettleForm, settleModalPartnerId]);

  const openSettleForm = (partnerId?: string) => {
    setSettleModalPartnerId(partnerId ?? ''); setSettleWalletId(''); setSettleNote('');
    setShowSettleForm(true);
  };
  const submitSettle = async () => {
    if (!settleModalPartnerId) { toast.error('Pilih partner dulu.'); return; }
    if (ledgerEntries.length === 0) { toast.error('Tidak ada tagihan yang belum dibayar.'); return; }
    const partner = partners.find(p => p.id === settleModalPartnerId);
    if (!await confirm({ message: `Bayar tagihan sebesar ${formatRp(ledgerTotal)} ke "${partner?.name}"?` })) return;
    setSavingSettle(true);
    const r = await fetch(`${API}/api/consignment-in/settle`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ partnerId: settleModalPartnerId, partnerName: partner?.name ?? '', walletId: settleWalletId || null, note: settleNote }),
    });
    if (r.ok) {
      toast.success('Settlement berhasil disimpan.');
      setShowSettleForm(false);
      await loadSettlements();
    } else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan settlement.'); }
    setSavingSettle(false);
  };

  const filteredSettlements = settlements.filter(s => {
    const q = settlementSearch.toLowerCase();
    if (!q) return true;
    return s.partnerName.toLowerCase().includes(q) || (s.note ?? '').toLowerCase().includes(q);
  });
  const totalSettlementPages = Math.max(1, Math.ceil(filteredSettlements.length / settlementPageSize));
  const safeSettlementPage = Math.min(settlementPage, totalSettlementPages);
  const paginatedSettlements = filteredSettlements.slice((safeSettlementPage - 1) * settlementPageSize, safeSettlementPage * settlementPageSize);
  const goSettlementPage = (p: number) => setSettlementPage(Math.max(1, Math.min(p, totalSettlementPages)));

  // ── Analitik ─────────────────────────────────────────────────────
  const [analyticsPeriod, setAnalyticsPeriod] = useState<PeriodKey>('30d');
  const [analyticsCustomFrom, setAnalyticsCustomFrom] = useState('');
  const [analyticsCustomTo, setAnalyticsCustomTo] = useState('');
  const [analyticsData, setAnalyticsData] = useState<ConsignmentInAnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const { from, to } = periodRange(analyticsPeriod, analyticsCustomFrom, analyticsCustomTo);
      const r = await fetch(`${API}/api/analytics/consignment-in?from=${from}&to=${to}`, { headers });
      if (r.ok) setAnalyticsData(await r.json() as ConsignmentInAnalyticsData);
    } catch {}
    setAnalyticsLoading(false);
  };
  useEffect(() => {
    if (subTab !== 'analitik') return;
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, analyticsPeriod, analyticsCustomFrom, analyticsCustomTo]);

  const refreshAll = () => {
    loadPartners(); loadShipments(); loadSettlements();
    if (subTab === 'analitik') fetchAnalytics();
  };

  // ── Baris tabel/kartu produk item (dipakai Terima & Retur, tampilan sama) ──
  function ShipmentRow({ s }: { s: Shipment }) {
    const totalQty = s.items.reduce((sum, it) => sum + it.qty, 0);
    return (
      <>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.partnerName}</p>
          </div>
          <span className="text-sm font-bold tabular" style={{ color: 'var(--text-primary)' }}>{totalQty} pcs</span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)} · {s.warehouseName}</p>
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
          {s.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', ')}
        </p>
        {s.note && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{s.note}&rdquo;</p>}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={refreshAll} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={partnersLoading || shipmentsLoading || settlementsLoading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="inline-flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all whitespace-nowrap"
              style={subTab === t.id ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { color: 'var(--text-muted)' }}>
              <t.Icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {/* ════ PARTNER ════════════════════════════════════════ */}
        {subTab === 'partner' && (
          <>
          <div className="p-4 lg:p-6 animate-fade-up space-y-4">
            {partners.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input value={partnerSearch} onChange={e => { setPartnerSearch(e.target.value); setPartnerPage(1); }}
                    className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari nama, kode, telepon, atau alamat…" />
                </div>
                <div className="flex items-center gap-2 justify-end flex-shrink-0 w-full sm:w-auto">
                  <Tooltip label="Unduh Template">
                    <button onClick={downloadPartnerTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      <ExcelIcon size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip label={importingPartners ? 'Mengimpor…' : 'Upload Excel'}>
                    <button onClick={() => partnerImportFileRef.current?.click()} disabled={importingPartners} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {importingPartners ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    </button>
                  </Tooltip>
                  <input ref={partnerImportFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) importPartnersFromExcel(f); e.target.value = ''; }} />
                  <Tooltip label="Export Excel">
                    <button onClick={() => exportPartnersExcel(filteredPartners, 'sesuai filter')} disabled={exportingPartnersExcel} aria-label="Export Excel"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingPartnersExcel ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                    </button>
                  </Tooltip>
                  <Tooltip label="Export PDF">
                    <button onClick={() => exportPartnersPdf(filteredPartners, 'sesuai filter')} disabled={exportingPartnersPdf} aria-label="Export PDF"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingPartnersPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                    </button>
                  </Tooltip>
                  <ViewToggle mode={partnerView} onChange={setPartnerView} height={HEADER_BTN_H} />
                  <button onClick={openCreateP} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                    <Plus size={13} /> <span className="hidden sm:inline">Tambah Partner</span>
                  </button>
                </div>
              </div>
            )}

            {partnersLoading && partners.length === 0 ? (
              <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
            ) : partners.length === 0 ? (
              <EmptyState Icon={Users} title="Belum ada partner titip jual"
                subtitle="Tambahkan partner/reseller yang menitipkan barang untuk dijual di toko Anda."
                actionLabel="Tambah Partner Pertama" onAction={openCreateP} />
            ) : (
              <>
                {paginatedPartners.length === 0 ? (
                  <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada partner yang cocok.</p></div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 px-4 py-2.5 card"
                      style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                      <Checkbox
                        checked={paginatedPartners.every(p => selectedPartners.has(p.id))}
                        indeterminate={paginatedPartners.some(p => selectedPartners.has(p.id)) && !paginatedPartners.every(p => selectedPartners.has(p.id))}
                        onChange={togglePartnerPageAll}
                      />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {selectedPartners.size > 0 ? `${selectedPartners.size} dipilih` : `${paginatedPartners.length} partner di halaman ini`}
                      </span>
                    </div>
                    {partnerView === 'table' ? (
                      <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                        {paginatedPartners.map(p => (
                          <div key={p.id} className="flex items-center gap-3 px-4 py-3"
                            style={{ background: selectedPartners.has(p.id) ? 'rgba(212,105,30,0.05)' : undefined }}>
                            <Checkbox checked={selectedPartners.has(p.id)} onChange={() => togglePartnerSelect(p.id)} />
                            <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-xs" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                              {p.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{p.code}</span>
                                <span className="badge badge-gray">{p.defaultSettlementType === 'fixed' ? `Tetap ${formatRp(p.defaultPayoutPrice ?? 0)}` : `Komisi toko ${p.defaultCommissionPct ?? 0}%`}</span>
                              </div>
                              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{p.contactPhone || '–'} · {p.address || '–'}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Tooltip label="Edit"><button onClick={() => openEditP(p)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}><Pencil size={12} /></button></Tooltip>
                              <Tooltip label="Hapus">
                                <button onClick={() => deletePartner(p)} disabled={deletingPId === p.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                                  {deletingPId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                </button>
                              </Tooltip>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {paginatedPartners.map(p => (
                          <div key={p.id} className="card p-4" style={{ background: selectedPartners.has(p.id) ? 'rgba(212,105,30,0.05)' : undefined }}>
                            <div className="flex items-center gap-2 mb-1">
                              <Checkbox checked={selectedPartners.has(p.id)} onChange={() => togglePartnerSelect(p.id)} />
                              <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-xs" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                                {p.name.slice(0, 2).toUpperCase()}
                              </div>
                              <p className="text-sm font-bold truncate flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <Tooltip label="Edit"><button onClick={() => openEditP(p)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}><Pencil size={12} /></button></Tooltip>
                                <Tooltip label="Hapus">
                                  <button onClick={() => deletePartner(p)} disabled={deletingPId === p.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                                    {deletingPId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                  </button>
                                </Tooltip>
                              </div>
                            </div>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.contactPhone || '–'} · {p.address || '–'}</p>
                            <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Kode</span>
                              <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{p.code}</span>
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Settlement</span>
                              <span className="badge badge-gray">{p.defaultSettlementType === 'fixed' ? `Tetap ${formatRp(p.defaultPayoutPrice ?? 0)}` : `Komisi ${p.defaultCommissionPct ?? 0}%`}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <Pagination total={filteredPartners.length} safePage={safePartnerPage} totalPages={totalPartnerPages}
                  pageSize={partnerPageSize} onPageSize={n => { setPartnerPageSize(n); setPartnerPage(1); }}
                  onGoPage={goPartnerPage} unit="partner" />
              </>
            )}
          </div>

          {/* Bulk action bar dirender di LUAR div animate-fade-up di atas — animasi CSS itu pakai
              `transform`, yang membuat elemen ini jadi containing block buat descendant
              `position: fixed` (spec CSS), sehingga bar ini malah nempel ke div tsb alih-alih ke
              viewport. Sama seperti pola bulk bar di ProductsTab.tsx (fixed di luar animate-fade-up). */}
          {selectedPartners.size > 0 && (
            <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
              <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
                style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
                <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedPartners.size} dipilih</span>
                <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
                <button onClick={() => exportPartnersExcel(partners.filter(p => selectedPartners.has(p.id)), 'terpilih')} disabled={exportingPartnersExcel}
                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                  style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  {exportingPartnersExcel ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
                  Export
                </button>
                <button onClick={() => exportPartnersPdf(partners.filter(p => selectedPartners.has(p.id)), 'terpilih')} disabled={exportingPartnersPdf}
                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                  style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  {exportingPartnersPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
                  PDF
                </button>
                <button onClick={bulkDeletePartners} disabled={bulkDeletingPartners}
                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                  style={{ background: 'var(--danger)', color: '#fff' }}>
                  {bulkDeletingPartners ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Hapus
                </button>
                <button onClick={() => setSelectedPartners(new Set())}
                  className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
                  Batal
                </button>
              </div>
            </div>
          )}
          </>
        )}

        {/* ════ TERIMA TITIPAN / RETUR KE PARTNER ═══════════════ */}
        {(subTab === 'terima' || subTab === 'retur') && (() => {
          const isReceive = subTab === 'terima';
          const direction = isReceive ? 'in' as const : 'out' as const;
          const directionShipments = shipments.filter(s => s.direction === direction);
          const filteredShipments = directionShipments.filter(s => {
            const q = shipmentSearch.toLowerCase();
            if (!q) return true;
            return s.partnerName.toLowerCase().includes(q) || (s.note ?? '').toLowerCase().includes(q)
              || s.items.some(it => it.productName.toLowerCase().includes(q));
          });
          const totalPages = Math.max(1, Math.ceil(filteredShipments.length / shipmentPageSize));
          const safePage = Math.min(shipmentPage, totalPages);
          const paginated = filteredShipments.slice((safePage - 1) * shipmentPageSize, safePage * shipmentPageSize);
          const goPage = (p: number) => setShipmentPage(Math.max(1, Math.min(p, totalPages)));
          const openForm = isReceive ? openReceiveForm : openReturnForm;
          const addLabel = isReceive ? 'Terima Titipan' : 'Retur ke Partner';

          return (
            <div className="p-4 lg:p-6 animate-fade-up space-y-4">
              {directionShipments.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div className="relative flex-1 min-w-0">
                    <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                    <input value={shipmentSearch} onChange={e => { setShipmentSearch(e.target.value); setShipmentPage(1); }}
                      className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                      placeholder="Cari partner, produk, atau catatan…" />
                  </div>
                  <div className="flex items-center gap-2 justify-end flex-shrink-0 w-full sm:w-auto">
                    <ViewToggle mode={shipmentView} onChange={setShipmentView} height={HEADER_BTN_H} />
                    <button onClick={openForm} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                      <Plus size={13} /> <span className="hidden sm:inline">{addLabel}</span>
                    </button>
                  </div>
                </div>
              )}

              {shipmentsLoading && directionShipments.length === 0 ? (
                <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
              ) : directionShipments.length === 0 ? (
                <EmptyState Icon={isReceive ? PackagePlus : Undo2}
                  title={isReceive ? 'Belum ada riwayat penerimaan titipan' : 'Belum ada riwayat retur ke partner'}
                  subtitle={isReceive ? 'Catat barang titipan yang diterima dari partner di sini.' : 'Catat barang titipan yang dikembalikan ke partner di sini.'}
                  actionLabel={`${addLabel} Pertama`} onAction={openForm} />
              ) : (
                <>
                  {paginated.length === 0 ? (
                    <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada riwayat yang cocok.</p></div>
                  ) : shipmentView === 'table' ? (
                    <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                      {paginated.map(s => <div key={s.id} className="px-4 py-3"><ShipmentRow s={s} /></div>)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {paginated.map(s => <div key={s.id} className="card p-4"><ShipmentRow s={s} /></div>)}
                    </div>
                  )}
                  <Pagination total={filteredShipments.length} safePage={safePage} totalPages={totalPages}
                    pageSize={shipmentPageSize} onPageSize={n => { setShipmentPageSize(n); setShipmentPage(1); }}
                    onGoPage={goPage} unit="riwayat" />
                </>
              )}
            </div>
          );
        })()}

        {/* ════ SETTLEMENT ═══════════════════════════════════════ */}
        {subTab === 'settlement' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-4">
            {settlements.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input value={settlementSearch} onChange={e => { setSettlementSearch(e.target.value); setSettlementPage(1); }}
                    className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari nama partner atau catatan…" />
                </div>
                <div className="flex items-center gap-2 justify-end flex-shrink-0 w-full sm:w-auto">
                  <ViewToggle mode={settlementView} onChange={setSettlementView} height={HEADER_BTN_H} />
                  <button onClick={() => openSettleForm()} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                    <Plus size={13} /> <span className="hidden sm:inline">Bayar ke Partner</span>
                  </button>
                </div>
              </div>
            )}

            {settlementsLoading && settlements.length === 0 ? (
              <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
            ) : settlements.length === 0 ? (
              <EmptyState Icon={WalletIcon} title="Belum ada riwayat pembayaran ke partner"
                subtitle="Bayar tagihan produk titipan yang sudah terjual ke partner terkait."
                actionLabel="Bayar ke Partner" onAction={() => openSettleForm()} />
            ) : (
              <>
                {paginatedSettlements.length === 0 ? (
                  <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada riwayat yang cocok.</p></div>
                ) : settlementView === 'table' ? (
                  <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                    {paginatedSettlements.map(s => (
                      <div key={s.id} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.partnerName}</p>
                          <p className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(s.totalPayable)}</p>
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)} {s.note ? `· ${s.note}` : ''}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {paginatedSettlements.map(s => (
                      <div key={s.id} className="card p-4">
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.partnerName}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)}</p>
                        {s.note && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{s.note}&rdquo;</p>}
                        <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Dibayar</span>
                          <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(s.totalPayable)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Pagination total={filteredSettlements.length} safePage={safeSettlementPage} totalPages={totalSettlementPages}
                  pageSize={settlementPageSize} onPageSize={n => { setSettlementPageSize(n); setSettlementPage(1); }}
                  onGoPage={goSettlementPage} unit="settlement" />
              </>
            )}
          </div>
        )}

        {/* ════ ANALITIK ═══════════════════════════════════════ */}
        {subTab === 'analitik' && (
          <div className="p-4 lg:p-6 animate-fade-up">
            <ConsignmentInAnalyticsSection
              data={analyticsData} loading={analyticsLoading}
              period={analyticsPeriod} customFrom={analyticsCustomFrom} customTo={analyticsCustomTo}
              onPeriodChange={setAnalyticsPeriod} onCustomFromChange={setAnalyticsCustomFrom} onCustomToChange={setAnalyticsCustomTo}
              onNavigatePartner={partnerId => { setSubTab('settlement'); openSettleForm(partnerId); }}
            />
          </div>
        )}
      </div>

      {/* ════ MODAL: Tambah/Edit Partner ══════════════════════ */}
      {showPForm && (
        <div className="modal-overlay" onClick={() => !savingP && setShowPForm(false)}>
          <div className="modal-sheet modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Users size={17} /></div>
                <div>
                  <p className="modal-title">{editingP ? 'Edit Partner' : 'Tambah Partner'}</p>
                  <p className="modal-subtitle">Partner yang menitipkan barang untuk dijual di toko</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowPForm(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="field-label">Nama Partner *</label>
                  <input value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })} className="input" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Nama Kontak</label>
                    <input value={pForm.contactName} onChange={e => setPForm({ ...pForm, contactName: e.target.value })} className="input" />
                  </div>
                  <div>
                    <label className="field-label">Telepon</label>
                    <input value={pForm.contactPhone} onChange={e => setPForm({ ...pForm, contactPhone: e.target.value })} className="input" />
                  </div>
                </div>
                <div>
                  <label className="field-label">Alamat</label>
                  <input value={pForm.address} onChange={e => setPForm({ ...pForm, address: e.target.value })} className="input" />
                </div>
                <div className="flex items-center justify-between">
                  <label className="field-label" style={{ marginBottom: 0 }}>Model Settlement Default</label>
                  <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    {(['fixed', 'percentage'] as const).map(st => (
                      <button key={st} type="button" onClick={() => setPForm({ ...pForm, defaultSettlementType: st })}
                        className="text-xs font-semibold" style={{ padding: '5px 10px', background: pForm.defaultSettlementType === st ? 'var(--accent)' : 'transparent', color: pForm.defaultSettlementType === st ? '#fff' : 'var(--text-secondary)' }}>
                        {st === 'fixed' ? 'Harga Tetap' : 'Bagi Hasil %'}
                      </button>
                    ))}
                  </div>
                </div>
                {pForm.defaultSettlementType === 'fixed' ? (
                  <div>
                    <label className="field-label">Harga Beli Titip Default (Rp/pcs)</label>
                    <NumberInput value={pForm.defaultPayoutPrice ?? ''} onChange={raw => setPForm({ ...pForm, defaultPayoutPrice: raw ? Number(raw) : null })} />
                  </div>
                ) : (
                  <div>
                    <label className="field-label">Komisi Toko Default (%)</label>
                    <NumberInput value={pForm.defaultCommissionPct ?? ''} onChange={raw => setPForm({ ...pForm, defaultCommissionPct: raw ? Number(raw) : null })} />
                  </div>
                )}
                <div>
                  <label className="field-label">Catatan</label>
                  <input value={pForm.note} onChange={e => setPForm({ ...pForm, note: e.target.value })} className="input" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowPForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={savePartner} disabled={savingP || !pForm.name.trim()} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingP ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL: Terima Titipan / Retur ke Partner ═════════ */}
      {(showReceiveForm || showReturnForm) && (() => {
        const isReceive = showReceiveForm;
        const partnerId = isReceive ? receivePartnerId : returnPartnerId;
        const setPartnerId = isReceive ? setReceivePartnerId : setReturnPartnerId;
        const warehouseId = isReceive ? receiveWarehouseId : returnWarehouseId;
        const setWarehouseId = isReceive ? setReceiveWarehouseId : setReturnWarehouseId;
        const note = isReceive ? receiveNote : returnNote;
        const setNote = isReceive ? setReceiveNote : setReturnNote;
        const rows = isReceive ? receiveRows : returnRows;
        const setRows = isReceive ? setReceiveRows : setReturnRows;
        const partnerProducts = isReceive ? receivePartnerProducts : returnPartnerProducts;
        const saving = isReceive ? savingReceive : savingReturn;
        const submit = isReceive ? submitReceive : submitReturn;
        const close = () => (isReceive ? setShowReceiveForm : setShowReturnForm)(false);
        const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

        return (
          <div className="modal-overlay" onClick={() => !saving && close()}>
            <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
              <div className="modal-accent" />
              <span className="modal-handle" />
              <div className="modal-header">
                <div className="modal-header-left">
                  <div className="modal-icon">{isReceive ? <PackagePlus size={17} /> : <Undo2 size={17} />}</div>
                  <div>
                    <p className="modal-title">{isReceive ? 'Terima Titipan' : 'Retur ke Partner'}</p>
                    <p className="modal-subtitle">{isReceive ? 'Stok produk titipan bertambah di gudang tujuan' : 'Stok produk titipan berkurang dari gudang asal'}</p>
                  </div>
                </div>
                <Tooltip label="Tutup"><button onClick={close} className="modal-close"><X size={14} /></button></Tooltip>
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="field-label">Partner <span style={{ color: 'var(--danger)' }}>*</span></label>
                      <SearchSelect value={partnerId} onChange={setPartnerId}
                        options={partners.map(p => ({ value: p.id, label: p.name, sublabel: p.code }))}
                        placeholder="– Pilih Partner –" searchPlaceholder="Cari partner…" />
                    </div>
                    <div>
                      <label className="field-label">Gudang {isReceive ? 'Tujuan' : 'Asal'} <span style={{ color: 'var(--danger)' }}>*</span></label>
                      <SearchSelect value={warehouseId} onChange={setWarehouseId}
                        options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                        placeholder="– Pilih Gudang –" searchPlaceholder="Cari gudang…" />
                    </div>
                  </div>

                  {partnerId && partnerProducts.length === 0 && (
                    <p className="text-xs" style={{ color: 'var(--warning)' }}>
                      Partner ini belum punya produk titipan terdaftar. Tambahkan dulu lewat menu Produk (Kepemilikan → Titipan, pilih partner ini).
                    </p>
                  )}

                  <div>
                    <label className="field-label">Produk</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                      {rows.map((row, i) => (
                        <div key={i} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center gap-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={row.productId}
                                onChange={v => setRows(rs => rs.map((r, ri) => ri === i ? { ...r, productId: v } : r))}
                                options={partnerProducts.flatMap(p => p.hasVariants
                                  ? (p.variants ?? []).filter(v => v.isActive).map(v => ({
                                      value: variantKey(p.id, v.id), label: `${p.name} — ${variantOptionsLabel(v.options)}`,
                                    }))
                                  : [{ value: p.id, label: p.name }])}
                                placeholder="– Produk –" searchPlaceholder="Cari produk…" />
                            </div>
                            <div style={{ width: 100 }}>
                              <NumberInput value={row.qty} placeholder="Qty"
                                onChange={raw => setRows(rs => rs.map((r, ri) => ri === i ? { ...r, qty: raw } : r))} />
                            </div>
                            <Tooltip label="Hapus baris">
                              <button onClick={() => setRows(rs => rs.filter((_, ri) => ri !== i))} disabled={rows.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}>
                                <Trash size={14} />
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setRows(rs => [...rs, { ...EMPTY_ROW }])} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                      <Plus size={12} /> Tambah Baris Produk
                    </button>
                  </div>

                  <div>
                    <label className="field-label">Catatan</label>
                    <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Catatan tambahan (opsional)" className="input" />
                  </div>

                  <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
                    <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{totalQty} pcs</span>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button onClick={close} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
                <button onClick={submit} disabled={saving} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : (isReceive ? <PackagePlus size={14} /> : <Undo2 size={14} />)}
                  {saving ? 'Menyimpan…' : (isReceive ? 'Terima Titipan' : 'Retur ke Partner')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ════ MODAL: Bayar ke Partner (Settlement) ═════════════ */}
      {showSettleForm && (
        <div className="modal-overlay" onClick={() => !savingSettle && setShowSettleForm(false)}>
          <div className="modal-sheet modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><WalletIcon size={17} /></div>
                <div>
                  <p className="modal-title">Bayar ke Partner</p>
                  <p className="modal-subtitle">Lunasi tagihan produk titipan yang sudah terjual</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowSettleForm(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="field-label">Partner <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={settleModalPartnerId} onChange={setSettleModalPartnerId}
                    options={partners.map(p => ({ value: p.id, label: p.name, sublabel: p.code }))}
                    placeholder="– Pilih Partner –" searchPlaceholder="Cari partner…" />
                </div>

                {settleModalPartnerId && (
                  ledgerLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="animate-spin" size={18} /></div>
                  ) : ledgerSummary.length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>Tidak ada tagihan belum dibayar untuk partner ini.</p>
                  ) : (
                    <>
                      <div className="p-3 rounded-xl flex flex-col gap-1" style={{ border: '1px solid var(--border-2)' }}>
                        {ledgerSummary.map(row => (
                          <div key={row.productId} className="flex items-center justify-between text-xs">
                            <span style={{ color: 'var(--text-secondary)' }}>{row.productName} × {row.qty}</span>
                            <span className="font-semibold tabular">{formatRp(row.payoutAmount)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Tagihan</span>
                        <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(ledgerTotal)}</span>
                      </div>
                      <div>
                        <label className="field-label">Dompet Pembayaran</label>
                        <SearchSelect value={settleWalletId} onChange={setSettleWalletId}
                          options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                      </div>
                      <div>
                        <label className="field-label">Catatan</label>
                        <input value={settleNote} onChange={e => setSettleNote(e.target.value)} className="input" placeholder="Catatan tambahan (opsional)" />
                      </div>
                    </>
                  )
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowSettleForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={submitSettle} disabled={savingSettle || ledgerEntries.length === 0} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingSettle ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {savingSettle ? 'Menyimpan…' : `Bayar ${ledgerTotal > 0 ? formatRp(ledgerTotal) : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
