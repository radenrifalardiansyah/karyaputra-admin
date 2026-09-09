'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Boxes, ShoppingBag, Plus, Pencil, Trash2, X, Check, Loader2, RefreshCw, Package, Clock, Search,
  ChevronLeft, ChevronRight, Wrench, Ban, Upload, PackageCheck,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import TopbarPortal from '@/components/TopbarPortal';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { RecordHistoryButton, RecordHistoryPanel } from '@/components/RecordHistory';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';

const API = '';
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

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

// Stok bahan baku dihitung dari akumulasi transaksi float, jadi kadang menyisakan noise
// seperti 0.00009999999999993348 — dibulatkan 2 desimal supaya tampilan tetap rapi. Nilai stok
// (stok x harga) dihitung dari qty yang sudah dibulatkan ini juga, supaya stok 0 selalu tampil Rp 0.
const roundQty = (n: number) => Math.round(n * 100) / 100;
const formatQty = (n: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

function formatDate(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateDisplay(iso?: string) {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

type SubTab = 'stok' | 'pembelian';
const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'stok',      label: 'Stok',      Icon: Boxes },
  { id: 'pembelian', label: 'Pembelian', Icon: ShoppingBag },
];

interface RawMaterial { id: string; name: string; unit: string; stockQty: number; avgCost: number; minStock?: number }
// Menipis = stok masih ada tapi sudah di batas minimum yang diset admin.
export const isLowStock = (m: Pick<RawMaterial, 'stockQty' | 'minStock'>) =>
  (m.minStock ?? 0) > 0 && m.stockQty > 0 && m.stockQty <= (m.minStock ?? 0);
interface Supplier { id: string; name: string }
interface PurchaseItem { materialId: string; materialName: string; unit: string; qty: number; price: number; subtotal: number }
interface Purchase {
  id: string; supplierId?: string | null; supplierName: string; items: PurchaseItem[]; total: number; note?: string;
  date?: string; paymentStatus?: 'lunas' | 'belum_lunas'; expenseId?: string | null; createdAt?: { seconds: number };
  voided?: boolean; voidNote?: string; walletId?: string | null;
}

type MaterialForm = { name: string; unit: string; minStock: string };
const EMPTY_MATERIAL: MaterialForm = { name: '', unit: '', minStock: '' };

interface PurchaseRow { materialId: string; qty: string; price: string }
const EMPTY_ROW: PurchaseRow = { materialId: '', qty: '', price: '' };

// ─── Excel import/export — Bahan Baku (Stok) ───────────────────────────────
const MATERIAL_TEMPLATE_COLS = [
  { header: 'Nama*',   key: 'name', width: 26 },
  { header: 'Satuan*', key: 'unit', width: 14 },
] as const;
type MaterialTemplateKey = typeof MATERIAL_TEMPLATE_COLS[number]['key'];

function detectMaterialColumn(header: string): MaterialTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('nama')) return 'name';
  if (h.includes('satuan') || h.includes('unit')) return 'unit';
  return null;
}

// ─── Excel import/export — Pembelian ───────────────────────────────────────
const PURCHASE_TEMPLATE_COLS = [
  { header: 'Tanggal (YYYY-MM-DD)', key: 'date',          width: 20 },
  { header: 'Supplier',             key: 'supplierName',  width: 22 },
  { header: 'Bahan Baku*',          key: 'materialName',  width: 24 },
  { header: 'Qty*',                 key: 'qty',           width: 10 },
  { header: 'Harga Satuan*',        key: 'price',         width: 16 },
  { header: 'Status Pembayaran',    key: 'paymentStatus', width: 18 },
  { header: 'Catatan',              key: 'note',          width: 28 },
] as const;
type PurchaseTemplateKey = typeof PURCHASE_TEMPLATE_COLS[number]['key'];

function detectPurchaseColumn(header: string): PurchaseTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('tanggal') || h.includes('date')) return 'date';
  if (h.includes('supplier')) return 'supplierName';
  if (h.includes('bahan')) return 'materialName';
  if (h.includes('qty') || h.includes('jumlah')) return 'qty';
  if (h.includes('harga')) return 'price';
  if (h.includes('status') || h.includes('bayar') || h.includes('lunas')) return 'paymentStatus';
  if (h.includes('catatan') || h.includes('note')) return 'note';
  return null;
}

