'use client';

import { useState, useEffect, useRef } from 'react';
import ExcelJS from 'exceljs';
import {
  Factory, Plus, Pencil, Trash2, X, Check, Loader2, RefreshCw, AlertTriangle,
  Search, ChevronLeft, ChevronRight, Upload,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import TopbarPortal from '@/components/TopbarPortal';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import { RecordHistoryButton, RecordHistoryPanel } from '@/components/RecordHistory';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import type { PosProduct } from '@/lib/pos-types';

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
// seperti 0.00009999999999993348 — dibulatkan 2 desimal supaya tampilan tetap rapi.
const formatQty = (n: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateDisplay(iso?: string) {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface RawMaterial { id: string; name: string; unit: string; stockQty: number; avgCost: number }
interface BatchMaterialUsed { materialId?: string; materialName: string; unit: string; qty: number; costPerUnit: number; cost: number }
interface BatchOutput { productId: string; productName: string; yieldQty: number; costPerPcs: number }
interface Warehouse { id: string; name: string }
interface ProductionBatch {
  id: string; materialsUsed: BatchMaterialUsed[];
  materialCost: number; otherCost: number; totalCost: number; costPerPcs: number;
  date?: string; note?: string; createdAt?: { seconds: number };
  // Bentuk baru (multi-produk hasil)
  outputs?: BatchOutput[]; totalYieldQty?: number;
  // Bentuk lama (satu produk per batch) — dipertahankan supaya riwayat sebelum fitur ini tetap tampil benar
  productName?: string; yieldQty?: number;
  // Gudang tujuan stok hasil produksi — batch lama (sebelum fitur ini) tidak punya field ini
  warehouseId?: string; warehouseName?: string;
  // Dihitung backend (asumsi FIFO atas stok gudang saat ini) — true kalau stok hasil produksi
  // batch ini sudah habis (terjual/keluar semua)
  closed?: boolean;
  // true kalau sudah terjual sebagian tapi belum habis — sisa stoknya tidak lagi murni bisa
  // dianggap milik batch ini saja (tercampur dengan batch produksi lain di produk+gudang yang sama)
  mixed?: boolean;
}

function productionStatusBadge(b: ProductionBatch) {
  if (b.closed) return { label: 'Stok Habis', cls: 'badge-gray' };
  if (b.mixed)  return { label: 'Tercampur Produksi Lain', cls: 'badge-amber' };
  return { label: 'Stok Tersedia', cls: 'badge-green' };
}

// Normalisasi batch lama & baru jadi satu bentuk "outputs" supaya tampilan riwayat konsisten
function batchOutputs(b: ProductionBatch): { productName: string; yieldQty: number }[] {
  if (b.outputs && b.outputs.length > 0) return b.outputs.map(o => ({ productName: o.productName, yieldQty: o.yieldQty }));
  if (b.productName) return [{ productName: b.productName, yieldQty: b.yieldQty ?? 0 }];
  return [];
}
function batchTotalYield(b: ProductionBatch): number {
  return b.totalYieldQty ?? b.yieldQty ?? 0;
}
// Data lama (sebelum fitur multi-produk & id bahan baku tersimpan) tidak bisa dihitung ulang
// dengan tepat kalau diedit/dihapus (tidak ada productId/materialId) — jadi dikunci read-only.
function isEditableBatch(b: ProductionBatch): boolean {
  return !!b.outputs && b.outputs.length > 0 && b.materialsUsed.every(m => !!m.materialId);
}

interface MaterialRow { materialId: string; qty: string }
const EMPTY_ROW: MaterialRow = { materialId: '', qty: '' };

interface OutputRow { productId: string; qty: string }
const EMPTY_OUTPUT_ROW: OutputRow = { productId: '', qty: '' };

export default function ProductionTab({ creds, products }: { creds: string; products: PosProduct[] }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const storeHeader = useStoreHeader(creds);

  const [materials,        setMaterials]        = useState<RawMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const loadMaterials = async () => {
    setMaterialsLoading(true);
    const r = await fetch(`${API}/api/materials`, { headers });
    if (r.ok) setMaterials((await r.json() as { materials: RawMaterial[] }).materials);
    setMaterialsLoading(false);
  };

  const [batches,        setBatches]        = useState<ProductionBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const loadBatches = async () => {
    setBatchesLoading(true);
    const r = await fetch(`${API}/api/production?limit=50`, { headers });
    if (r.ok) setBatches((await r.json() as { batches: ProductionBatch[] }).batches);
    setBatchesLoading(false);
  };

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const loadWarehouses = async () => {
    const r = await fetch(`${API}/api/warehouses`, { headers });
    if (r.ok) setWarehouses((await r.json() as { warehouses: Warehouse[] }).warehouses);
  };

  useEffect(() => { loadMaterials(); loadBatches(); loadWarehouses(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Form tambah/edit (modal) ──────────────────────────────────
  const [showForm,     setShowForm]     = useState(false);
  const [editingBatch, setEditingBatch] = useState<ProductionBatch | null>(null);
  const [date,       setDate]       = useState(todayISO());
  const [outputRows, setOutputRows] = useState<OutputRow[]>([{ ...EMPTY_OUTPUT_ROW }]);
  const [rows,       setRows]       = useState<MaterialRow[]>([{ ...EMPTY_ROW }]);
  const [warehouseId, setWarehouseId] = useState('');
  const [otherCost,  setOtherCost]  = useState('');
  const [note,       setNote]       = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setEditingBatch(null); setDate(todayISO());
    setOutputRows([{ ...EMPTY_OUTPUT_ROW }]); setRows([{ ...EMPTY_ROW }]);
    setWarehouseId(warehouses.length === 1 ? warehouses[0].id : '');
    setOtherCost(''); setNote('');
  };
  const openCreate = () => { resetForm(); setShowForm(true); };
  const openEdit = (b: ProductionBatch) => {
    setEditingBatch(b);
    setDate(b.date || todayISO());
    setOutputRows((b.outputs ?? []).map(o => ({ productId: o.productId, qty: String(o.yieldQty) })));
    setRows(b.materialsUsed.map(m => ({ materialId: m.materialId ?? '', qty: String(m.qty) })));
    setWarehouseId(b.warehouseId ?? (warehouses.length === 1 ? warehouses[0].id : ''));
    setOtherCost(b.otherCost ? String(b.otherCost) : '');
    setNote(b.note ?? '');
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); resetForm(); };

  const addOutputRow    = () => setOutputRows(prev => [...prev, { ...EMPTY_OUTPUT_ROW }]);
  const removeOutputRow = (i: number) => setOutputRows(prev => prev.filter((_, idx) => idx !== i));
  const updateOutputRow = (i: number, patch: Partial<OutputRow>) => setOutputRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const addRow    = () => setRows(prev => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<MaterialRow>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  // Saat edit, stok bahan baku yang ditampilkan sudah dikembalikan (belum dikonsumsi ulang oleh
  // batch ini) supaya validasi kekurangan stok di form tidak salah tuduh dengan qty batch lama sendiri.
  const effectiveMaterials = editingBatch
    ? materials.map(m => {
        const used = editingBatch.materialsUsed.find(u => u.materialId === m.id);
        return used ? { ...m, stockQty: m.stockQty + used.qty } : m;
      })
    : materials;

  const usedRows = rows
    .filter(r => r.materialId && (parseFloat(r.qty) || 0) > 0)
    .map(r => {
      const material = effectiveMaterials.find(m => m.id === r.materialId)!;
      const qty = parseFloat(r.qty) || 0;
      return { material, qty, cost: material.avgCost * qty, shortage: qty > material.stockQty };
    });

  const usedOutputRows = outputRows
    .filter(r => r.productId && (parseFloat(r.qty) || 0) > 0)
    .map(r => ({ product: products.find(p => p.id === r.productId)!, qty: parseFloat(r.qty) || 0 }));

  const materialCost = usedRows.reduce((s, r) => s + r.cost, 0);
  const otherCostNum = parseFloat(otherCost) || 0;
  const totalCost     = materialCost + otherCostNum;
  const totalYieldQty = usedOutputRows.reduce((s, r) => s + r.qty, 0);
  const costPerPcs    = totalYieldQty > 0 ? totalCost / totalYieldQty : 0;
  const hasShortage   = usedRows.some(r => r.shortage);

  const canSubmit = !!date && !!warehouseId && usedOutputRows.length > 0 && usedRows.length > 0 && !hasShortage;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const warehouse = warehouses.find(w => w.id === warehouseId);
      const payload = {
        date,
        outputs: usedOutputRows.map(r => ({ productId: r.product.id, productName: r.product.name, yieldQty: r.qty })),
        materialsUsed: usedRows.map(r => ({ materialId: r.material.id, materialName: r.material.name, unit: r.material.unit, qty: r.qty })),
        warehouseId, warehouseName: warehouse?.name ?? '',
        otherCost: otherCostNum, note,
      };
      const res = editingBatch
        ? await fetch(`${API}/api/production/${editingBatch.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(`${API}/api/production`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const dataRes = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast.error(dataRes.error ?? 'Gagal menyimpan produksi.'); return; }
      const productLabel = usedOutputRows.map(r => `${r.product.name} (${r.qty} pcs)`).join(', ');
      toast.success(editingBatch
        ? `Produksi berhasil diperbarui — HPP ${formatRp(costPerPcs)}/pcs untuk ${productLabel}.`
        : `Produksi tersimpan — HPP ${formatRp(costPerPcs)}/pcs untuk ${productLabel}.`);
      closeForm();
      await Promise.all([loadMaterials(), loadBatches()]);
    } finally { setSubmitting(false); }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleteBatch = async (b: ProductionBatch) => {
    const label = batchOutputs(b).map(o => o.productName).join(' & ');
    if (!await confirm({ message: `Hapus batch produksi "${label}"? Stok bahan baku akan dikembalikan & stok produk hasil dikurangi lagi. Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(b.id);
    const r = await fetch(`${API}/api/production/${b.id}`, { method: 'DELETE', headers });
    const dataRes = await r.json().catch(() => ({})) as { error?: string };
    if (r.ok) {
      setBatches(prev => prev.filter(x => x.id !== b.id));
      setSelected(s => { const n = new Set(s); n.delete(b.id); return n; });
      toast.success('Batch produksi berhasil dihapus, stok dikembalikan.');
      await loadMaterials();
    } else toast.error(dataRes.error ?? 'Gagal menghapus batch produksi.');
    setDeletingId(null);
  };

  // ── Pencarian, tampilan, paginasi, pilih massal ───────────────
  const [search,   setSearch]   = useState('');
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [view, setView] = useViewMode('production');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const toggleHistory = (id: string) => setHistoryId(cur => cur === id ? null : id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} batch produksi yang dipilih? Stok bahan baku & produk terkait akan dikembalikan/dikurangi lagi.`, danger: true })) return;
    setBulkDeleting(true);
    const ids = [...selected];
    let okCount = 0, blockedCount = 0;
    for (const id of ids) {
      const r = await fetch(`${API}/api/production/${id}`, { method: 'DELETE', headers });
      if (r.ok) okCount++; else blockedCount++;
    }
    setSelected(new Set());
    await Promise.all([loadMaterials(), loadBatches()]);
    if (okCount > 0) toast.success(`${okCount} batch produksi berhasil dihapus.${blockedCount > 0 ? ` ${blockedCount} dilewati karena produknya sudah diproduksi lagi atau stoknya sudah terjual/keluar.` : ''}`);
    else toast.error('Semua batch yang dipilih tidak bisa dihapus (produknya sudah diproduksi lagi atau stoknya sudah terjual/keluar).');
    setBulkDeleting(false);
  };

  // ── Export / Import Excel ──────────────────────────────────────
  const exportProductionExcel = async (rows: ProductionBatch[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada riwayat produksi untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Produksi');
      ws.columns = [
        { key: 'no', width: 5 }, { key: 'tgl', width: 14 }, { key: 'produk', width: 32 },
        { key: 'bahan', width: 40 }, { key: 'biayaBahan', width: 16 }, { key: 'biayaLain', width: 16 },
        { key: 'total', width: 16 }, { key: 'hpp', width: 14 }, { key: 'gudang', width: 18 }, { key: 'catatan', width: 28 },
      ];

      ws.mergeCells(1, 1, 1, 10);
      const t = ws.getCell(1, 1);
      t.value = 'RIWAYAT PRODUKSI — CEMILAN TEH RISMA';
      t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, 10);
      const s = ws.getCell(2, 1);
      s.value = `${rows.length} batch produksi (${label})`;
      s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      s.alignment = { horizontal: 'center', vertical: 'middle' };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const headerRow = ws.getRow(3);
      ['No', 'Tanggal', 'Produk Hasil', 'Bahan Baku', 'Biaya Bahan', 'Biaya Lain', 'Total Biaya', 'HPP/pcs', 'Gudang', 'Catatan']
        .forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];

      rows.forEach((b, i) => {
        const rowNum = 4 + i;
        const row = ws.getRow(rowNum);
        row.getCell(1).value = i + 1;
        row.getCell(2).value = formatDateDisplay(b.date);
        row.getCell(3).value = batchOutputs(b).map(o => `${o.productName}: ${o.yieldQty} pcs`).join('; ');
        row.getCell(4).value = b.materialsUsed.map(m => `${m.materialName}: ${m.qty} ${m.unit}`).join('; ');
        row.getCell(5).value = b.materialCost; row.getCell(5).numFmt = '"Rp"#,##0';
        row.getCell(6).value = b.otherCost;    row.getCell(6).numFmt = '"Rp"#,##0';
        row.getCell(7).value = b.totalCost;    row.getCell(7).numFmt = '"Rp"#,##0';
        row.getCell(8).value = b.costPerPcs;   row.getCell(8).numFmt = '"Rp"#,##0';
        row.getCell(9).value = b.warehouseName ?? '';
        row.getCell(10).value = b.note ?? '';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.alignment = { wrapText: true, vertical: 'middle' };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `produksi-karyaputra-${todayISO()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} batch produksi ke Excel.`);
    } finally { setExporting(false); }
  };

  const exportProductionPdf = async (rows: ProductionBatch[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada riwayat produksi untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'RIWAYAT PRODUKSI',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '4%', align: 'center' },
              { header: 'Tanggal', width: '8%' },
              { header: 'Produk Hasil', width: '13%' },
              { header: 'Bahan Baku', width: '20%' },
              { header: 'Biaya Bahan', width: '9%', align: 'right' },
              { header: 'Biaya Lain', width: '8%', align: 'right' },
              { header: 'Total Biaya', width: '9%', align: 'right', bold: true },
              { header: 'HPP/pcs', width: '8%', align: 'right' },
              { header: 'Gudang', width: '8%' },
              { header: 'Catatan', width: '13%' },
            ],
            rows: rows.map((b, i) => [
              i + 1,
              formatDateDisplay(b.date),
              batchOutputs(b).map(o => `${o.productName}: ${o.yieldQty} pcs`).join('; '),
              b.materialsUsed.map(m => `${m.materialName}: ${m.qty} ${m.unit}`).join('; '),
              formatRp(b.materialCost),
              formatRp(b.otherCost),
              formatRp(b.totalCost),
              formatRp(b.costPerPcs),
              b.warehouseName ?? '-',
              b.note || '-',
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `produksi-karyaputra-${todayISO()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} batch produksi ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally { setExportingPdf(false); }
  };

  const PRODUCTION_TEMPLATE_COLS = [
    { header: 'Tanggal* (YYYY-MM-DD)', key: 'tgl', width: 20 },
    { header: 'Gudang Tujuan*', key: 'gudang', width: 18 },
    { header: 'Produk Hasil* (Nama:Qty; Nama2:Qty2)', key: 'produk', width: 34 },
    { header: 'Bahan Baku* (Nama:Qty; Nama2:Qty2)', key: 'bahan', width: 34 },
    { header: 'Biaya Lain (Rp)', key: 'biayaLain', width: 16 },
    { header: 'Catatan', key: 'catatan', width: 28 },
  ];

  const downloadProductionTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Produksi');
    ws.columns = PRODUCTION_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, PRODUCTION_TEMPLATE_COLS.length);
    const info = ws.getCell(1, 1);
    info.value = 'Kolom bertanda * wajib diisi. Untuk produk hasil / bahan baku lebih dari satu, pisahkan dengan " ; " — nama harus sama persis dengan nama di menu Produk / Bahan Baku.';
    info.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
    info.alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(1).height = 30;

    const headerRow = ws.getRow(2);
    PRODUCTION_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
    headerRow.height = 28;
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    const exampleMaterial = materials[0];
    const exampleProduct  = products[0];
    const exampleRow = ws.getRow(3);
    exampleRow.getCell(1).value = todayISO();
    exampleRow.getCell(2).value = warehouses[0]?.name ?? 'Gudang Utama';
    exampleRow.getCell(3).value = exampleProduct ? `${exampleProduct.name}:10` : 'Keripik Original:10';
    exampleRow.getCell(4).value = exampleMaterial ? `${exampleMaterial.name}:1` : 'Tepung:1';
    exampleRow.getCell(5).value = 0;
    exampleRow.getCell(6).value = 'Contoh baris — hapus sebelum upload';
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-produksi.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Parse "Nama:Qty; Nama2:Qty2" -> [{ name, qty }]
  const parseNameQtyList = (raw: string): { name: string; qty: number }[] =>
    raw.split(';').map(part => part.trim()).filter(Boolean).map(part => {
      const idx = part.lastIndexOf(':');
      const name = (idx === -1 ? part : part.slice(0, idx)).trim();
      const qty  = idx === -1 ? 0 : parseFloat(part.slice(idx + 1).replace(',', '.')) || 0;
      return { name, qty };
    });

  const importProductionFromExcel = async (file: File) => {
    setImporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel kosong atau format tidak dikenali.'); return; }

      // Cari baris header (mengandung kolom "Tanggal") di antara 5 baris pertama
      let headerRowNum = -1;
      for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
        const values = ws.getRow(r).values as unknown[];
        if (values.some(v => typeof v === 'string' && v.toLowerCase().includes('tanggal'))) { headerRowNum = r; break; }
      }
      if (headerRowNum === -1) { toast.error('Baris header (Tanggal, Gudang, Produk Hasil, dst) tidak ditemukan.'); return; }

      const errors: string[] = [];
      let created = 0;
      for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const get = (col: number) => { const v = row.getCell(col).value; return v == null ? '' : String(v).trim(); };
        const tglRaw = get(1), gudangRaw = get(2), produkRaw = get(3), bahanRaw = get(4), biayaLainRaw = get(5), catatanRaw = get(6);
        if (!tglRaw && !gudangRaw && !produkRaw && !bahanRaw) continue; // baris kosong, lewati

        const rowLabel = `Baris ${r}`;
        const warehouse = warehouses.find(w => w.name.toLowerCase() === gudangRaw.toLowerCase());
        if (!warehouse) { errors.push(`${rowLabel}: gudang "${gudangRaw}" tidak ditemukan.`); continue; }

        const outputParsed = parseNameQtyList(produkRaw);
        const outputs: { productId: string; productName: string; yieldQty: number }[] = [];
        let outputError = '';
        for (const o of outputParsed) {
          const product = products.find(p => p.name.toLowerCase() === o.name.toLowerCase());
          if (!product) { outputError = `produk "${o.name}" tidak ditemukan`; break; }
          if (o.qty <= 0) { outputError = `jumlah produk "${o.name}" harus lebih dari 0`; break; }
          outputs.push({ productId: product.id, productName: product.name, yieldQty: o.qty });
        }
        if (outputError) { errors.push(`${rowLabel}: ${outputError}.`); continue; }
        if (outputs.length === 0) { errors.push(`${rowLabel}: kolom Produk Hasil kosong.`); continue; }

        const materialParsed = parseNameQtyList(bahanRaw);
        const materialsUsed: { materialId: string; materialName: string; unit: string; qty: number }[] = [];
        let materialError = '';
        for (const m of materialParsed) {
          const material = materials.find(x => x.name.toLowerCase() === m.name.toLowerCase());
          if (!material) { materialError = `bahan baku "${m.name}" tidak ditemukan`; break; }
          if (m.qty <= 0) { materialError = `jumlah bahan baku "${m.name}" harus lebih dari 0`; break; }
          materialsUsed.push({ materialId: material.id, materialName: material.name, unit: material.unit, qty: m.qty });
        }
        if (materialError) { errors.push(`${rowLabel}: ${materialError}.`); continue; }
        if (materialsUsed.length === 0) { errors.push(`${rowLabel}: kolom Bahan Baku kosong.`); continue; }

        const payload = {
          date: /^\d{4}-\d{2}-\d{2}$/.test(tglRaw) ? tglRaw : todayISO(),
          outputs, materialsUsed,
          warehouseId: warehouse.id, warehouseName: warehouse.name,
          otherCost: parseFloat(biayaLainRaw.replace(/[^0-9.-]/g, '')) || 0,
          note: catatanRaw,
        };
        const res = await fetch(`${API}/api/production`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) created++;
        else {
          const err = await res.json().catch(() => ({})) as { error?: string };
          errors.push(`${rowLabel}: ${err.error ?? 'gagal disimpan'}.`);
        }
      }

      await Promise.all([loadMaterials(), loadBatches()]);
      if (created > 0) toast.success(`${created} batch produksi berhasil diimport.${errors.length > 0 ? ` ${errors.length} baris dilewati.` : ''}`);
      if (errors.length > 0) toast.error(errors.slice(0, 3).join(' ') + (errors.length > 3 ? ` (+${errors.length - 3} lainnya)` : ''));
      if (created === 0 && errors.length === 0) toast.error('Tidak ada baris data yang bisa diimport.');
    } finally { setImporting(false); }
  };

  const resetPage = () => setPage(1);
  const filteredBatches = batches.filter(b => {
    if (!search) return true;
    const q = search.toLowerCase();
    return batchOutputs(b).some(o => o.productName.toLowerCase().includes(q))
      || (b.note ?? '').toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginatedBatches = filteredBatches.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

  const togglePageAll = () => {
    // Batch yang stoknya sudah habis tidak bisa diedit/dihapus, jadi tidak ikut dipilih massal.
    const pageIds     = paginatedBatches.filter(b => !b.closed).map(b => b.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const productOptions  = products.map(p => ({ value: p.id, label: p.name, imageUrl: p.imageUrls?.[0], emoji: p.emoji }));
  // Hanya tampilkan bahan baku yang masih ada stoknya; bahan yang sudah dipilih di baris tetap
  // ditampilkan meski stoknya 0 supaya baris yang sudah terisi tidak jadi kosong.
  const selectedMaterialIds = new Set(rows.map(r => r.materialId).filter(Boolean));
  const materialOptions = effectiveMaterials
    .filter(m => m.stockQty > 0 || selectedMaterialIds.has(m.id))
    .map(m => ({ value: m.id, label: m.name, sublabel: `Stok ${formatQty(m.stockQty)} ${m.unit}` }));
  const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };

  return (
    <>
    <div className="p-4 lg:p-6 animate-fade-up space-y-5">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={() => { loadMaterials(); loadBatches(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={materialsLoading || batchesLoading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      {/* Header: search + actions */}
      {batches.length > 0 && (
        <div className="flex flex-row items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari nama produk / catatan…"
            />
          </div>
          <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
            <Tooltip label="Unduh Template">
              <button onClick={downloadProductionTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                <ExcelIcon size={14} />
              </button>
            </Tooltip>
            <Tooltip label={importing ? 'Mengimpor…' : 'Upload Excel'}>
              <button onClick={() => importFileRef.current?.click()} disabled={importing} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              </button>
            </Tooltip>
            <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) importProductionFromExcel(f); e.target.value = ''; }} />
            <Tooltip label="Export Excel">
              <button onClick={() => exportProductionExcel(filteredBatches, 'sesuai filter')} disabled={exporting} aria-label="Export Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
              </button>
            </Tooltip>
            <Tooltip label="Export PDF">
              <button onClick={() => exportProductionPdf(filteredBatches, 'sesuai filter')} disabled={exportingPdf} aria-label="Export PDF" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
              </button>
            </Tooltip>
            <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
            <button onClick={openCreate} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
              <Plus size={13} /> <span className="hidden sm:inline">Catat Produksi</span>
            </button>
          </div>
        </div>
      )}

      {batchesLoading && batches.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : batches.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
            <Factory size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada riwayat produksi</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>Catat produksi untuk mengurangi stok bahan baku & menambah stok produk</p>
          <button onClick={openCreate} className="btn-primary mx-auto px-5 py-2.5 text-sm">
            <Plus size={14} /> Catat Produksi Pertama
          </button>
        </div>
      ) : (
        <>
          {paginatedBatches.length > 0 && (() => {
            const selectableIds = paginatedBatches.filter(b => !b.closed).map(b => b.id);
            return (
              <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                <Checkbox
                  checked={selectableIds.length > 0 && selectableIds.every(id => selected.has(id))}
                  indeterminate={selectableIds.some(id => selected.has(id)) && !selectableIds.every(id => selected.has(id))}
                  onChange={togglePageAll}
                />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selected.size > 0 ? `${selected.size} dipilih` : `${paginatedBatches.length} batch di halaman ini`}
                </span>
              </div>
            );
          })()}

          {paginatedBatches.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada riwayat produksi yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
              {paginatedBatches.map((b, i) => {
                const isSelected = selected.has(b.id);
                // Batch yang stoknya sudah habis dikunci: tidak bisa dipilih/diedit/dihapus lagi.
                const manageable = isEditableBatch(b) && !b.closed;
                const rowNumber  = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + i + 1;
                return (
                  <div key={b.id}>
                    <div className="px-4 py-3 flex items-center gap-3" style={{ background: isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                      {b.closed
                        ? <span className="flex-shrink-0 w-[18px] h-[18px]" />
                        : <Checkbox checked={isSelected} onChange={() => toggleSelect(b.id)} />}
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>{rowNumber}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {batchOutputs(b).map(o => o.productName).join(' & ')}
                          </p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>+{batchTotalYield(b)} pcs</span>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {manageable && (
                                <>
                                  <Tooltip label="Edit">
                                    <button onClick={() => openEdit(b)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }} title="Edit">
                                      <Pencil size={13} />
                                    </button>
                                  </Tooltip>
                                  <Tooltip label="Hapus">
                                    <button onClick={() => deleteBatch(b)} disabled={deletingId === b.id} className="btn-ghost p-2" style={{ color: 'var(--danger)' }} title="Hapus">
                                      {deletingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                    </button>
                                  </Tooltip>
                                </>
                              )}
                              <RecordHistoryButton open={historyId === b.id} onToggle={() => toggleHistory(b.id)} />
                              <Tooltip label="Lihat detail">
                                <button onClick={() => setExpandedId(expandedId === b.id ? null : b.id)} className="btn-ghost p-2">
                                  <ChevronRight size={13} style={{ transform: expandedId === b.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                                </button>
                              </Tooltip>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(b.date)}</p>
                          {b.warehouseId && (
                            <span className={`badge ${productionStatusBadge(b).cls}`} style={{ fontSize: 10 }}>
                              {productionStatusBadge(b).label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs mt-1 tabular" style={{ color: 'var(--text-muted)' }}>
                          Total biaya {formatRp(b.totalCost)} · HPP {formatRp(b.costPerPcs)}/pcs
                        </p>
                        {!manageable && (
                          <p className="text-[11px] mt-1 italic" style={{ color: 'var(--text-muted)' }}>
                            {b.closed ? 'Stok sudah habis — tidak bisa diedit/dihapus.' : 'Data lama — tidak bisa diedit/dihapus.'}
                          </p>
                        )}
                      </div>
                    </div>
                    {expandedId === b.id && <ProductionDetail b={b} />}
                    {historyId === b.id && <RecordHistoryPanel creds={creds} entity="production" entityId={b.id} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginatedBatches.map(b => {
                const isSelected = selected.has(b.id);
                const manageable = isEditableBatch(b) && !b.closed;
                return (
                  <div key={b.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    {!b.closed && (
                      <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                        <Checkbox checked={isSelected} onChange={() => toggleSelect(b.id)} />
                      </div>
                    )}
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        <Factory size={20} />
                      </div>
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {batchOutputs(b).map(o => o.productName).join(' & ')}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(b.date)}</p>
                      {b.warehouseId && (
                        <span className={`badge ${productionStatusBadge(b).cls}`} style={{ fontSize: 10 }}>
                          {productionStatusBadge(b).label}
                        </span>
                      )}
                      <p className="text-sm font-extrabold tabular mt-1" style={{ color: 'var(--accent)' }}>+{batchTotalYield(b)} pcs</p>
                      <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                        Total biaya {formatRp(b.totalCost)} · HPP {formatRp(b.costPerPcs)}/pcs
                      </p>
                      {!manageable && (
                        <p className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>
                          {b.closed ? 'Stok sudah habis — tidak bisa diedit/dihapus.' : 'Data lama — tidak bisa diedit/dihapus.'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <button onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                        className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                        Detail <ChevronRight size={12} style={{ transform: expandedId === b.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <RecordHistoryButton open={historyId === b.id} onToggle={() => toggleHistory(b.id)} />
                        {manageable && (
                          <>
                            <Tooltip label="Edit">
                              <button onClick={() => openEdit(b)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                                <Pencil size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Hapus">
                              <button onClick={() => deleteBatch(b)} disabled={deletingId === b.id} className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }}>
                                {deletingId === b.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </div>
                    {expandedId === b.id && <ProductionDetail b={b} />}
                    {historyId === b.id && <RecordHistoryPanel creds={creds} entity="production" entityId={b.id} />}
                  </div>
                );
              })}
            </div>
          )}

          {filteredBatches.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filteredBatches.length} batch · halaman {safePage} dari {totalPages}
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
    </div>

    {/* Modal tambah/edit produksi */}
    {showForm && (
        <div className="modal-overlay" onClick={() => !submitting && closeForm()}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Factory size={17} /></div>
                <div>
                  <p className="modal-title">{editingBatch ? 'Edit Produksi' : 'Catat Produksi Baru'}</p>
                  <p className="modal-subtitle">
                    {editingBatch
                      ? 'Stok bahan baku & produk akan disesuaikan ulang sesuai perubahan'
                      : 'Bahan baku terpakai otomatis mengurangi stok, produk hasil menambah stok'}
                  </p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={closeForm} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Tanggal Produksi <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Gudang Tujuan <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <SearchSelect value={warehouseId} onChange={setWarehouseId}
                      options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                      placeholder="– Pilih Gudang –" searchPlaceholder="Cari gudang…" />
                  </div>
                </div>
                {warehouses.length === 0 && (
                  <p className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    <AlertTriangle size={12} /> Belum ada gudang — tambahkan gudang dulu di menu Gudang sebelum catat produksi.
                  </p>
                )}

                <div>
                  <label style={fieldLabel}>Produk Hasil <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {outputRows.map((row, i) => {
                      // Produk yang sudah dipilih di baris LAIN disembunyikan — pilih produk yang sama
                      // dua kali diam-diam menjumlahkan qty-nya jadi produksi ganda (lihat komentar
                      // mergeOutputs di lib/materials-pg.ts), jadi baris yang sudah ada harus diedit
                      // langsung angkanya, bukan ditambah baris baru untuk produk yang sama.
                      const otherProductIds = new Set(outputRows.filter((_, idx) => idx !== i).map(r => r.productId).filter(Boolean));
                      const rowProductOptions = productOptions.filter(o => !otherProductIds.has(o.value));
                      return (
                      <div key={i} className="flex items-center gap-2">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <SearchSelect value={row.productId} onChange={id => updateOutputRow(i, { productId: id })}
                            options={rowProductOptions} placeholder="– Pilih Produk –" searchPlaceholder="Cari produk…" />
                        </div>
                        {/* min="0" tidak menolak tanda minus saat diketik — tanpa kloning ke '0' di
                            sini, baris dengan qty negatif diam-diam hilang dari total (di-filter
                            bersama baris yang memang belum diisi) tanpa pesan apa pun. */}
                        <input type="number" min="0" value={row.qty}
                          onChange={e => updateOutputRow(i, { qty: e.target.value !== '' && Number(e.target.value) < 0 ? '0' : e.target.value })}
                          placeholder="Qty" className="input" style={{ width: 84, flexShrink: 0, textAlign: 'center' }} />
                        <Tooltip label="Hapus baris">
                          <button onClick={() => removeOutputRow(i)} disabled={outputRows.length === 1}
                            className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }} title="Hapus baris">
                            <X size={14} />
                          </button>
                        </Tooltip>
                      </div>
                      );
                    })}
                  </div>
                  <button onClick={addOutputRow} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Produk Hasil (mis. varian rasa lain)
                  </button>
                </div>

                <div>
                  <label style={fieldLabel}>Bahan Baku Dipakai</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rows.map((row, i) => {
                      const material = effectiveMaterials.find(m => m.id === row.materialId);
                      const qty = parseFloat(row.qty) || 0;
                      const shortage = !!material && qty > material.stockQty;
                      // Bahan yang sudah dipilih di baris lain disembunyikan — sama alasannya dengan
                      // produk hasil di atas, cegah qty terpisah untuk material yang sama.
                      const otherMaterialIds = new Set(rows.filter((_, idx) => idx !== i).map(r => r.materialId).filter(Boolean));
                      const rowMaterialOptions = materialOptions.filter(o => !otherMaterialIds.has(o.value));
                      return (
                        <div key={i}>
                          <div className="flex items-center gap-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={row.materialId} onChange={id => updateRow(i, { materialId: id })}
                                options={rowMaterialOptions} placeholder="– Bahan baku –" searchPlaceholder="Cari bahan baku…" />
                            </div>
                            {/* Lihat komentar sama di input qty output di atas — cegah negatif
                                langsung di sini, bukan hanya menyaringnya diam-diam dari total. */}
                            <input type="number" min="0" value={row.qty}
                              onChange={e => updateRow(i, { qty: e.target.value !== '' && Number(e.target.value) < 0 ? '0' : e.target.value })}
                              placeholder={`Qty${material ? ` (${material.unit})` : ''}`} className="input" style={{ width: 84, flexShrink: 0, textAlign: 'center' }} />
                            <Tooltip label="Hapus baris">
                              <button onClick={() => removeRow(i)} disabled={rows.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }} title="Hapus baris">
                                <X size={14} />
                              </button>
                            </Tooltip>
                          </div>
                          {material && (
                            <p className="text-xs tabular mt-1.5" style={{ color: shortage ? 'var(--danger)' : 'var(--text-muted)' }}>
                              {qty === 0
                                ? `Stok tersedia: ${formatQty(material.stockQty)} ${material.unit}`
                                : shortage
                                ? `Stok kurang — tersedia ${formatQty(material.stockQty)} ${material.unit}`
                                : `Biaya: ${formatRp(material.avgCost * qty)} (stok tersisa ${formatQty(material.stockQty - qty)} ${material.unit})`}
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Biaya Lain (Tenaga Kerja/Overhead, opsional)</label>
                    <NumberInput value={otherCost} onChange={setOtherCost} placeholder="0" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Total Hasil Produksi (pcs)</label>
                    <input type="number" value={totalYieldQty || ''} readOnly disabled className="input" style={{ opacity: 0.7 }} placeholder="0" />
                  </div>
                </div>

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Catatan tambahan (opsional)" className="input" />
                </div>

                {(materialCost > 0 || otherCostNum > 0) && (
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="card p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Biaya Bahan</p>
                      <p className="text-sm font-extrabold tabular mt-1" style={{ color: 'var(--text-primary)' }}>{formatRp(materialCost)}</p>
                    </div>
                    <div className="card p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Total Biaya</p>
                      <p className="text-sm font-extrabold tabular mt-1" style={{ color: 'var(--text-primary)' }}>{formatRp(totalCost)}</p>
                    </div>
                    <div className="card p-3" style={{ background: 'var(--accent-bg)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>HPP / pcs (semua produk hasil)</p>
                      <p className="text-sm font-extrabold tabular mt-1" style={{ color: 'var(--accent)' }}>{totalYieldQty > 0 ? formatRp(costPerPcs) : '–'}</p>
                    </div>
                  </div>
                )}

                {hasShortage && (
                  <p className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    <AlertTriangle size={12} /> Ada bahan baku dengan stok kurang — catat pembelian dulu di menu Bahan Baku sebelum simpan produksi.
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeForm} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={submit} disabled={submitting || !canSubmit}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {submitting ? 'Menyimpan…' : editingBatch ? 'Simpan Perubahan' : 'Simpan Produksi'}
              </button>
            </div>
          </div>
        </div>
    )}
    </>
  );
}

function ProductionDetail({ b }: { b: ProductionBatch }) {
  const outputs = b.outputs && b.outputs.length > 0 ? b.outputs : null;
  const detailRow: React.CSSProperties = { color: 'var(--text-secondary)' };
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      {b.note && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Catatan</p>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{b.note}</p>
        </div>
      )}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Produk Hasil</p>
        <div className="space-y-0.5">
          {outputs
            ? outputs.map((o, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3">
                  <p className="text-xs font-medium" style={detailRow}>{o.productName}: {o.yieldQty} pcs</p>
                  <p className="text-xs font-medium tabular text-right flex-shrink-0" style={detailRow}>HPP {formatRp(o.costPerPcs)}/pcs</p>
                </div>
              ))
            : batchOutputs(b).map((o, i) => (
                <p key={i} className="text-xs font-medium" style={detailRow}>{o.productName}: {o.yieldQty} pcs</p>
              ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Bahan Baku Dipakai</p>
        <div className="space-y-0.5">
          {b.materialsUsed.map((m, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium" style={detailRow}>{m.materialName} ({m.qty} {m.unit}) · {formatRp(m.costPerUnit)}/{m.unit}</p>
              <p className="text-xs font-medium tabular text-right flex-shrink-0" style={detailRow}>{formatRp(m.cost)}</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Rincian Biaya</p>
        <div className="grid grid-cols-2 gap-y-1 gap-x-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Biaya Bahan</p>
          <p className="text-xs font-semibold tabular text-right" style={detailRow}>{formatRp(b.materialCost)}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Biaya Lain</p>
          <p className="text-xs font-semibold tabular text-right" style={detailRow}>{formatRp(b.otherCost)}</p>
          <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Total Biaya</p>
          <p className="text-xs font-bold tabular text-right" style={{ color: 'var(--text-primary)' }}>{formatRp(b.totalCost)}</p>
          <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>HPP / pcs</p>
          <p className="text-xs font-bold tabular text-right" style={{ color: 'var(--accent)' }}>{formatRp(b.costPerPcs)}</p>
        </div>
      </div>
      {b.warehouseName && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Masuk Gudang</p>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{b.warehouseName}</p>
        </div>
      )}
    </div>
  );
}
