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
import ImageUploadBox from '@/components/ImageUploadBox';
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
  id: string; name: string; code: string; contactName: string; contactPhone: string; address: string; note: string; logoUrl?: string;
  defaultSettlementType: 'fixed' | 'percentage'; defaultPayoutPrice: number | null; defaultCommissionPct: number | null;
}
type PartnerForm = Omit<Partner, 'id' | 'code'>;
const EMPTY_PARTNER: PartnerForm = {
  name: '', contactName: '', contactPhone: '', address: '', note: '', logoUrl: '',
  defaultSettlementType: 'fixed', defaultPayoutPrice: null, defaultCommissionPct: null,
};
// Logo partner — thumbnail kalau ada, fallback ikon generik (sama pola dengan LocationLogo di
// ConsignmentTab.tsx untuk Mitra/arah keluar).
function PartnerLogo({ partner, size }: { partner: { name: string; logoUrl?: string }; size: number }) {
  if (partner.logoUrl) {
    return (
      <div className="rounded-xl overflow-hidden flex-shrink-0" style={{ width: size, height: size, background: 'var(--surface)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={partner.logoUrl} alt={partner.name} className="w-full h-full" style={{ objectFit: 'contain' }} />
      </div>
    );
  }
  return (
    <div className="rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-xs"
      style={{ width: size, height: size, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
      {partner.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

interface Warehouse { id: string; name: string }

interface ShipmentItem { productId: string; variantId?: string; productName: string; qty: number }
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
  // Riwayat Terima/Retur/Settlement nyimpan nama partner sebagai snapshot saat dibuat — kalau
  // partnernya belakangan diganti nama, tampilkan nama terkininya (fallback ke snapshot kalau
  // partnernya sudah dihapus) supaya tidak nyangkut nama lama di layar.
  const partnerNameOf = (partnerId: string, fallback: string) => partners.find(p => p.id === partnerId)?.name ?? fallback;
  // Untuk PartnerLogo di riwayat Terima/Retur/Settlement — partnernya mungkin sudah dihapus,
  // fallback ke nama snapshot tanpa logo (bukan logo lama yang mungkin sudah tidak relevan).
  const partnerLogoOf = (partnerId: string, fallback: string) => partners.find(p => p.id === partnerId) ?? { name: fallback, logoUrl: undefined };
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
  const [logoUploading, setLogoUploading] = useState(false);

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
      name: p.name, contactName: p.contactName, contactPhone: p.contactPhone, address: p.address, note: p.note, logoUrl: p.logoUrl ?? '',
      defaultSettlementType: p.defaultSettlementType, defaultPayoutPrice: p.defaultPayoutPrice, defaultCommissionPct: p.defaultCommissionPct,
    });
    setShowPForm(true);
  };
  const uploadPartnerLogo = async (file?: File) => {
    if (!file) return;
    setLogoUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale  = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
      const blob: Blob = await new Promise(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.85));
      const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers: { 'x-admin-auth': creds }, body: form });
      if (!r.ok) throw new Error('upload failed');
      const { url } = await r.json() as { url: string };
      setPForm(f => ({ ...f, logoUrl: url }));
    } catch {
      toast.error('Gagal mengunggah logo partner.');
    } finally {
      setLogoUploading(false);
    }
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
  // `editingShipmentId` dipakai bareng oleh form Terima & Retur — non-null berarti modal sedang
  // mengedit riwayat itu (PUT ke shipments/[id]), null berarti bikin baru (POST ke receive/return).
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
  const [deletingShipmentId, setDeletingShipmentId] = useState<string | null>(null);

  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [receivePartnerId, setReceivePartnerId] = useState('');
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');
  const [receiveNote, setReceiveNote] = useState('');
  const [receiveRows, setReceiveRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [savingReceive, setSavingReceive] = useState(false);
  const receivePartnerProducts = consignedInProducts.filter(p => p.consignorId === receivePartnerId);

  const openReceiveForm = () => {
    setEditingShipmentId(null);
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
    const warehouse = warehouses.find(w => w.id === receiveWarehouseId);
    const isEdit = !!editingShipmentId;
    const r = isEdit
      ? await fetch(`${API}/api/consignment-in/shipments/${editingShipmentId}`, {
          method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ warehouseId: receiveWarehouseId, warehouseName: warehouse?.name ?? '', note: receiveNote, items }),
        })
      : await fetch(`${API}/api/consignment-in/receive`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partnerId: receivePartnerId, partnerName: partners.find(p => p.id === receivePartnerId)?.name ?? '',
            warehouseId: receiveWarehouseId, warehouseName: warehouse?.name ?? '',
            note: receiveNote, items,
          }),
        });
    if (r.ok) {
      toast.success(isEdit ? 'Perubahan berhasil disimpan.' : 'Penerimaan titipan berhasil disimpan.');
      setShowReceiveForm(false); setEditingShipmentId(null);
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
    setEditingShipmentId(null);
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
    const warehouse = warehouses.find(w => w.id === returnWarehouseId);
    const isEdit = !!editingShipmentId;
    const r = isEdit
      ? await fetch(`${API}/api/consignment-in/shipments/${editingShipmentId}`, {
          method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ warehouseId: returnWarehouseId, warehouseName: warehouse?.name ?? '', note: returnNote, items }),
        })
      : await fetch(`${API}/api/consignment-in/return`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partnerId: returnPartnerId, partnerName: partners.find(p => p.id === returnPartnerId)?.name ?? '',
            warehouseId: returnWarehouseId, warehouseName: warehouse?.name ?? '',
            note: returnNote, items,
          }),
        });
    if (r.ok) {
      toast.success(isEdit ? 'Perubahan berhasil disimpan.' : 'Retur ke partner berhasil disimpan.');
      setShowReturnForm(false); setEditingShipmentId(null);
      await loadShipments();
    } else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan.'); }
    setSavingReturn(false);
  };

  const openEditShipment = (s: Shipment) => {
    setEditingShipmentId(s.id);
    // Riwayat lama (dicatat sebelum produknya punya varian) tersimpan tanpa variantId — begitu
    // produk itu belakangan diaktifkan variannya, dropdown produk cuma nawarin pilihan per-varian
    // (lihat options di bawah), jadi productId polos ini tidak match opsi manapun & tampil kosong.
    // Kalau variannya cuma satu yang aktif, itu jelas maksudnya — auto-pilihkan; kalau ambigu (0
    // atau >1 varian aktif) biarkan kosong supaya user pilih manual, jangan menebak.
    const rows: Row[] = s.items.length > 0
      ? s.items.map(it => {
          if (!it.variantId) {
            const product = consignedInProducts.find(p => p.id === it.productId);
            const activeVariants = product?.hasVariants ? (product.variants ?? []).filter(v => v.isActive) : [];
            if (activeVariants.length === 1) {
              return { productId: variantKey(it.productId, activeVariants[0].id), qty: String(it.qty) };
            }
          }
          return { productId: variantKey(it.productId, it.variantId), qty: String(it.qty) };
        })
      : [{ ...EMPTY_ROW }];
    if (s.direction === 'in') {
      setReceivePartnerId(s.partnerId); setReceiveWarehouseId(s.warehouseId ?? ''); setReceiveNote(s.note ?? ''); setReceiveRows(rows);
      setShowReceiveForm(true);
    } else {
      setReturnPartnerId(s.partnerId); setReturnWarehouseId(s.warehouseId ?? ''); setReturnNote(s.note ?? ''); setReturnRows(rows);
      setShowReturnForm(true);
    }
  };
  // Retur (out) selalu aman dihapus (efeknya cuma nambah stok balik). Terima (in) mengurangi stok
  // saat dihapus — kalau stok yang tersisa sekarang sudah kurang dari qty riwayat ini (sudah
  // kepakai/dijual/produknya hilang), backend bakal nolak (lihat DELETE di
  // consignment-in/shipments/[id]/route.ts) — cek duluan di sini biar tombolnya langsung disabled,
  // bukan nunggu user klik lalu kena toast error.
  const canDeleteShipment = (s: Shipment): boolean => {
    if (s.direction !== 'in') return true;
    return s.items.every(it => {
      const product = consignedInProducts.find(p => p.id === it.productId);
      if (!product) return false;
      if (it.variantId) {
        const variant = (product.variants ?? []).find(v => v.id === it.variantId);
        return !!variant && variant.stockQty >= it.qty;
      }
      return (product.stockQty ?? 0) >= it.qty;
    });
  };
  const deleteShipment = async (s: Shipment) => {
    const label = s.direction === 'in' ? 'penerimaan titipan' : 'retur ke partner';
    if (!await confirm({ message: `Hapus riwayat ${label} ini? Stok akan dikembalikan seperti sebelum riwayat ini dibuat.`, danger: true })) return;
    setDeletingShipmentId(s.id);
    const r = await fetch(`${API}/api/consignment-in/shipments/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) { toast.success('Riwayat berhasil dihapus.'); await loadShipments(); }
    else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menghapus riwayat.'); }
    setDeletingShipmentId(null);
  };

  // ── Riwayat Terima/Retur ─────────────────────────────────────────
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(true);
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [shipmentView, setShipmentView] = useViewMode('consignment-in-shipments', 'card');
  const [shipmentPage, setShipmentPage] = useState(1);
  const [shipmentPageSize, setShipmentPageSize] = useState(10);
  const [selectedShipments, setSelectedShipments] = useState<Set<string>>(new Set());
  const [expandedShipmentId, setExpandedShipmentId] = useState<string | null>(null);
  const [exportingShipmentsExcel, setExportingShipmentsExcel] = useState(false);
  const [exportingShipmentsPdf, setExportingShipmentsPdf] = useState(false);
  const loadShipments = async () => {
    setShipmentsLoading(true);
    const r = await fetch(`${API}/api/consignment-in/shipments`, { headers });
    if (r.ok) setShipments((await r.json() as { shipments: Shipment[] }).shipments);
    setShipmentsLoading(false);
  };
  useEffect(() => { loadShipments(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setShipmentSearch(''); setShipmentPage(1); setSelectedShipments(new Set()); }, [subTab]);

  const toggleShipmentSelect = (id: string) =>
    setSelectedShipments(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleShipmentPageAll = (pageIds: string[]) => {
    const allSelected = pageIds.every(id => selectedShipments.has(id));
    setSelectedShipments(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const exportShipmentsExcel = async (rows: Shipment[], label: string, direction: 'in' | 'out') => {
    if (rows.length === 0) { toast.error('Tidak ada riwayat untuk diexport.'); return; }
    setExportingShipmentsExcel(true);
    try {
      const isReceive = direction === 'in';
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet(isReceive ? 'Terima Titipan' : 'Retur Partner');

      const COLS = [
        { header: 'No',        key: 'no',        width: 6  },
        { header: 'Partner',   key: 'partner',   width: 24 },
        { header: 'Tanggal',   key: 'date',      width: 20 },
        { header: 'Gudang',    key: 'warehouse', width: 18 },
        { header: 'Produk',    key: 'items',     width: 40 },
        { header: 'Total Qty', key: 'qty',       width: 12 },
        { header: 'Catatan',   key: 'note',      width: 24 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = `LAPORAN ${isReceive ? 'PENERIMAAN TITIPAN' : 'RETUR KE PARTNER'} — CEMILAN TEH RISMA`;
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} riwayat (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((s, i) => {
        const totalQty = s.items.reduce((sum, it) => sum + it.qty, 0);
        const row = ws.addRow({
          no: i + 1, partner: partnerNameOf(s.partnerId, s.partnerName), date: formatDate(s.createdAt?.seconds),
          warehouse: s.warehouseName || '-', items: s.items.map(it => `${it.productName} (${it.qty})`).join(', '),
          qty: totalQty, note: s.note || '-',
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
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('qty').alignment = { horizontal: 'right', vertical: 'middle' };
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
      a.href = url; a.download = `${isReceive ? 'terima-titipan' : 'retur-partner'}-${today}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} riwayat (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingShipmentsExcel(false);
    }
  };

  const exportShipmentsPdf = async (rows: Shipment[], label: string, direction: 'in' | 'out') => {
    if (rows.length === 0) { toast.error('Tidak ada riwayat untuk diexport.'); return; }
    setExportingShipmentsPdf(true);
    try {
      const isReceive = direction === 'in';
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: isReceive ? 'RIWAYAT PENERIMAAN TITIPAN' : 'RIWAYAT RETUR KE PARTNER',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '5%', align: 'center' },
              { header: 'Partner', width: '18%', bold: true },
              { header: 'Tanggal', width: '16%' },
              { header: 'Gudang', width: '14%' },
              { header: 'Produk', width: '35%' },
              { header: 'Qty', width: '12%', align: 'right' },
            ],
            rows: rows.map((s, i) => [
              i + 1,
              partnerNameOf(s.partnerId, s.partnerName),
              formatDate(s.createdAt?.seconds),
              s.warehouseName || '-',
              s.items.map(it => `${it.productName} (${it.qty})`).join(', '),
              s.items.reduce((sum, it) => sum + it.qty, 0),
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url; a.download = `${isReceive ? 'terima-titipan' : 'retur-partner'}-${today}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} riwayat (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingShipmentsPdf(false);
    }
  };

  // ── Import Excel Terima/Retur — beda dari import Partner: tiap baris harus dicocokkan ke
  // partner/gudang/produk yang sudah ada (bukan entitas datar), jadi parsing dilakukan client-side
  // (semua data referensi sudah ada di state) lalu ditampilkan sebagai PREVIEW dulu — user harus
  // konfirmasi sebelum baris yang cocok benar-benar dikirim ke endpoint receive/return (yang sama
  // dipakai form manual), supaya salah cocok produk/partner tidak langsung menggeser stok.
  interface ImportShipmentRow {
    rowNumber: number; partnerRaw: string; warehouseRaw: string; productRaw: string; qtyRaw: string; noteRaw: string;
    partnerId?: string; partnerName?: string; warehouseId?: string; warehouseName?: string;
    productId?: string; productName?: string; qty: number; date: string; note: string; error?: string;
  }
  const SHIPMENT_TEMPLATE_COLS = [
    { header: 'Partner (Kode/Nama)*', key: 'partner', width: 22 },
    { header: 'Gudang*',              key: 'warehouse', width: 18 },
    { header: 'Tanggal (YYYY-MM-DD)', key: 'date',      width: 16 },
    { header: 'Produk (Nama)*',       key: 'product',   width: 28 },
    { header: 'Qty*',                 key: 'qty',       width: 10 },
    { header: 'Catatan',              key: 'note',      width: 24 },
  ] as const;

  const [importingShipments, setImportingShipments] = useState(false);
  const [shipmentImportPreview, setShipmentImportPreview] = useState<{ direction: 'in' | 'out'; rows: ImportShipmentRow[] } | null>(null);
  const [confirmingShipmentImport, setConfirmingShipmentImport] = useState(false);
  const shipmentImportFileRef = useRef<HTMLInputElement>(null);

  const downloadShipmentTemplate = async (direction: 'in' | 'out') => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin'; wb.created = new Date();
    const ws = wb.addWorksheet(direction === 'in' ? 'Template Terima' : 'Template Retur');
    const colCount = SHIPMENT_TEMPLATE_COLS.length;
    ws.columns = SHIPMENT_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `TEMPLATE IMPORT ${direction === 'in' ? 'TERIMA TITIPAN' : 'RETUR KE PARTNER'} — CEMILAN TEH RISMA`;
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Partner diisi Kode atau Nama persis seperti di menu Partner. '
      + 'Produk diisi Nama persis seperti di menu Produk — harus produk titipan partner tsb, dan TIDAK BOLEH produk yang punya varian (tambahkan varian itu manual lewat tombol Tambah). '
      + 'Baris dengan Partner + Gudang + Tanggal yang sama akan digabung jadi satu riwayat berisi beberapa produk. Tanggal kosong = hari ini. '
      + 'Setelah upload, akan ada halaman PREVIEW untuk cek baris mana yang cocok sebelum benar-benar disimpan.';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 58;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    SHIPMENT_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
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
      partner: partners[0]?.code || partners[0]?.name || 'TMK001',
      warehouse: warehouses[0]?.name ?? 'Gudang Utama',
      date: new Date().toISOString().slice(0, 10),
      product: 'Contoh — timpa dengan nama produk titipan Anda',
      qty: 10, note: '',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = direction === 'in' ? 'template-terima-titipan.xlsx' : 'template-retur-titipan.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  function detectShipmentColumn(header: string): 'partner' | 'warehouse' | 'date' | 'product' | 'qty' | 'note' | null {
    const h = header.toLowerCase();
    if (h.includes('partner')) return 'partner';
    if (h.includes('gudang')) return 'warehouse';
    if (h.includes('tanggal')) return 'date';
    if (h.includes('produk')) return 'product';
    if (h.includes('qty') || h.includes('jumlah')) return 'qty';
    if (h.includes('catatan')) return 'note';
    return null;
  }
  const matchPartnerByText = (raw: string) => {
    const q = raw.trim().toLowerCase();
    if (!q) return undefined;
    return partners.find(p => p.code.toLowerCase() === q) ?? partners.find(p => p.name.toLowerCase() === q);
  };
  const matchWarehouseByText = (raw: string) => {
    const q = raw.trim().toLowerCase();
    if (!q) return undefined;
    return warehouses.find(w => w.name.toLowerCase() === q);
  };
  const matchConsignedProductByText = (partnerId: string, raw: string) => {
    const q = raw.trim().toLowerCase();
    if (!q) return undefined;
    return consignedInProducts.filter(p => p.consignorId === partnerId).find(p => p.name.toLowerCase() === q);
  };

  const parseShipmentExcel = async (file: File, direction: 'in' | 'out') => {
    setImportingShipments(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, 'partner' | 'warehouse' | 'date' | 'product' | 'qty' | 'note'>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, 'partner' | 'warehouse' | 'date' | 'product' | 'qty' | 'note'>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectShipmentColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('partner') && fields.has('product')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Partner" dan "Produk" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: ImportShipmentRow[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw: Record<'partner' | 'warehouse' | 'date' | 'product' | 'qty' | 'note', string> = { partner: '', warehouse: '', date: '', product: '', qty: '', note: '' };
        let dateObj: Date | null = null;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          if (field === 'date' && cell.value instanceof Date) { dateObj = cell.value; return; }
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (!raw.partner.trim() && !raw.product.trim()) return; // baris kosong dilewati

        const partner = matchPartnerByText(raw.partner);
        const warehouse = matchWarehouseByText(raw.warehouse);
        const qty = Number(raw.qty.replace(/[^0-9.-]/g, '')) || 0;
        const date = dateObj ? (dateObj as Date).toISOString().slice(0, 10) : (raw.date.trim() || new Date().toISOString().slice(0, 10));
        const product = partner ? matchConsignedProductByText(partner.id, raw.product) : undefined;
        const productHasVariants = partner && !product
          ? consignedInProducts.filter(p => p.consignorId === partner.id).find(p => p.name.toLowerCase() === raw.product.trim().toLowerCase())?.hasVariants
          : false;

        const errors: string[] = [];
        if (!raw.partner.trim()) errors.push('Partner kosong');
        else if (!partner) errors.push(`Partner "${raw.partner}" tidak ditemukan`);
        if (!raw.warehouse.trim()) errors.push('Gudang kosong');
        else if (!warehouse) errors.push(`Gudang "${raw.warehouse}" tidak ditemukan`);
        if (!raw.product.trim()) errors.push('Produk kosong');
        else if (productHasVariants) errors.push('Produk ini punya varian — tidak didukung import');
        else if (!product) errors.push(`Produk "${raw.product}" tidak ditemukan / bukan titipan partner ini`);
        if (qty <= 0) errors.push('Qty harus > 0');

        rows.push({
          rowNumber, partnerRaw: raw.partner, warehouseRaw: raw.warehouse, productRaw: raw.product, qtyRaw: raw.qty, noteRaw: raw.note,
          partnerId: partner?.id, partnerName: partner?.name, warehouseId: warehouse?.id, warehouseName: warehouse?.name,
          productId: product?.id, productName: product?.name, qty, date, note: raw.note,
          error: errors.length > 0 ? errors.join('; ') : undefined,
        });
      });

      if (rows.length === 0) { toast.error('Tidak ada baris data pada file tersebut.'); return; }
      setShipmentImportPreview({ direction, rows });
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImportingShipments(false);
    }
  };

  const confirmShipmentImport = async () => {
    if (!shipmentImportPreview) return;
    const { direction, rows } = shipmentImportPreview;
    const validRows = rows.filter(r => !r.error);
    if (validRows.length === 0) { toast.error('Tidak ada baris valid untuk diimpor.'); return; }
    setConfirmingShipmentImport(true);

    const groups = new Map<string, { partnerId: string; partnerName: string; warehouseId: string; warehouseName: string; date: string; note: string; items: { productId: string; productName: string; qty: number }[] }>();
    for (const r of validRows) {
      const key = `${r.partnerId}__${r.warehouseId}__${r.date}`;
      let g = groups.get(key);
      if (!g) { g = { partnerId: r.partnerId!, partnerName: r.partnerName!, warehouseId: r.warehouseId!, warehouseName: r.warehouseName!, date: r.date, note: r.note, items: [] }; groups.set(key, g); }
      if (!g.note && r.note) g.note = r.note;
      const existing = g.items.find(it => it.productId === r.productId);
      if (existing) existing.qty += r.qty;
      else g.items.push({ productId: r.productId!, productName: r.productName!, qty: r.qty });
    }

    let success = 0, failed = 0;
    const failMessages: string[] = [];
    for (const g of groups.values()) {
      const res = await fetch(`${API}/api/consignment-in/${direction === 'in' ? 'receive' : 'return'}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: g.partnerId, partnerName: g.partnerName, warehouseId: g.warehouseId, warehouseName: g.warehouseName, note: g.note, items: g.items, date: g.date }),
      });
      if (res.ok) success += 1;
      else { failed += 1; const d = await res.json().catch(() => ({ error: undefined })) as { error?: string }; failMessages.push(`${g.partnerName} (${g.date}): ${d.error ?? 'gagal'}`); }
    }

    setConfirmingShipmentImport(false);
    setShipmentImportPreview(null);
    await loadShipments();
    if (failed === 0) toast.success(`${success} riwayat berhasil diimpor.`);
    else toast.error(`${success} berhasil, ${failed} gagal: ${failMessages.slice(0, 3).join(' | ')}${failMessages.length > 3 ? ' …' : ''}`);
  };

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
  const [selectedSettlements, setSelectedSettlements] = useState<Set<string>>(new Set());
  const [expandedSettlementId, setExpandedSettlementId] = useState<string | null>(null);
  const [exportingSettlementsExcel, setExportingSettlementsExcel] = useState(false);
  const [exportingSettlementsPdf, setExportingSettlementsPdf] = useState(false);
  const [deletingSettlementId, setDeletingSettlementId] = useState<string | null>(null);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(null);
  const [editSettleWalletId, setEditSettleWalletId] = useState('');
  const [editSettleNote, setEditSettleNote] = useState('');
  const [savingEditSettle, setSavingEditSettle] = useState(false);

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

  const openEditSettlement = (s: Settlement) => {
    setEditingSettlement(s); setEditSettleWalletId(s.walletId ?? ''); setEditSettleNote(s.note ?? '');
  };
  const submitEditSettlement = async () => {
    if (!editingSettlement) return;
    setSavingEditSettle(true);
    const r = await fetch(`${API}/api/consignment-in/settle/${editingSettlement.id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletId: editSettleWalletId || null, note: editSettleNote }),
    });
    if (r.ok) {
      toast.success('Perubahan berhasil disimpan.');
      setEditingSettlement(null);
      await loadSettlements();
    } else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan perubahan.'); }
    setSavingEditSettle(false);
  };
  const deleteSettlement = async (s: Settlement) => {
    if (!await confirm({
      message: `Hapus settlement "${partnerNameOf(s.partnerId, s.partnerName)}" sebesar ${formatRp(s.totalPayable)}? Tagihan yang sudah dibayar ini akan kembali jadi belum dibayar, dan entri Pengeluaran terkait akan ikut terhapus.`,
      danger: true,
    })) return;
    setDeletingSettlementId(s.id);
    const r = await fetch(`${API}/api/consignment-in/settle/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) { toast.success('Settlement berhasil dihapus — tagihan kembali ke status belum dibayar.'); await loadSettlements(); }
    else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menghapus settlement.'); }
    setDeletingSettlementId(null);
  };

  useEffect(() => { setSelectedSettlements(new Set()); }, [subTab]);

  const toggleSettlementSelect = (id: string) =>
    setSelectedSettlements(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSettlementPageAll = () => {
    const pageIds = paginatedSettlements.map(s => s.id);
    const allSelected = pageIds.every(id => selectedSettlements.has(id));
    setSelectedSettlements(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const exportSettlementsExcel = async (rows: Settlement[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada settlement untuk diexport.'); return; }
    setExportingSettlementsExcel(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Settlement');

      const COLS = [
        { header: 'No',      key: 'no',      width: 6  },
        { header: 'Partner', key: 'partner', width: 24 },
        { header: 'Tanggal', key: 'date',    width: 20 },
        { header: 'Produk',  key: 'items',   width: 40 },
        { header: 'Total Dibayar', key: 'total', width: 16 },
        { header: 'Catatan', key: 'note',    width: 24 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN SETTLEMENT TITIP JUAL — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} settlement (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((s, i) => {
        const row = ws.addRow({
          no: i + 1, partner: partnerNameOf(s.partnerId, s.partnerName), date: formatDate(s.createdAt?.seconds),
          items: s.items.map(it => `${it.productName} (${it.qty})`).join(', '),
          total: s.totalPayable, note: s.note || '-',
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
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('total').numFmt = '"Rp"#,##0';
        row.getCell('total').alignment = { horizontal: 'right', vertical: 'middle' };
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
      a.href = url; a.download = `settlement-titip-jual-${today}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} settlement (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingSettlementsExcel(false);
    }
  };

  const exportSettlementsPdf = async (rows: Settlement[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada settlement untuk diexport.'); return; }
    setExportingSettlementsPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'RIWAYAT SETTLEMENT TITIP JUAL',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '5%', align: 'center' },
              { header: 'Partner', width: '20%', bold: true },
              { header: 'Tanggal', width: '18%' },
              { header: 'Produk', width: '37%' },
              { header: 'Total Dibayar', width: '20%', align: 'right' },
            ],
            rows: rows.map((s, i) => [
              i + 1,
              partnerNameOf(s.partnerId, s.partnerName),
              formatDate(s.createdAt?.seconds),
              s.items.map(it => `${it.productName} (${it.qty})`).join(', '),
              formatRp(s.totalPayable),
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url; a.download = `settlement-titip-jual-${today}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} settlement (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingSettlementsPdf(false);
    }
  };

  const filteredSettlements = settlements.filter(s => {
    const q = settlementSearch.toLowerCase();
    if (!q) return true;
    return partnerNameOf(s.partnerId, s.partnerName).toLowerCase().includes(q) || (s.note ?? '').toLowerCase().includes(q);
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

  // ── Baris tabel/kartu produk item (dipakai Terima & Retur, tampilan sama) — ringkasan saja,
  // rincian produk/catatan dipindah ke renderShipmentDetail (buka lewat chevron), sama pola
  // dengan renderDetail produk di ProductsTab.
  function ShipmentRow({ s }: { s: Shipment }) {
    const totalQty = s.items.reduce((sum, it) => sum + it.qty, 0);
    const partnerName = partnerNameOf(s.partnerId, s.partnerName);
    return (
      <>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{partnerName}</p>
          </div>
          <span className="text-sm font-bold tabular" style={{ color: 'var(--text-primary)' }}>{totalQty} pcs</span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)} · {s.warehouseName}</p>
      </>
    );
  }
  const renderShipmentDetail = (s: Shipment) => (
    <div className="px-4 pb-3 pt-2 space-y-1.5" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <ul className="space-y-1">
        {s.items.map((it, i) => (
          <li key={i} className="flex justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>{it.productName}</span>
            <span className="tabular font-semibold">{it.qty} pcs</span>
          </li>
        ))}
      </ul>
      {s.note && <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{s.note}&rdquo;</p>}
    </div>
  );
  const renderSettlementDetail = (s: Settlement) => (
    <div className="px-4 pb-3 pt-2 space-y-1.5" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <ul className="space-y-1">
        {s.items.map((it, i) => (
          <li key={i} className="flex justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>{it.productName} × {it.qty}</span>
            <span className="tabular font-semibold">{formatRp(it.payoutAmount)}</span>
          </li>
        ))}
      </ul>
      {s.note && <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{s.note}&rdquo;</p>}
    </div>
  );

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
                            <PartnerLogo partner={p} size={36} />
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
                              <PartnerLogo partner={p} size={36} />
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
            const partnerName = partnerNameOf(s.partnerId, s.partnerName);
            return partnerName.toLowerCase().includes(q) || (s.note ?? '').toLowerCase().includes(q)
              || s.items.some(it => it.productName.toLowerCase().includes(q));
          });
          const totalPages = Math.max(1, Math.ceil(filteredShipments.length / shipmentPageSize));
          const safePage = Math.min(shipmentPage, totalPages);
          const paginated = filteredShipments.slice((safePage - 1) * shipmentPageSize, safePage * shipmentPageSize);
          const goPage = (p: number) => setShipmentPage(Math.max(1, Math.min(p, totalPages)));
          const openForm = isReceive ? openReceiveForm : openReturnForm;
          const addLabel = isReceive ? 'Terima Titipan' : 'Retur ke Partner';
          const pageIds = paginated.map(s => s.id);

          return (
            <>
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
                    <Tooltip label="Unduh Template">
                      <button onClick={() => downloadShipmentTemplate(direction)} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                        <ExcelIcon size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip label={importingShipments ? 'Mengimpor…' : 'Upload Excel'}>
                      <button onClick={() => shipmentImportFileRef.current?.click()} disabled={importingShipments} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                        {importingShipments ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      </button>
                    </Tooltip>
                    <input ref={shipmentImportFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) parseShipmentExcel(f, direction); e.target.value = ''; }} />
                    <Tooltip label="Export Excel">
                      <button onClick={() => exportShipmentsExcel(filteredShipments, 'sesuai filter', direction)} disabled={exportingShipmentsExcel} aria-label="Export Excel"
                        className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                        {exportingShipmentsExcel ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                      </button>
                    </Tooltip>
                    <Tooltip label="Export PDF">
                      <button onClick={() => exportShipmentsPdf(filteredShipments, 'sesuai filter', direction)} disabled={exportingShipmentsPdf} aria-label="Export PDF"
                        className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                        {exportingShipmentsPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                      </button>
                    </Tooltip>
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
                  ) : (
                    <>
                      <div className="flex items-center gap-3 px-4 py-2.5 card"
                        style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                        <Checkbox
                          checked={pageIds.every(id => selectedShipments.has(id))}
                          indeterminate={pageIds.some(id => selectedShipments.has(id)) && !pageIds.every(id => selectedShipments.has(id))}
                          onChange={() => toggleShipmentPageAll(pageIds)}
                        />
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                          {selectedShipments.size > 0 ? `${selectedShipments.size} dipilih` : `${paginated.length} riwayat di halaman ini`}
                        </span>
                      </div>
                      {shipmentView === 'table' ? (
                        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                          {paginated.map((s, idx) => {
                            const rowNum = (safePage - 1) * (Number.isFinite(shipmentPageSize) ? shipmentPageSize : 0) + idx + 1;
                            const isExpanded = expandedShipmentId === s.id;
                            return (
                              <div key={s.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                                <div className="flex items-start gap-3 px-4 py-3"
                                  style={{ background: selectedShipments.has(s.id) ? 'rgba(212,105,30,0.05)' : undefined }}>
                                  <div className="pt-0.5"><Checkbox checked={selectedShipments.has(s.id)} onChange={() => toggleShipmentSelect(s.id)} /></div>
                                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-1" style={{ color: 'var(--text-muted)' }}>
                                    {rowNum}
                                  </span>
                                  <PartnerLogo partner={partnerLogoOf(s.partnerId, s.partnerName)} size={32} />
                                  <div className="flex-1 min-w-0"><ShipmentRow s={s} /></div>
                                  <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                                    <Tooltip label="Edit"><button onClick={() => openEditShipment(s)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}><Pencil size={12} /></button></Tooltip>
                                    <Tooltip label={canDeleteShipment(s) ? 'Hapus' : 'Tidak bisa dihapus — stok sudah terpakai'}>
                                      <button onClick={() => deleteShipment(s)} disabled={deletingShipmentId === s.id || !canDeleteShipment(s)}
                                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                                        style={{ background: 'var(--danger-bg)', color: 'var(--danger)', opacity: canDeleteShipment(s) ? 1 : 0.4, cursor: canDeleteShipment(s) ? 'pointer' : 'not-allowed' }}>
                                        {deletingShipmentId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                      </button>
                                    </Tooltip>
                                    <Tooltip label="Lihat detail">
                                      <button onClick={() => setExpandedShipmentId(isExpanded ? null : s.id)} className="btn-ghost p-2">
                                        <ChevronRight size={13} style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                                      </button>
                                    </Tooltip>
                                  </div>
                                </div>
                                {isExpanded && renderShipmentDetail(s)}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {paginated.map((s, idx) => {
                            const rowNum = (safePage - 1) * (Number.isFinite(shipmentPageSize) ? shipmentPageSize : 0) + idx + 1;
                            const isExpanded = expandedShipmentId === s.id;
                            return (
                              <div key={s.id} className="card overflow-hidden" style={{ background: selectedShipments.has(s.id) ? 'rgba(212,105,30,0.05)' : undefined }}>
                                <div className="p-4 flex items-start gap-2">
                                  <div className="pt-0.5"><Checkbox checked={selectedShipments.has(s.id)} onChange={() => toggleShipmentSelect(s.id)} /></div>
                                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-1" style={{ color: 'var(--text-muted)' }}>
                                    {rowNum}
                                  </span>
                                  <PartnerLogo partner={partnerLogoOf(s.partnerId, s.partnerName)} size={32} />
                                  <div className="flex-1 min-w-0"><ShipmentRow s={s} /></div>
                                  <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                                    <Tooltip label="Edit"><button onClick={() => openEditShipment(s)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}><Pencil size={12} /></button></Tooltip>
                                    <Tooltip label={canDeleteShipment(s) ? 'Hapus' : 'Tidak bisa dihapus — stok sudah terpakai'}>
                                      <button onClick={() => deleteShipment(s)} disabled={deletingShipmentId === s.id || !canDeleteShipment(s)}
                                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                                        style={{ background: 'var(--danger-bg)', color: 'var(--danger)', opacity: canDeleteShipment(s) ? 1 : 0.4, cursor: canDeleteShipment(s) ? 'pointer' : 'not-allowed' }}>
                                        {deletingShipmentId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                      </button>
                                    </Tooltip>
                                  </div>
                                </div>
                                <button onClick={() => setExpandedShipmentId(isExpanded ? null : s.id)}
                                  className="w-full flex items-center justify-center gap-1 text-xs font-semibold px-4 py-1.5"
                                  style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-2)' }}>
                                  Detail <ChevronRight size={12} style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                                </button>
                                {isExpanded && renderShipmentDetail(s)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                  <Pagination total={filteredShipments.length} safePage={safePage} totalPages={totalPages}
                    pageSize={shipmentPageSize} onPageSize={n => { setShipmentPageSize(n); setShipmentPage(1); }}
                    onGoPage={goPage} unit="riwayat" />
                </>
              )}
            </div>

            {selectedShipments.size > 0 && (
              <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
                <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
                  style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
                  <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedShipments.size} dipilih</span>
                  <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
                  <button onClick={() => exportShipmentsExcel(directionShipments.filter(s => selectedShipments.has(s.id)), 'terpilih', direction)} disabled={exportingShipmentsExcel}
                    className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                    style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                    {exportingShipmentsExcel ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
                    Export
                  </button>
                  <button onClick={() => exportShipmentsPdf(directionShipments.filter(s => selectedShipments.has(s.id)), 'terpilih', direction)} disabled={exportingShipmentsPdf}
                    className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                    style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                    {exportingShipmentsPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
                    PDF
                  </button>
                  <button onClick={() => setSelectedShipments(new Set())}
                    className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
                    Batal
                  </button>
                </div>
              </div>
            )}
            </>
          );
        })()}

        {/* ════ SETTLEMENT ═══════════════════════════════════════ */}
        {subTab === 'settlement' && (
          <>
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
                  <Tooltip label="Export Excel">
                    <button onClick={() => exportSettlementsExcel(filteredSettlements, 'sesuai filter')} disabled={exportingSettlementsExcel} aria-label="Export Excel"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingSettlementsExcel ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                    </button>
                  </Tooltip>
                  <Tooltip label="Export PDF">
                    <button onClick={() => exportSettlementsPdf(filteredSettlements, 'sesuai filter')} disabled={exportingSettlementsPdf} aria-label="Export PDF"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingSettlementsPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                    </button>
                  </Tooltip>
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
                ) : (
                  <>
                    <div className="flex items-center gap-3 px-4 py-2.5 card"
                      style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                      <Checkbox
                        checked={paginatedSettlements.every(s => selectedSettlements.has(s.id))}
                        indeterminate={paginatedSettlements.some(s => selectedSettlements.has(s.id)) && !paginatedSettlements.every(s => selectedSettlements.has(s.id))}
                        onChange={toggleSettlementPageAll}
                      />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {selectedSettlements.size > 0 ? `${selectedSettlements.size} dipilih` : `${paginatedSettlements.length} settlement di halaman ini`}
                      </span>
                    </div>
                    {settlementView === 'table' ? (
                      <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                        {paginatedSettlements.map((s, idx) => {
                          const rowNum = (safeSettlementPage - 1) * (Number.isFinite(settlementPageSize) ? settlementPageSize : 0) + idx + 1;
                          const isExpanded = expandedSettlementId === s.id;
                          return (
                            <div key={s.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                              <div className="flex items-start gap-3 px-4 py-3"
                                style={{ background: selectedSettlements.has(s.id) ? 'rgba(212,105,30,0.05)' : undefined }}>
                                <div className="pt-0.5"><Checkbox checked={selectedSettlements.has(s.id)} onChange={() => toggleSettlementSelect(s.id)} /></div>
                                <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-1" style={{ color: 'var(--text-muted)' }}>
                                  {rowNum}
                                </span>
                                <PartnerLogo partner={partnerLogoOf(s.partnerId, s.partnerName)} size={32} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{partnerNameOf(s.partnerId, s.partnerName)}</p>
                                    <p className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(s.totalPayable)}</p>
                                  </div>
                                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)}</p>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                                  <Tooltip label="Edit"><button onClick={() => openEditSettlement(s)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}><Pencil size={12} /></button></Tooltip>
                                  <Tooltip label="Hapus">
                                    <button onClick={() => deleteSettlement(s)} disabled={deletingSettlementId === s.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                                      {deletingSettlementId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                    </button>
                                  </Tooltip>
                                  <Tooltip label="Lihat detail">
                                    <button onClick={() => setExpandedSettlementId(isExpanded ? null : s.id)} className="btn-ghost p-2">
                                      <ChevronRight size={13} style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                                    </button>
                                  </Tooltip>
                                </div>
                              </div>
                              {isExpanded && renderSettlementDetail(s)}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {paginatedSettlements.map((s, idx) => {
                          const rowNum = (safeSettlementPage - 1) * (Number.isFinite(settlementPageSize) ? settlementPageSize : 0) + idx + 1;
                          const isExpanded = expandedSettlementId === s.id;
                          return (
                            <div key={s.id} className="card overflow-hidden" style={{ background: selectedSettlements.has(s.id) ? 'rgba(212,105,30,0.05)' : undefined }}>
                              <div className="p-4">
                                <div className="flex items-center gap-2 mb-1">
                                  <Checkbox checked={selectedSettlements.has(s.id)} onChange={() => toggleSettlementSelect(s.id)} />
                                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                                    {rowNum}
                                  </span>
                                  <PartnerLogo partner={partnerLogoOf(s.partnerId, s.partnerName)} size={28} />
                                  <p className="text-sm font-bold truncate flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{partnerNameOf(s.partnerId, s.partnerName)}</p>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <Tooltip label="Edit"><button onClick={() => openEditSettlement(s)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}><Pencil size={12} /></button></Tooltip>
                                    <Tooltip label="Hapus">
                                      <button onClick={() => deleteSettlement(s)} disabled={deletingSettlementId === s.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                                        {deletingSettlementId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                      </button>
                                    </Tooltip>
                                  </div>
                                </div>
                                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)}</p>
                                <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Dibayar</span>
                                  <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(s.totalPayable)}</span>
                                </div>
                              </div>
                              <button onClick={() => setExpandedSettlementId(isExpanded ? null : s.id)}
                                className="w-full flex items-center justify-center gap-1 text-xs font-semibold px-4 py-1.5"
                                style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-2)' }}>
                                Detail <ChevronRight size={12} style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                              </button>
                              {isExpanded && renderSettlementDetail(s)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
                <Pagination total={filteredSettlements.length} safePage={safeSettlementPage} totalPages={totalSettlementPages}
                  pageSize={settlementPageSize} onPageSize={n => { setSettlementPageSize(n); setSettlementPage(1); }}
                  onGoPage={goSettlementPage} unit="settlement" />
              </>
            )}
          </div>

          {selectedSettlements.size > 0 && (
            <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
              <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
                style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
                <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedSettlements.size} dipilih</span>
                <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
                <button onClick={() => exportSettlementsExcel(settlements.filter(s => selectedSettlements.has(s.id)), 'terpilih')} disabled={exportingSettlementsExcel}
                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                  style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  {exportingSettlementsExcel ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
                  Export
                </button>
                <button onClick={() => exportSettlementsPdf(settlements.filter(s => selectedSettlements.has(s.id)), 'terpilih')} disabled={exportingSettlementsPdf}
                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                  style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  {exportingSettlementsPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
                  PDF
                </button>
                <button onClick={() => setSelectedSettlements(new Set())}
                  className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
                  Batal
                </button>
              </div>
            </div>
          )}
          </>
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
                <div className="flex items-center gap-3">
                  <ImageUploadBox
                    src={pForm.logoUrl}
                    alt={pForm.name || 'Logo partner'}
                    uploading={logoUploading}
                    onSelect={f => uploadPartnerLogo(f)}
                    onRemove={() => setPForm({ ...pForm, logoUrl: '' })}
                    fit="contain"
                    size={56}
                    emptyText="Logo"
                  />
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Nama Partner *</label>
                    <input value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })} className="input" />
                  </div>
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
        const isEdit = !!editingShipmentId;
        const close = () => { (isReceive ? setShowReceiveForm : setShowReturnForm)(false); setEditingShipmentId(null); };
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
                    <p className="modal-title">{isEdit ? 'Edit ' : ''}{isReceive ? 'Terima Titipan' : 'Retur ke Partner'}</p>
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
                      <SearchSelect value={partnerId} onChange={setPartnerId} disabled={isEdit}
                        options={partners.map(p => ({ value: p.id, label: p.name, sublabel: p.code }))}
                        placeholder="– Pilih Partner –" searchPlaceholder="Cari partner…" />
                      {isEdit && <p className="text-[10.5px] mt-1" style={{ color: 'var(--text-muted)' }}>Partner tidak bisa diubah — hapus lalu buat baru kalau salah partner.</p>}
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
                                      value: variantKey(p.id, v.id), label: p.name, sublabel: variantOptionsLabel(v.options),
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
                  {saving ? 'Menyimpan…' : isEdit ? 'Simpan Perubahan' : (isReceive ? 'Terima Titipan' : 'Retur ke Partner')}
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

      {/* ════ MODAL: Edit Settlement (dompet & catatan saja) ═══ */}
      {editingSettlement && (
        <div className="modal-overlay" onClick={() => !savingEditSettle && setEditingSettlement(null)}>
          <div className="modal-sheet modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><WalletIcon size={17} /></div>
                <div>
                  <p className="modal-title">Edit Settlement</p>
                  <p className="modal-subtitle">{editingSettlement.partnerName} · {formatRp(editingSettlement.totalPayable)}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setEditingSettlement(null)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {editingSettlement.items.length > 0 && (
                  <div className="p-3 rounded-xl flex flex-col gap-1" style={{ border: '1px solid var(--border-2)' }}>
                    {editingSettlement.items.map(it => (
                      <div key={it.productId} className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-secondary)' }}>{it.productName} × {it.qty}</span>
                        <span className="font-semibold tabular">{formatRp(it.payoutAmount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10.5px]" style={{ color: 'var(--text-muted)', marginTop: -8 }}>
                  Jumlah & rincian item terkunci (snapshot tagihan saat dibayar) — hapus settlement ini lalu bayar ulang kalau jumlahnya salah.
                </p>
                <div>
                  <label className="field-label">Dompet Pembayaran</label>
                  <SearchSelect value={editSettleWalletId} onChange={setEditSettleWalletId}
                    options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                </div>
                <div>
                  <label className="field-label">Catatan</label>
                  <input value={editSettleNote} onChange={e => setEditSettleNote(e.target.value)} className="input" placeholder="Catatan tambahan (opsional)" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setEditingSettlement(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={submitEditSettlement} disabled={savingEditSettle} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingEditSettle ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {savingEditSettle ? 'Menyimpan…' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL: Preview Import Excel Terima/Retur ═════════ */}
      {shipmentImportPreview && (() => {
        const validCount = shipmentImportPreview.rows.filter(r => !r.error).length;
        const errorCount = shipmentImportPreview.rows.length - validCount;
        const isReceiveImport = shipmentImportPreview.direction === 'in';
        return (
          <div className="modal-overlay" onClick={() => !confirmingShipmentImport && setShipmentImportPreview(null)}>
            <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
              <div className="modal-accent" />
              <span className="modal-handle" />
              <div className="modal-header">
                <div className="modal-header-left">
                  <div className="modal-icon">{isReceiveImport ? <PackagePlus size={17} /> : <Undo2 size={17} />}</div>
                  <div>
                    <p className="modal-title">Preview Import {isReceiveImport ? 'Terima Titipan' : 'Retur ke Partner'}</p>
                    <p className="modal-subtitle">Cek baris di bawah sebelum disimpan ke stok</p>
                  </div>
                </div>
                <Tooltip label="Tutup"><button onClick={() => setShipmentImportPreview(null)} className="modal-close"><X size={14} /></button></Tooltip>
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="flex items-center gap-2 flex-wrap px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{validCount} baris siap diimpor</span>
                    {errorCount > 0 && <span className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>· {errorCount} baris bermasalah (akan dilewati)</span>}
                  </div>
                  <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid var(--border-2)', borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--text-muted)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
                          <th style={{ padding: '6px 8px' }}>#</th>
                          <th style={{ padding: '6px 8px' }}>Partner</th>
                          <th style={{ padding: '6px 8px' }}>Gudang</th>
                          <th style={{ padding: '6px 8px' }}>Tanggal</th>
                          <th style={{ padding: '6px 8px' }}>Produk</th>
                          <th style={{ padding: '6px 8px' }}>Qty</th>
                          <th style={{ padding: '6px 8px' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shipmentImportPreview.rows.map(r => (
                          <tr key={r.rowNumber} style={{ borderTop: '1px solid var(--border-2)', background: r.error ? 'var(--danger-bg)' : undefined }}>
                            <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{r.rowNumber}</td>
                            <td style={{ padding: '6px 8px' }}>{r.partnerName ?? (r.partnerRaw || '–')}</td>
                            <td style={{ padding: '6px 8px' }}>{r.warehouseName ?? (r.warehouseRaw || '–')}</td>
                            <td style={{ padding: '6px 8px' }}>{r.date}</td>
                            <td style={{ padding: '6px 8px' }}>{r.productName ?? (r.productRaw || '–')}</td>
                            <td style={{ padding: '6px 8px' }}>{r.qty}</td>
                            <td style={{ padding: '6px 8px' }}>
                              {r.error ? <span style={{ color: 'var(--danger)' }}>{r.error}</span> : <span style={{ color: 'var(--success)' }}>OK</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button onClick={() => setShipmentImportPreview(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
                <button onClick={confirmShipmentImport} disabled={confirmingShipmentImport || validCount === 0} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                  {confirmingShipmentImport ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {confirmingShipmentImport ? 'Mengimpor…' : `Impor ${validCount} Baris`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