export default function MaterialsTab({ creds, highlightMaterialId, onHighlightHandled }: {
  creds: string; highlightMaterialId?: string | null; onHighlightHandled?: () => void;
}) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);

  const [subTab, setSubTab] = useState<SubTab>('stok');
  const [highlightedMaterialId, setHighlightedMaterialId] = useState<string | null>(null);
  const materialRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Master bahan baku ──────────────────────────────────────
  const [materials,        setMaterials]        = useState<RawMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [showMForm,   setShowMForm]   = useState(false);
  const [editingM,    setEditingM]    = useState<RawMaterial | null>(null);
  const [mForm,       setMForm]       = useState<MaterialForm>(EMPTY_MATERIAL);
  const [savingM,     setSavingM]     = useState(false);
  const [deletingMId, setDeletingMId] = useState<string | null>(null);

  const [materialSearch, setMaterialSearch] = useState('');
  const [materialOnlyInStock, setMaterialOnlyInStock] = useState(false);
  const [materialPage,     setMaterialPage]     = useState(1);
  const [materialPageSize, setMaterialPageSize] = useState(10);
  const [materialView, setMaterialView] = useViewMode('materials');
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [bulkDeletingMaterials, setBulkDeletingMaterials] = useState(false);
  const [exportingMaterials, setExportingMaterials] = useState(false);
  const [exportingMaterialsPdf, setExportingMaterialsPdf] = useState(false);
  const [importingMaterials, setImportingMaterials] = useState(false);
  const importMaterialFileRef = useRef<HTMLInputElement>(null);

  const loadMaterials = async () => {
    setMaterialsLoading(true);
    const r = await fetch(`${API}/api/materials`, { headers });
    if (r.ok) setMaterials((await r.json() as { materials: RawMaterial[] }).materials);
    setMaterialsLoading(false);
  };

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const loadSuppliers = async () => {
    const r = await fetch(`${API}/api/suppliers`, { headers });
    if (r.ok) setSuppliers((await r.json() as { suppliers: Supplier[] }).suppliers);
  };

  const [purchases,        setPurchases]        = useState<Purchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(true);
  const loadPurchases = async () => {
    setPurchasesLoading(true);
    const r = await fetch(`${API}/api/material-purchases?limit=50`, { headers });
    if (r.ok) setPurchases((await r.json() as { purchases: Purchase[] }).purchases);
    setPurchasesLoading(false);
  };

  useEffect(() => { loadMaterials(); loadSuppliers(); loadPurchases(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateM = () => { setEditingM(null); setMForm(EMPTY_MATERIAL); setShowMForm(true); };
  const openEditM = (m: RawMaterial) => { setEditingM(m); setMForm({ name: m.name, unit: m.unit, minStock: m.minStock ? String(m.minStock) : '' }); setShowMForm(true); };

  const saveMaterial = async () => {
    if (!mForm.name.trim() || !mForm.unit.trim()) return;
    setSavingM(true);
    const payload = { name: mForm.name, unit: mForm.unit, minStock: Number(mForm.minStock) || 0 };
    const r = editingM
      ? await fetch(`${API}/api/materials/${editingM.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/materials`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) { await loadMaterials(); setShowMForm(false); toast.success(editingM ? 'Bahan baku berhasil diperbarui.' : 'Bahan baku berhasil ditambahkan.'); }
    else toast.error('Gagal menyimpan bahan baku.');
    setSavingM(false);
  };

  const deleteMaterial = async (m: RawMaterial) => {
    if (!await confirm({ message: `Hapus bahan baku "${m.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingMId(m.id);
    const r = await fetch(`${API}/api/materials/${m.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setMaterials(prev => prev.filter(x => x.id !== m.id));
      setSelectedMaterials(s => { const n = new Set(s); n.delete(m.id); return n; });
      toast.success(`"${m.name}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus bahan baku.');
    }
    setDeletingMId(null);
  };

  // ── Koreksi stok/harga langsung (tanpa menulis ulang riwayat pembelian/produksi) ──
  const [adjustingMaterial, setAdjustingMaterial] = useState<RawMaterial | null>(null);
  const [adjustStockQty, setAdjustStockQty] = useState('');
  const [adjustAvgCost,  setAdjustAvgCost]  = useState('');
  const [adjustNote,     setAdjustNote]     = useState('');
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  const openAdjust = (m: RawMaterial) => {
    setAdjustingMaterial(m);
    setAdjustStockQty(String(Math.round(m.stockQty * 100) / 100));
    // avgCost hasil rata-rata tertimbang nyaris selalu desimal (mis. 15999.999999999998).
    // NumberInput cuma untuk Rupiah bulat — dia buang titik desimal & gabung semua digit,
    // jadi wajib dibulatkan dulu supaya tidak tampil angka raksasa yang ngaco.
    setAdjustAvgCost(String(Math.round(m.avgCost)));
    setAdjustNote('');
  };
  const closeAdjust = () => { setAdjustingMaterial(null); setAdjustStockQty(''); setAdjustAvgCost(''); setAdjustNote(''); };

  const submitAdjust = async () => {
    if (!adjustingMaterial || !adjustNote.trim()) return;
    setSubmittingAdjust(true);
    try {
      const res = await fetch(`${API}/api/materials/${adjustingMaterial.id}/adjust`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newStockQty: parseFloat(adjustStockQty) || 0,
          newAvgCost: parseFloat(adjustAvgCost) || 0,
          note: adjustNote.trim(),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal menyimpan koreksi.'); return; }
      toast.success(`Stok & harga "${adjustingMaterial.name}" berhasil dikoreksi.`);
      closeAdjust();
      await loadMaterials();
    } finally { setSubmittingAdjust(false); }
  };

  const toggleSelectMaterial = (id: string) =>
    setSelectedMaterials(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkDeleteMaterials = async () => {
    if (selectedMaterials.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedMaterials.size} bahan baku yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeletingMaterials(true);
    const r = await fetch(`${API}/api/materials/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedMaterials] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number; skippedInUse: number };
      // Refetch, bukan filter optimis lokal — sebagian item terpilih bisa saja dilewati server
      // (skippedInUse), jadi tidak semua id yang dicentang benar-benar terhapus.
      await loadMaterials();
      setSelectedMaterials(new Set());
      const extra = d.skippedInUse > 0 ? ` (${d.skippedInUse} masih dipakai di pembelian/produksi, dilewati)` : '';
      toast.success(`${d.deleted} bahan baku berhasil dihapus.${extra}`);
    } else {
      toast.error('Gagal menghapus bahan baku yang dipilih.');
    }
    setBulkDeletingMaterials(false);
  };

  // ── Excel template + import (Bahan Baku) ────────────────────────────
  const downloadMaterialTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Bahan Baku');
    const colCount = MATERIAL_TEMPLATE_COLS.length;
    ws.columns = MATERIAL_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT BAHAN BAKU — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. '
      + 'Mulai isi data dari baris 4 ke bawah, satu bahan baku per baris. Stok & harga rata-rata otomatis mulai dari 0, '
      + 'nanti terisi lewat pencatatan Pembelian.';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 40;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    MATERIAL_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
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

    const exampleRow = ws.addRow({ name: 'Tepung Terigu', unit: 'kg' });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-bahan-baku.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importMaterialsFromExcel = async (file: File) => {
    setImportingMaterials(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, MaterialTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, MaterialTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectMaterialColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('name')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Nama" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: MaterialForm[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw = Object.fromEntries(MATERIAL_TEMPLATE_COLS.map(c => [c.key, ''])) as Record<MaterialTemplateKey, string>;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (raw.name.trim() && raw.unit.trim()) rows.push({ name: raw.name, unit: raw.unit, minStock: '' });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data bahan baku valid pada file tersebut. Pastikan kolom Nama & Satuan terisi.');
        return;
      }

      const r = await fetch(`${API}/api/materials/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ materials: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number; skippedDuplicate: number };
        await loadMaterials();
        const extra = [
          d.skippedDuplicate > 0 ? `${d.skippedDuplicate} nama duplikat dilewati` : '',
          d.skippedInvalid   > 0 ? `${d.skippedInvalid} baris tidak lengkap dilewati` : '',
        ].filter(Boolean).join(', ');
        toast.success(`${d.created} bahan baku berhasil diimpor.${extra ? ` (${extra})` : ''}`);
      } else {
        const d = await r.json().catch(() => ({ error: undefined, created: 0 })) as { error?: string; created?: number };
        if (d.created) await loadMaterials(); // sebagian sempat tersimpan sebelum gagal — refresh biar tidak dobel-impor
        toast.error(d.error ?? 'Gagal mengimpor data bahan baku.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImportingMaterials(false);
    }
  };

  const exportMaterialsExcel = async (rows: RawMaterial[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada bahan baku untuk diexport.'); return; }
    setExportingMaterials(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Bahan Baku');

      const COLS = [
        { header: 'No',                key: 'no',        width: 6  },
        { header: 'Nama',              key: 'name',      width: 26 },
        { header: 'Satuan',            key: 'unit',      width: 12 },
        { header: 'Stok',              key: 'stockQty',  width: 12 },
        { header: 'Harga Rata-rata',   key: 'avgCost',   width: 18 },
        { header: 'Nilai Stok',        key: 'value',     width: 18 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN STOK BAHAN BAKU — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} bahan baku (${label}) · Diexport ${todayLabel}`;
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
          no: i + 1, name: m.name, unit: m.unit, stockQty: m.stockQty,
          avgCost: m.avgCost, value: roundQty(m.stockQty) * m.avgCost,
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
        row.getCell('no').alignment       = { horizontal: 'center', vertical: 'middle' };
        row.getCell('unit').alignment     = { horizontal: 'center', vertical: 'middle' };
        row.getCell('stockQty').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('stockQty').numFmt    = '0.##';
        row.getCell('avgCost').numFmt = '"Rp"#,##0';
        row.getCell('avgCost').alignment = { horizontal: 'right', vertical: 'middle' };
        row.getCell('value').numFmt = '"Rp"#,##0';
        row.getCell('value').alignment = { horizontal: 'right', vertical: 'middle' };
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
      a.download = `bahan-baku-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} bahan baku (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingMaterials(false);
    }
  };

  const exportMaterialsPdf = async (rows: RawMaterial[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada bahan baku untuk diexport.'); return; }
    setExportingMaterialsPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'STOK BAHAN BAKU',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '6%', align: 'center' },
              { header: 'Nama', width: '26%', bold: true },
              { header: 'Satuan', width: '12%', align: 'center' },
              { header: 'Stok', width: '12%', align: 'center' },
              { header: 'Harga Rata-rata', width: '22%', align: 'right' },
              { header: 'Nilai Stok', width: '22%', align: 'right', bold: true },
            ],
            rows: rows.map((m, i) => [
              i + 1, m.name, m.unit, roundQty(m.stockQty), formatRp(m.avgCost), formatRp(roundQty(m.stockQty) * m.avgCost),
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bahan-baku-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} bahan baku (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingMaterialsPdf(false);
    }
  };

  const filteredMaterials = materials
    .filter(m => !materialSearch || m.name.toLowerCase().includes(materialSearch.toLowerCase()))
    .filter(m => !materialOnlyInStock || roundQty(m.stockQty) > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const materialTotalPages = Math.max(1, Math.ceil(filteredMaterials.length / materialPageSize));
  const materialSafePage   = Math.min(materialPage, materialTotalPages);
  const paginatedMaterials = filteredMaterials.slice((materialSafePage - 1) * materialPageSize, materialSafePage * materialPageSize);
  const goMaterialPage    = (p: number) => setMaterialPage(Math.max(1, Math.min(p, materialTotalPages)));
  const resetMaterialPage = () => setMaterialPage(1);

  // Datang dari klik "Lihat" di modal detail notifikasi (stock_low) — buka & sorot bahan baku itu.
  useEffect(() => {
    if (!highlightMaterialId || materials.length === 0) return;
    if (!materials.some(m => m.id === highlightMaterialId)) { onHighlightHandled?.(); return; }
    setSubTab('stok');
    setMaterialSearch('');
    const idx = [...materials]
      .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }))
      .findIndex(m => m.id === highlightMaterialId);
    if (idx === -1) { onHighlightHandled?.(); return; }
    setMaterialPage(Math.floor(idx / materialPageSize) + 1);
    setHighlightedMaterialId(highlightMaterialId);
    requestAnimationFrame(() => materialRowRefs.current[highlightMaterialId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    onHighlightHandled?.();
    const t = setTimeout(() => setHighlightedMaterialId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightMaterialId, materials]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMaterialPageAll = () => {
    const pageIds     = paginatedMaterials.map(m => m.id);
    const allSelected = pageIds.every(id => selectedMaterials.has(id));
    setSelectedMaterials(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  // ── Form pembelian ──────────────────────────────────────────
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [editingPurchase, setEditingPurchase]   = useState<Purchase | null>(null);
  const [supplierId,   setSupplierId]   = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [purchaseDate,  setPurchaseDate] = useState(todayISO());
  const [rows,         setRows]         = useState<PurchaseRow[]>([{ ...EMPTY_ROW }]);
  const [purchaseNote, setPurchaseNote] = useState('');
  const [purchasePaymentStatus, setPurchasePaymentStatus] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [purchaseWalletId, setPurchaseWalletId] = useState('');
  const [submittingPurchase, setSubmittingPurchase] = useState(false);
  const [markingPurchaseId, setMarkingPurchaseId] = useState<string | null>(null);
  const wallets = useWallets(creds);
  const [walletBalances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

  const resetPurchaseForm = () => {
    setEditingPurchase(null); setSupplierId(''); setSupplierName(''); setPurchaseDate(todayISO());
    setRows([{ ...EMPTY_ROW }]); setPurchaseNote(''); setPurchasePaymentStatus('lunas'); setPurchaseWalletId('');
  };
  const openCreatePurchase = () => { resetPurchaseForm(); setShowPurchaseForm(true); };
  const openEditPurchase = (p: Purchase) => {
    setEditingPurchase(p);
    setSupplierId(p.supplierId ?? '');
    setSupplierName(p.supplierName ?? '');
    setPurchaseDate(p.date || todayISO());
    // it.price bisa desimal (mis. hasil import Excel) — NumberInput buang titik desimal
    // & gabung digit kalau tidak dibulatkan dulu (sama seperti avgCost di openAdjust).
    setRows(p.items.map(it => ({ materialId: it.materialId, qty: String(it.qty), price: String(Math.round(it.price)) })));
    setPurchaseNote(p.note ?? '');
    setPurchasePaymentStatus(p.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas');
    setPurchaseWalletId(p.walletId ?? '');
    setShowPurchaseForm(true);
  };
  const closePurchaseForm = () => { setShowPurchaseForm(false); resetPurchaseForm(); };

  const addRow    = () => setRows(prev => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<PurchaseRow>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const purchaseTotal = rows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0), 0);
  const canSubmitPurchase = supplierName.trim() !== '' && !!purchaseDate && !!purchaseWalletId
    && rows.some(r => r.materialId && (parseFloat(r.qty) || 0) > 0);

  const submitPurchase = async () => {
    if (!canSubmitPurchase) return;
    setSubmittingPurchase(true);
    try {
      const items = rows
        .filter(r => r.materialId && (parseFloat(r.qty) || 0) > 0)
        .map(r => {
          const m = materials.find(mm => mm.id === r.materialId)!;
          return { materialId: m.id, materialName: m.name, unit: m.unit, qty: parseFloat(r.qty) || 0, price: parseFloat(r.price) || 0 };
        });
      const payload = {
        supplierId: supplierId || undefined, supplierName: supplierName.trim(), date: purchaseDate, items, note: purchaseNote,
        paymentStatus: purchasePaymentStatus, walletId: purchaseWalletId,
      };
      const res = editingPurchase
        ? await fetch(`${API}/api/material-purchases/${editingPurchase.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(`${API}/api/material-purchases`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal menyimpan pembelian.'); return; }
      toast.success(editingPurchase ? 'Perubahan pembelian tersimpan.' : 'Pembelian bahan baku tersimpan.');
      closePurchaseForm();
      await Promise.all([loadMaterials(), loadPurchases()]);
      refetchBalances();
    } finally { setSubmittingPurchase(false); }
  };

  const markPurchaseLunas = async (id: string) => {
    setMarkingPurchaseId(id);
    const r = await fetch(`${API}/api/material-purchases/${id}/mark-lunas`, { method: 'POST', headers });
    if (r.ok) { toast.success('Pembelian ditandai lunas — sudah tercatat di Pengeluaran.'); await loadPurchases(); refetchBalances(); }
    else toast.error('Gagal menandai lunas.');
    setMarkingPurchaseId(null);
  };

  const [deletingPurchaseId, setDeletingPurchaseId] = useState<string | null>(null);
  const deletePurchase = async (p: Purchase) => {
    if (!await confirm({ message: `Hapus pembelian dari "${p.supplierName || 'Tanpa nama'}"? Stok & harga rata-rata bahan baku akan dikembalikan seperti sebelum pembelian ini.`, danger: true })) return;
    setDeletingPurchaseId(p.id);
    const r = await fetch(`${API}/api/material-purchases/${p.id}`, { method: 'DELETE', headers });
    const data = await r.json().catch(() => ({})) as { error?: string };
    if (r.ok) { toast.success('Pembelian berhasil dihapus, stok bahan baku dikembalikan.'); await Promise.all([loadMaterials(), loadPurchases()]); refetchBalances(); }
    else toast.error(`${data.error ?? 'Gagal menghapus pembelian.'} Coba tombol "Batalkan" sebagai gantinya.`);
    setDeletingPurchaseId(null);
  };

  const [voidingPurchaseId, setVoidingPurchaseId] = useState<string | null>(null);
  const voidPurchase = async (p: Purchase) => {
    if (!await confirm({
      message: `Batalkan pembelian dari "${p.supplierName || 'Tanpa nama'}"? Pengeluaran otomatisnya (kalau ada) akan dihapus. Stok & harga rata-rata bahan baku akan dikembalikan seperti sebelum pembelian ini — KECUALI kalau bahan bakunya sudah dibeli/dipakai lagi setelah transaksi ini, maka stok akan dibiarkan apa adanya dan perlu dibetulkan manual lewat "Koreksi" di menu Stok.`,
      danger: true,
    })) return;
    setVoidingPurchaseId(p.id);
    const r = await fetch(`${API}/api/material-purchases/${p.id}/void`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const data = await r.json().catch(() => ({})) as { error?: string; reversed?: boolean; skippedMaterials?: string[] };
    if (r.ok) {
      toast.success(data.reversed
        ? 'Pembelian dibatalkan — stok & harga rata-rata bahan baku sudah dikembalikan.'
        : `Pembelian dibatalkan, TAPI stok tidak diubah karena sudah dipakai/dibeli lagi: ${(data.skippedMaterials ?? []).join(', ')}. Betulkan manual lewat "Koreksi" di menu Stok.`);
      await Promise.all([loadMaterials(), loadPurchases()]);
      refetchBalances();
    }
    else toast.error(data.error ?? 'Gagal membatalkan pembelian.');
    setVoidingPurchaseId(null);
  };

  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchasePage,     setPurchasePage]     = useState(1);
  const [purchasePageSize, setPurchasePageSize] = useState(10);
  const [purchaseView, setPurchaseView] = useViewMode('material-purchases');
  const [selectedPurchases, setSelectedPurchases] = useState<Set<string>>(new Set());
  const [bulkDeletingPurchases, setBulkDeletingPurchases] = useState(false);
  const [exportingPurchases, setExportingPurchases] = useState(false);
  const [exportingPurchasesPdf, setExportingPurchasesPdf] = useState(false);
  const [importingPurchases, setImportingPurchases] = useState(false);
  const importPurchaseFileRef = useRef<HTMLInputElement>(null);
  const [purchaseHistoryId, setPurchaseHistoryId] = useState<string | null>(null);
  const togglePurchaseHistory = (id: string) => setPurchaseHistoryId(cur => cur === id ? null : id);

  const toggleSelectPurchase = (id: string) =>
    setSelectedPurchases(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Tiap pembelian punya pengecekan keamanan sendiri (lihat DELETE /api/material-purchases/[id]),
  // jadi hapus massal memanggil endpoint yang sama satu per satu & melaporkan yang gagal/diblokir.
  const bulkDeletePurchases = async () => {
    if (selectedPurchases.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedPurchases.size} pembelian yang dipilih? Yang sudah dipakai/dibeli lagi setelahnya akan otomatis dilewati.`, danger: true })) return;
    setBulkDeletingPurchases(true);
    const ids = [...selectedPurchases];
    let okCount = 0, blockedCount = 0;
    for (const id of ids) {
      const r = await fetch(`${API}/api/material-purchases/${id}`, { method: 'DELETE', headers });
      if (r.ok) okCount++; else blockedCount++;
    }
    setSelectedPurchases(new Set());
    await Promise.all([loadMaterials(), loadPurchases()]);
    refetchBalances();
    if (okCount > 0) toast.success(`${okCount} pembelian berhasil dihapus.${blockedCount > 0 ? ` ${blockedCount} dilewati karena sudah dipakai/dibeli lagi.` : ''}`);
    else toast.error('Semua pembelian yang dipilih tidak bisa dihapus (sudah dipakai/dibeli lagi setelahnya).');
    setBulkDeletingPurchases(false);
  };

  // ── Excel template + import (Pembelian) ──────────────────────────────
  const downloadPurchaseTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Pembelian');
    const colCount = PURCHASE_TEMPLATE_COLS.length;
    ws.columns = PURCHASE_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT PEMBELIAN BAHAN BAKU — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    const matNames = materials.map(m => m.name).join(', ') || '(belum ada bahan baku)';
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. Satu baris = satu bahan baku yang dibeli. '
      + `Kolom Bahan Baku harus persis sama dengan salah satu bahan baku yang sudah ada: ${matNames}. `
      + 'Kolom Status Pembayaran diisi "Lunas" atau "Belum Lunas" (kosong dianggap Lunas).';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 46;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    PURCHASE_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
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

    const exampleRow = ws.addRow({
      date: todayISO(), supplierName: suppliers[0]?.name ?? 'UD Sumber Tani', materialName: materials[0]?.name ?? 'Tepung Terigu',
      qty: 50, price: 12000, paymentStatus: 'Lunas', note: 'Contoh — timpa dengan data pembelian Anda',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-pembelian-bahan-baku.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importPurchasesFromExcel = async (file: File) => {
    setImportingPurchases(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, PurchaseTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, PurchaseTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectPurchaseColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('materialName')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Bahan Baku" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const matIdByName = new Map(materials.map(m => [m.name.trim().toLowerCase(), m]));
      let skippedInvalidClient = 0;
      const rows: {
        materialId: string; materialName: string; unit: string; qty: number; price: number;
        supplierName: string; date: string; note: string; paymentStatus: 'lunas' | 'belum_lunas';
      }[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw = Object.fromEntries(PURCHASE_TEMPLATE_COLS.map(c => [c.key, ''])) as Record<PurchaseTemplateKey, string>;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (!raw.materialName.trim()) return;
        const material = matIdByName.get(raw.materialName.trim().toLowerCase());
        const qty = Number(raw.qty.replace(/[^0-9.-]/g, '')) || 0;
        const price = Number(raw.price.replace(/[^0-9.-]/g, '')) || 0;
        if (!material || qty <= 0 || price <= 0) { skippedInvalidClient++; return; }
        rows.push({
          materialId: material.id, materialName: material.name, unit: material.unit, qty, price,
          supplierName: raw.supplierName, date: raw.date || todayISO(), note: raw.note,
          paymentStatus: /^belum/i.test(raw.paymentStatus.trim()) ? 'belum_lunas' : 'lunas',
        });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data pembelian valid pada file tersebut. Pastikan Bahan Baku sesuai daftar yang ada, dan Qty & Harga terisi.');
        return;
      }

      const r = await fetch(`${API}/api/material-purchases/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchases: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number };
        await Promise.all([loadMaterials(), loadPurchases()]);
        const totalSkipped = d.skippedInvalid + skippedInvalidClient;
        toast.success(`${d.created} pembelian berhasil diimpor.${totalSkipped > 0 ? ` (${totalSkipped} baris tidak valid dilewati)` : ''}`);
      } else {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        toast.error(d.error ?? 'Gagal mengimpor data pembelian.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImportingPurchases(false);
    }
  };

  const exportPurchasesExcel = async (rows: Purchase[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada pembelian untuk diexport.'); return; }
    setExportingPurchases(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Pembelian');

      const COLS = [
        { header: 'No',        key: 'no',       width: 6  },
        { header: 'Tanggal',   key: 'date',     width: 16 },
        { header: 'Supplier',  key: 'supplier', width: 22 },
        { header: 'Bahan Baku Dibeli', key: 'items', width: 40 },
        { header: 'Total',     key: 'total',    width: 16 },
        { header: 'Status Bayar', key: 'payment', width: 14 },
        { header: 'Status',    key: 'status',   width: 12 },
        { header: 'Catatan',   key: 'note',     width: 28 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN PEMBELIAN BAHAN BAKU — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} pembelian (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((p, i) => {
        const row = ws.addRow({
          no: i + 1,
          date: p.date ? formatDateDisplay(p.date) : formatDate(p.createdAt?.seconds),
          supplier: p.supplierName || 'Tanpa nama',
          items: p.items.map(it => `${it.materialName} (${it.qty} ${it.unit})`).join(', '),
          total: p.total,
          payment: p.paymentStatus === 'belum_lunas' ? 'Belum Lunas' : 'Lunas',
          status: p.voided ? 'Dibatalkan' : 'Aktif',
          note: p.note || '-',
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
        row.getCell('no').alignment    = { horizontal: 'center', vertical: 'middle' };
        row.getCell('total').numFmt    = '"Rp"#,##0';
        row.getCell('total').alignment = { horizontal: 'right', vertical: 'middle' };
        row.getCell('payment').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('status').alignment  = { horizontal: 'center', vertical: 'middle' };
        row.getCell('items').alignment   = { horizontal: 'left', vertical: 'top', wrapText: true };
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
      a.download = `pembelian-bahan-baku-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} pembelian (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingPurchases(false);
    }
  };

  const exportPurchasesPdf = async (rows: Purchase[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada pembelian untuk diexport.'); return; }
    setExportingPurchasesPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'PEMBELIAN BAHAN BAKU',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '4%', align: 'center' },
              { header: 'Tanggal', width: '10%' },
              { header: 'Supplier', width: '14%' },
              { header: 'Bahan Dibeli', width: '27%' },
              { header: 'Total', width: '12%', align: 'right', bold: true },
              { header: 'Bayar', width: '9%', align: 'center' },
              { header: 'Status', width: '9%', align: 'center' },
              { header: 'Catatan', width: '15%' },
            ],
            rows: rows.map((p, i) => [
              i + 1,
              p.date ? formatDateDisplay(p.date) : formatDate(p.createdAt?.seconds),
              p.supplierName || 'Tanpa nama',
              p.items.map(it => `${it.materialName} (${it.qty} ${it.unit})`).join(', '),
              formatRp(p.total),
              p.paymentStatus === 'belum_lunas' ? 'Belum Lunas' : 'Lunas',
              p.voided ? 'Dibatalkan' : 'Aktif',
              p.note || '-',
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pembelian-bahan-baku-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} pembelian (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPurchasesPdf(false);
    }
  };

  const filteredPurchases = purchases
    .filter(p => !purchaseSearch || (p.supplierName ?? '').toLowerCase().includes(purchaseSearch.toLowerCase()));
  const purchaseTotalPages = Math.max(1, Math.ceil(filteredPurchases.length / purchasePageSize));
  const purchaseSafePage   = Math.min(purchasePage, purchaseTotalPages);
  const paginatedPurchases = filteredPurchases.slice((purchaseSafePage - 1) * purchasePageSize, purchaseSafePage * purchasePageSize);
  const goPurchasePage    = (p: number) => setPurchasePage(Math.max(1, Math.min(p, purchaseTotalPages)));
  const resetPurchasePage = () => setPurchasePage(1);

  const togglePurchasePageAll = () => {
    const pageIds     = paginatedPurchases.map(p => p.id);
    const allSelected = pageIds.every(id => selectedPurchases.has(id));
    setSelectedPurchases(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const materialOptions = materials.map(m => ({ value: m.id, label: m.name, sublabel: `Stok ${formatQty(m.stockQty)} ${m.unit}` }));
  const supplierOptions = [
    { value: '', label: '– Supplier lain / tidak tercatat –' },
    ...suppliers.map(s => ({ value: s.id, label: s.name })),
  ];
  const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={() => { loadMaterials(); loadPurchases(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={materialsLoading || purchasesLoading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      {/* Sub-tab switcher */}
      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="inline-flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all"
              style={subTab === t.id ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { color: 'var(--text-muted)' }}>
              <t.Icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {/* ════ STOK ═══════════════════════════════════════════ */}
        {subTab === 'stok' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            {/* Header: search + actions in one row */}
            <div className="flex flex-row items-center gap-2 sm:gap-3">
              {materials.length > 0 && (
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={materialSearch}
                    onChange={e => { setMaterialSearch(e.target.value); resetMaterialPage(); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari nama bahan baku…"
                  />
                </div>
              )}
              {materials.length > 0 && (
                <button
                  onClick={() => { setMaterialOnlyInStock(v => !v); resetMaterialPage(); }}
                  className="px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0"
                  style={{
                    height: HEADER_BTN_H,
                    background: materialOnlyInStock ? 'linear-gradient(135deg,#16A34A,#15803D)' : 'var(--surface-2)',
                    color: materialOnlyInStock ? 'white' : 'var(--text-muted)',
                  }}
                >
                  <PackageCheck size={14} /> <span className="hidden sm:inline">Ada Stok</span>
                </button>
              )}
              <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
                <Tooltip label="Unduh Template">
                  <button onClick={downloadMaterialTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                    <ExcelIcon size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={importingMaterials ? 'Mengimpor…' : 'Upload Excel'}>
                  <button onClick={() => importMaterialFileRef.current?.click()} disabled={importingMaterials} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                    {importingMaterials ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  </button>
                </Tooltip>
                <input ref={importMaterialFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) importMaterialsFromExcel(f); e.target.value = ''; }} />
                {materials.length > 0 && (
                  <Tooltip label="Export Excel">
                    <button onClick={() => exportMaterialsExcel(filteredMaterials, 'sesuai filter')} disabled={exportingMaterials} aria-label="Export Excel"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingMaterials ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                    </button>
                  </Tooltip>
                )}
                {materials.length > 0 && (
                  <Tooltip label="Export PDF">
                    <button onClick={() => exportMaterialsPdf(filteredMaterials, 'sesuai filter')} disabled={exportingMaterialsPdf} aria-label="Export PDF"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingMaterialsPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                    </button>
                  </Tooltip>
                )}
                {materials.length > 0 && <ViewToggle mode={materialView} onChange={setMaterialView} height={HEADER_BTN_H} />}
                <button onClick={openCreateM} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Bahan Baku</span>
                </button>
              </div>
            </div>

            {materialsLoading && materials.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : materials.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <Boxes size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada bahan baku</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tambahkan bahan baku untuk mulai catat pembelian & produksi</p>
              </div>
            ) : (
              <>
                {paginatedMaterials.length > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                    <Checkbox
                      checked={paginatedMaterials.every(m => selectedMaterials.has(m.id))}
                      indeterminate={paginatedMaterials.some(m => selectedMaterials.has(m.id)) && !paginatedMaterials.every(m => selectedMaterials.has(m.id))}
                      onChange={toggleMaterialPageAll}
                    />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {selectedMaterials.size > 0 ? `${selectedMaterials.size} dipilih` : `${paginatedMaterials.length} bahan baku di halaman ini`}
                    </span>
                  </div>
                )}

                {paginatedMaterials.length === 0 ? (
                  <div className="card py-12 text-center">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada bahan baku yang cocok.</p>
                  </div>
                ) : materialView === 'table' ? (
                  <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                    {paginatedMaterials.map((m, idx) => {
                      const isSelected = selectedMaterials.has(m.id);
                      const rowNum = (materialSafePage - 1) * (Number.isFinite(materialPageSize) ? materialPageSize : 0) + idx + 1;
                      return (
                        <div key={m.id} ref={el => { materialRowRefs.current[m.id] = el; }} className="px-4 py-3 flex items-center gap-3"
                          style={{ transition: 'background-color 0.6s ease', background: highlightedMaterialId === m.id ? 'var(--accent-bg)' : isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                          <Checkbox checked={isSelected} onChange={() => toggleSelectMaterial(m.id)} />
                          <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                            {rowNum}
                          </span>
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                            <Package size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                              {isLowStock(m) && (
                                <Tooltip label={`Batas minimum ${m.minStock} ${m.unit}`}>
                                  <span className="badge badge-amber">Stok Menipis</span>
                                </Tooltip>
                              )}
                            </div>
                            <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                              Stok {formatQty(m.stockQty)} {m.unit} · Rata-rata {formatRp(m.avgCost)}/{m.unit}
                            </p>
                          </div>
                          <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--accent-dark)' }}>
                            {formatRp(roundQty(m.stockQty) * m.avgCost)}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Tooltip label="Koreksi Stok/Harga">
                              <button onClick={() => openAdjust(m)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Koreksi Stok/Harga">
                                <Wrench size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Edit">
                              <button onClick={() => openEditM(m)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                                <Pencil size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Hapus">
                              <button onClick={() => deleteMaterial(m)} disabled={deletingMId === m.id} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                {deletingMId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {paginatedMaterials.map(m => {
                      const isSelected = selectedMaterials.has(m.id);
                      return (
                        <div key={m.id} ref={el => { materialRowRefs.current[m.id] = el; }} className="card overflow-hidden relative"
                          style={{ transition: 'background-color 0.6s ease', background: highlightedMaterialId === m.id ? 'var(--accent-bg)' : undefined, outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                          <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                            <Checkbox checked={isSelected} onChange={() => toggleSelectMaterial(m.id)} />
                          </div>
                          <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                            <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                              <Package size={20} />
                            </div>
                            <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                            {isLowStock(m) && <span className="badge badge-amber">Stok Menipis</span>}
                            <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>Stok {formatQty(m.stockQty)} {m.unit}</p>
                            <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>Rata-rata {formatRp(m.avgCost)}/{m.unit}</p>
                            <p className="text-base font-extrabold tabular mt-1" style={{ color: 'var(--accent-dark)' }}>{formatRp(roundQty(m.stockQty) * m.avgCost)}</p>
                          </div>
                          <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                            <Tooltip label="Koreksi Stok/Harga">
                              <button onClick={() => openAdjust(m)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Koreksi Stok/Harga">
                                <Wrench size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Edit">
                              <button onClick={() => openEditM(m)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                                <Pencil size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Hapus">
                              <button onClick={() => deleteMaterial(m)} disabled={deletingMId === m.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                                {deletingMId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {filteredMaterials.length > 0 && (
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {filteredMaterials.length} bahan baku · halaman {materialSafePage} dari {materialTotalPages}
                      </p>
                      <PageSizeSelect value={materialPageSize} onChange={n => { setMaterialPageSize(n); resetMaterialPage(); }} />
                    </div>
                    {materialTotalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <Tooltip label="Halaman sebelumnya">
                          <button onClick={() => goMaterialPage(materialSafePage - 1)} disabled={materialSafePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                            <ChevronLeft size={14} />
                          </button>
                        </Tooltip>
                        {Array.from({ length: materialTotalPages }, (_, i) => i + 1)
                          .filter(n => n === 1 || n === materialTotalPages || Math.abs(n - materialSafePage) <= 1)
                          .reduce<(number | '…')[]>((acc, n, i, arr) => {
                            if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                            acc.push(n); return acc;
                          }, [])
                          .map((n, i) =>
                            n === '…'
                              ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                              : <button key={n} onClick={() => goMaterialPage(n as number)}
                                  className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                                  style={materialSafePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                                  {n}
                                </button>
                          )
                        }
                        <Tooltip label="Halaman berikutnya">
                          <button onClick={() => goMaterialPage(materialSafePage + 1)} disabled={materialSafePage === materialTotalPages} className="btn-ghost p-2 disabled:opacity-30">
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
            {selectedMaterials.size > 0 && (
              <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
                <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
                  style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
                  <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedMaterials.size} dipilih</span>
                  <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
                  <button onClick={bulkDeleteMaterials} disabled={bulkDeletingMaterials}
                    className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                    style={{ background: 'var(--danger)', color: '#fff' }}>
                    {bulkDeletingMaterials ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    Hapus
                  </button>
                  <button onClick={() => setSelectedMaterials(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ PEMBELIAN ══════════════════════════════════════ */}
        {subTab === 'pembelian' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={11} /> Riwayat Pembelian ({purchases.length})
                </p>
                <div className="flex flex-row items-center gap-2 sm:gap-3 sm:flex-1">
                  {purchases.length > 0 && (
                    <div className="relative flex-1 min-w-0">
                      <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                      <input
                        value={purchaseSearch}
                        onChange={e => { setPurchaseSearch(e.target.value); resetPurchasePage(); }}
                        className="input text-sm w-full"
                        style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                        placeholder="Cari nama supplier…"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
                    <Tooltip label="Unduh Template">
                      <button onClick={downloadPurchaseTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                        <ExcelIcon size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip label={importingPurchases ? 'Mengimpor…' : 'Upload Excel'}>
                      <button onClick={() => importPurchaseFileRef.current?.click()} disabled={importingPurchases} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                        {importingPurchases ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      </button>
                    </Tooltip>
                    <input ref={importPurchaseFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) importPurchasesFromExcel(f); e.target.value = ''; }} />
                    {purchases.length > 0 && (
                      <Tooltip label="Export Excel">
                        <button onClick={() => exportPurchasesExcel(filteredPurchases, 'sesuai filter')} disabled={exportingPurchases} aria-label="Export Excel"
                          className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                          {exportingPurchases ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                        </button>
                      </Tooltip>
                    )}
                    {purchases.length > 0 && (
                      <Tooltip label="Export PDF">
                        <button onClick={() => exportPurchasesPdf(filteredPurchases, 'sesuai filter')} disabled={exportingPurchasesPdf} aria-label="Export PDF"
                          className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                          {exportingPurchasesPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                        </button>
                      </Tooltip>
                    )}
                    {purchases.length > 0 && <ViewToggle mode={purchaseView} onChange={setPurchaseView} height={HEADER_BTN_H} />}
                    <button onClick={openCreatePurchase} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                      <Plus size={13} /> <span className="hidden sm:inline">Catat Pembelian</span>
                    </button>
                  </div>
                </div>
              </div>

              {purchasesLoading && purchases.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
                </div>
              ) : purchases.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat pembelian.</p>
              ) : (
                <>
                  {paginatedPurchases.length > 0 && (
                    <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                      <Checkbox
                        checked={paginatedPurchases.every(p => selectedPurchases.has(p.id))}
                        indeterminate={paginatedPurchases.some(p => selectedPurchases.has(p.id)) && !paginatedPurchases.every(p => selectedPurchases.has(p.id))}
                        onChange={togglePurchasePageAll}
                      />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {selectedPurchases.size > 0 ? `${selectedPurchases.size} dipilih` : `${paginatedPurchases.length} pembelian di halaman ini`}
                      </span>
                    </div>
                  )}

                  {paginatedPurchases.length === 0 ? (
                    <div className="card py-10 text-center">
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada pembelian yang cocok.</p>
                    </div>
                  ) : purchaseView === 'table' ? (
                    <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                      {paginatedPurchases.map((p, idx) => {
                        const isSelected = selectedPurchases.has(p.id);
                        const rowNum = (purchaseSafePage - 1) * (Number.isFinite(purchasePageSize) ? purchasePageSize : 0) + idx + 1;
                        return (
                          <div key={p.id}>
                            <div className="px-4 py-3" style={{ background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, opacity: p.voided ? 0.55 : 1 }}>
                              <div className="flex items-start gap-3">
                                <div className="pt-0.5"><Checkbox checked={isSelected} onChange={() => toggleSelectPurchase(p.id)} /></div>
                                <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-0.5" style={{ color: 'var(--text-muted)' }}>
                                  {rowNum}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)', textDecoration: p.voided ? 'line-through' : undefined }}>{p.supplierName || 'Tanpa nama'}</p>
                                      {p.voided && <span className="badge badge-gray flex-shrink-0">Dibatalkan</span>}
                                      {!p.voided && p.paymentStatus === 'belum_lunas' && <span className="badge badge-amber flex-shrink-0">Belum Lunas</span>}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(p.total)}</span>
                                      {!p.voided && (
                                        <>
                                          {p.paymentStatus === 'belum_lunas' && (
                                            <button onClick={() => markPurchaseLunas(p.id)} disabled={markingPurchaseId === p.id}
                                              className="btn-ghost px-2.5 py-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                                              {markingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : 'Tandai Lunas'}
                                            </button>
                                          )}
                                          <Tooltip label="Edit">
                                            <button onClick={() => openEditPurchase(p)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }} title="Edit">
                                              <Pencil size={12} />
                                            </button>
                                          </Tooltip>
                                          <Tooltip label="Hapus">
                                            <button onClick={() => deletePurchase(p)} disabled={deletingPurchaseId === p.id}
                                              className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                              {deletingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                            </button>
                                          </Tooltip>
                                          <Tooltip label="Batalkan pembelian">
                                            <button onClick={() => voidPurchase(p)} disabled={voidingPurchaseId === p.id}
                                              className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} title="Batalkan (kalau tidak bisa dihapus)">
                                              {voidingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                                            </button>
                                          </Tooltip>
                                        </>
                                      )}
                                      <RecordHistoryButton open={purchaseHistoryId === p.id} onToggle={() => togglePurchaseHistory(p.id)} />
                                    </div>
                                  </div>
                                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{p.date ? formatDateDisplay(p.date) : formatDate(p.createdAt?.seconds)}</p>
                                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                                    {p.items.map(it => `${it.materialName} (${it.qty} ${it.unit})`).join(', ')}
                                  </p>
                                  {p.voided && p.voidNote && (
                                    <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>Alasan batal: {p.voidNote}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                            {purchaseHistoryId === p.id && <RecordHistoryPanel creds={creds} entity="material-purchases" entityId={p.id} />}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {paginatedPurchases.map(p => {
                        const isSelected = selectedPurchases.has(p.id);
                        return (
                          <div key={p.id}>
                            <div className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2, opacity: p.voided ? 0.55 : 1 }}>
                              <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                                <Checkbox checked={isSelected} onChange={() => toggleSelectPurchase(p.id)} />
                              </div>
                              <div className="pt-8 pb-3 px-4">
                                <div className="flex items-center gap-1.5 flex-wrap justify-center text-center">
                                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)', textDecoration: p.voided ? 'line-through' : undefined }}>{p.supplierName || 'Tanpa nama'}</p>
                                </div>
                                {p.voided && <div className="text-center mt-1"><span className="badge badge-gray">Dibatalkan</span></div>}
                                {!p.voided && p.paymentStatus === 'belum_lunas' && <div className="text-center mt-1"><span className="badge badge-amber">Belum Lunas</span></div>}
                                <p className="text-xs text-center mt-1" style={{ color: 'var(--text-muted)' }}>{p.date ? formatDateDisplay(p.date) : formatDate(p.createdAt?.seconds)}</p>
                                <p className="text-xs text-center mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                                  {p.items.map(it => `${it.materialName} (${it.qty} ${it.unit})`).join(', ')}
                                </p>
                                <p className="text-base font-extrabold tabular text-center mt-2" style={{ color: 'var(--success)' }}>{formatRp(p.total)}</p>
                              </div>
                              <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                                {!p.voided && (
                                  <>
                                    {p.paymentStatus === 'belum_lunas' && (
                                      <button onClick={() => markPurchaseLunas(p.id)} disabled={markingPurchaseId === p.id}
                                        className="btn-ghost px-2.5 py-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                                        {markingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : 'Tandai Lunas'}
                                      </button>
                                    )}
                                    <Tooltip label="Edit">
                                      <button onClick={() => openEditPurchase(p)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }} title="Edit">
                                        <Pencil size={12} />
                                      </button>
                                    </Tooltip>
                                    <Tooltip label="Hapus">
                                      <button onClick={() => deletePurchase(p)} disabled={deletingPurchaseId === p.id}
                                        className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                        {deletingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                      </button>
                                    </Tooltip>
                                    <Tooltip label="Batalkan pembelian">
                                      <button onClick={() => voidPurchase(p)} disabled={voidingPurchaseId === p.id}
                                        className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} title="Batalkan (kalau tidak bisa dihapus)">
                                        {voidingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                                      </button>
                                    </Tooltip>
                                  </>
                                )}
                                <RecordHistoryButton open={purchaseHistoryId === p.id} onToggle={() => togglePurchaseHistory(p.id)} />
                              </div>
                              {p.voided && p.voidNote && (
                                <p className="text-xs text-center px-4 pb-3 italic" style={{ color: 'var(--text-muted)' }}>Alasan batal: {p.voidNote}</p>
                              )}
                            </div>
                            {purchaseHistoryId === p.id && <RecordHistoryPanel creds={creds} entity="material-purchases" entityId={p.id} />}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {filteredPurchases.length > 0 && (
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {filteredPurchases.length} pembelian · halaman {purchaseSafePage} dari {purchaseTotalPages}
                        </p>
                        <PageSizeSelect value={purchasePageSize} onChange={n => { setPurchasePageSize(n); resetPurchasePage(); }} />
                      </div>
                      {purchaseTotalPages > 1 && (
                        <div className="flex items-center gap-1">
                          <Tooltip label="Halaman sebelumnya">
                            <button onClick={() => goPurchasePage(purchaseSafePage - 1)} disabled={purchaseSafePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                              <ChevronLeft size={14} />
                            </button>
                          </Tooltip>
                          {Array.from({ length: purchaseTotalPages }, (_, i) => i + 1)
                            .filter(n => n === 1 || n === purchaseTotalPages || Math.abs(n - purchaseSafePage) <= 1)
                            .reduce<(number | '…')[]>((acc, n, i, arr) => {
                              if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                              acc.push(n); return acc;
                            }, [])
                            .map((n, i) =>
                              n === '…'
                                ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                                : <button key={n} onClick={() => goPurchasePage(n as number)}
                                    className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                                    style={purchaseSafePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                                    {n}
                                  </button>
                            )
                          }
                          <Tooltip label="Halaman berikutnya">
                            <button onClick={() => goPurchasePage(purchaseSafePage + 1)} disabled={purchaseSafePage === purchaseTotalPages} className="btn-ghost p-2 disabled:opacity-30">
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
              {selectedPurchases.size > 0 && (
                <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
                  <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
                    style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
                    <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedPurchases.size} dipilih</span>
                    <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
                    <button onClick={bulkDeletePurchases} disabled={bulkDeletingPurchases}
                      className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                      style={{ background: 'var(--danger)', color: '#fff' }}>
                      {bulkDeletingPurchases ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Hapus
                    </button>
                    <button onClick={() => setSelectedPurchases(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showMForm && (
        <div className="modal-overlay" onClick={() => !savingM && setShowMForm(false)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Boxes size={17} /></div>
                <div>
                  <p className="modal-title">{editingM ? 'Edit Bahan Baku' : 'Tambah Bahan Baku Baru'}</p>
                  <p className="modal-subtitle">{editingM ? 'Perbarui nama & satuan' : 'Stok & harga rata-rata mulai dari pembelian pertama'}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowMForm(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="field-label">Nama Bahan Baku <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="text" value={mForm.name} onChange={e => setMForm({ ...mForm, name: e.target.value })}
                    placeholder="cth: Tepung Terigu" autoFocus className="input" />
                </div>
                <div>
                  <label className="field-label">Satuan <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="text" value={mForm.unit} onChange={e => setMForm({ ...mForm, unit: e.target.value })}
                    placeholder="cth: kg, liter, pcs" className="input" />
                </div>
                <div>
                  <label className="field-label">Stok Minimum (peringatan &quot;Stok Menipis&quot;)</label>
                  {/* input polos, BUKAN NumberInput — NumberInput cuma menerima bilangan bulat
                      (membuang titik desimal), padahal satuan bahan baku bisa pecahan (kg, liter) */}
                  <input type="number" min="0" step="any" inputMode="decimal" className="input"
                    value={mForm.minStock} onChange={e => setMForm({ ...mForm, minStock: e.target.value })}
                    placeholder="0 = tidak ada peringatan" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowMForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={saveMaterial} disabled={savingM || !mForm.name.trim() || !mForm.unit.trim()}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingM ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {savingM ? 'Menyimpan…' : editingM ? 'Simpan Perubahan' : 'Tambah Bahan Baku'}
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustingMaterial && (
        <div className="modal-overlay" onClick={() => !submittingAdjust && closeAdjust()}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Wrench size={17} /></div>
                <div>
                  <p className="modal-title">Koreksi Stok/Harga</p>
                  <p className="modal-subtitle">{adjustingMaterial.name}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeAdjust} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Membetulkan angka <strong>saat ini</strong> langsung — tidak mengubah riwayat pembelian/produksi yang sudah tercatat.
                  Stok sekarang: <strong className="tabular">{formatQty(adjustingMaterial.stockQty)} {adjustingMaterial.unit}</strong>,
                  harga rata-rata: <strong className="tabular">{formatRp(adjustingMaterial.avgCost)}</strong>.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Stok Benar ({adjustingMaterial.unit})</label>
                    <input type="number" min="0" value={adjustStockQty} onChange={e => setAdjustStockQty(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label className="field-label">Harga Rata-rata Benar (Rp)</label>
                    <NumberInput value={adjustAvgCost} onChange={setAdjustAvgCost} />
                  </div>
                </div>
                <div>
                  <label className="field-label">Alasan Koreksi <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <textarea value={adjustNote} onChange={e => setAdjustNote(e.target.value)}
                    className="input resize-none" rows={3} placeholder="cth: Stok opname fisik, koreksi salah input harga pembelian tgl 3 Agustus, dll" autoFocus />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeAdjust} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={submitAdjust} disabled={submittingAdjust || !adjustNote.trim()}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {submittingAdjust ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                {submittingAdjust ? 'Menyimpan…' : 'Simpan Koreksi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPurchaseForm && (
        <div className="modal-overlay" onClick={() => !submittingPurchase && closePurchaseForm()}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingBag size={17} /></div>
                <div>
                  <p className="modal-title">{editingPurchase ? 'Edit Pembelian' : 'Catat Pembelian Bahan Baku'}</p>
                  <p className="modal-subtitle">Stok & harga rata-rata bahan baku ter-update otomatis</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closePurchaseForm} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Supplier</label>
                    <SearchSelect value={supplierId}
                      onChange={id => { setSupplierId(id); const s = suppliers.find(ss => ss.id === id); if (s) setSupplierName(s.name); }}
                      options={supplierOptions} placeholder="– Pilih Supplier –" searchPlaceholder="Cari supplier…" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Nama Supplier <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)}
                      placeholder="Isi manual kalau supplier tidak terdaftar" className="input" />
                  </div>
                </div>

                <div>
                  <label style={fieldLabel}>Tanggal Pembelian <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="input" style={{ maxWidth: 220 }} />
                </div>

                <div>
                  <label style={fieldLabel}>Bahan Baku Dibeli</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rows.map((row, i) => {
                      const qty = parseFloat(row.qty) || 0;
                      const price = parseFloat(row.price) || 0;
                      const material = materials.find(m => m.id === row.materialId);
                      return (
                        <div key={i} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center gap-2 mb-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={row.materialId} onChange={id => updateRow(i, { materialId: id })}
                                options={materialOptions} placeholder="– Bahan baku –" searchPlaceholder="Cari bahan baku…" />
                            </div>
                            <Tooltip label="Hapus baris">
                              <button onClick={() => removeRow(i)} disabled={rows.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }} title="Hapus baris">
                                <X size={14} />
                              </button>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label style={fieldLabel}>{`Qty${material ? ` (${material.unit})` : ''}`}</label>
                              <input type="number" min="0" value={row.qty} onChange={e => updateRow(i, { qty: e.target.value })}
                                placeholder="0" className="input" />
                            </div>
                            <div>
                              <label style={fieldLabel}>Harga/satuan</label>
                              <NumberInput value={row.price} onChange={raw => updateRow(i, { price: raw })}
                                placeholder="0" />
                            </div>
                          </div>
                          {material && (
                            <p className="text-xs tabular mt-2" style={{ color: 'var(--text-muted)' }}>
                              Stok saat ini: {formatQty(material.stockQty)} {material.unit}
                              {qty > 0 && ` · Setelah pembelian: ${formatQty(material.stockQty + qty)} ${material.unit}`}
                            </p>
                          )}
                          {qty > 0 && price > 0 && (
                            <p className="text-xs tabular mt-1" style={{ color: 'var(--text-muted)' }}>
                              Subtotal: {formatRp(qty * price)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={addRow} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Bahan Baku
                  </button>
                </div>

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={purchaseNote} onChange={e => setPurchaseNote(e.target.value)}
                    placeholder="Catatan tambahan (opsional)" className="input" />
                </div>

                <div>
                  <label style={fieldLabel}>Dompet Sumber <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={purchaseWalletId} onChange={setPurchaseWalletId}
                    options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                  {purchaseWalletId && (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Saldo saat ini: {formatRp(walletBalances[purchaseWalletId] ?? 0)}
                    </p>
                  )}
                </div>

                <div>
                  <label style={fieldLabel}>Status Pembayaran</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['lunas', 'belum_lunas'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setPurchasePaymentStatus(s)}
                        className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                        style={purchasePaymentStatus === s ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {s === 'lunas' ? 'Lunas' : 'Belum Lunas'}
                      </button>
                    ))}
                  </div>
                  {purchasePaymentStatus === 'belum_lunas' && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Stok tetap bertambah sekarang, tapi belum tercatat sebagai Pengeluaran sampai ditandai Lunas.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Pembelian</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(purchaseTotal)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closePurchaseForm} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={submitPurchase} disabled={submittingPurchase || !canSubmitPurchase}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {submittingPurchase ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {submittingPurchase ? 'Menyimpan…' : editingPurchase ? 'Simpan Perubahan' : 'Simpan Pembelian'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
