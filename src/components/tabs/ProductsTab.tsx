'use client';

import { useState, useEffect, useRef } from 'react';
import { Reorder } from 'framer-motion';
import Image from 'next/image';
import {
  Plus, Pencil, Trash2, X, Check, Loader2, ImagePlus,
  Package, Search, QrCode,
  ChevronLeft, ChevronRight, ImageIcon, Upload,
  Eye, EyeOff,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ImageLightbox from '@/components/ImageLightbox';
import ImageCarousel from '@/components/ImageCarousel';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import Tooltip from '@/components/Tooltip';
import PageSizeSelect from '@/components/PageSizeSelect';
import FilterSelect from '@/components/FilterSelect';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import EmojiPicker from '@/components/EmojiPicker';
import ColorThemePicker from '@/components/ColorThemePicker';
import QRCodeModal from '@/components/QRCodeModal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface FireProduct {
  id: string; name: string; description: string; details: string[];
  price: number; originalPrice?: number; costPrice?: number; emoji: string; imageUrls: string[];
  category: string; badge?: string; stock: string; gradient: string;
  bgColor: string; weight: string; stockQty?: number; order?: number;
  code?: string; openPO?: boolean; qrUrl?: string; published?: boolean; minStock?: number;
}

interface FireCategory {
  id: string; name: string; emoji: string; description?: string; order?: number; bannerUrl?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EMPTY_PRODUCT: Omit<FireProduct, 'id'> = {
  name: '', description: '', details: [''], price: 0, costPrice: 0, emoji: '🛍️',
  imageUrls: [], category: '', badge: '', stock: 'habis',
  gradient: 'from-amber-700 to-yellow-500', bgColor: '#B45309', weight: '', stockQty: 0,
  code: '', openPO: false, published: true, minStock: 0,
};

const STOCK_MAP = {
  ready:   { label: 'Tersedia', cls: 'badge-green' },
  habis:   { label: 'Habis',    cls: 'badge-red'   },
  open_po: { label: 'Open PO',  cls: 'badge-amber' },
};
const BADGE_OPTS = ['', 'Best Seller', 'Popular', 'New'];
const HEADER_BTN_H = 34; // samakan tinggi semua tombol di header Produk
// Status stok dihitung dari total qty gudang (menu Stok), kecuali "Buka PO" diaktifkan manual.
const stockStatus = (p: Pick<FireProduct, 'stockQty' | 'openPO'>) =>
  p.openPO ? STOCK_MAP.open_po : (p.stockQty ?? 0) > 0 ? STOCK_MAP.ready : STOCK_MAP.habis;
// Menipis = stok masih ada (bukan habis/PO) tapi sudah di batas minimum yang diset admin.
export const isLowStock = (p: Pick<FireProduct, 'stockQty' | 'openPO' | 'minStock'>) =>
  !p.openPO && (p.minStock ?? 0) > 0 && (p.stockQty ?? 0) > 0 && (p.stockQty ?? 0) <= (p.minStock ?? 0);

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

// ─── Excel import ─────────────────────────────────────────────────────────────
const PRODUCT_TEMPLATE_COLS = [
  { header: 'Kode',           key: 'code',        width: 12 },
  { header: 'Nama*',          key: 'name',        width: 26 },
  { header: 'Kategori*',      key: 'category',    width: 16 },
  { header: 'Harga*',         key: 'price',       width: 14 },
  { header: 'Harga Coret',    key: 'originalPrice', width: 14 },
  { header: 'Berat',          key: 'weight',      width: 10 },
  { header: 'Stok Qty',       key: 'stockQty',    width: 10 },
  { header: 'Buka PO (Ya/Tidak)', key: 'openPO',  width: 16 },
  { header: 'Badge',          key: 'badge',       width: 12 },
  { header: 'Deskripsi',      key: 'description', width: 40 },
] as const;

type ProductTemplateKey = typeof PRODUCT_TEMPLATE_COLS[number]['key'];

function detectProductColumn(header: string): ProductTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('kode')) return 'code';
  if (h.includes('nama')) return 'name';
  if (h.includes('kategori')) return 'category';
  if (h.includes('coret')) return 'originalPrice';
  if (h.includes('harga')) return 'price';
  if (h.includes('berat')) return 'weight';
  if (h.includes('stok') || h.includes('qty')) return 'stockQty';
  if (h.includes('po')) return 'openPO';
  if (h.includes('badge')) return 'badge';
  if (h.includes('deskripsi')) return 'description';
  return null;
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────
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

// ─── Switch ───────────────────────────────────────────────────────────────────
function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex-shrink-0 relative transition-colors"
      style={{
        width: 38, height: 22, borderRadius: 999,
        background: checked ? 'var(--accent)' : 'var(--border)',
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ProductsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const storeHeader = useStoreHeader(creds);

  // ── Product state ─────────────────────────────────────────────────
  const [products,    setProducts]    = useState<FireProduct[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [recalculatingHpp, setRecalculatingHpp] = useState(false);
  const [seeding,     setSeeding]     = useState(false);
  const [editing,     setEditing]     = useState<FireProduct | null>(null);
  const [isNew,       setIsNew]       = useState(false);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [search,      setSearch]      = useState('');
  const [catFilter,   setCatFilter]   = useState('semua');
  const [pubFilter,   setPubFilter]   = useState('semua');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting,  setBulkDeleting]  = useState(false);
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [exporting,     setExporting]     = useState(false);
  const [exportingPdf,  setExportingPdf]  = useState(false);
  const [importing,     setImporting]     = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useViewMode('products');
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number; title?: string } | null>(null);
  const [qrProduct, setQrProduct] = useState<FireProduct | null>(null);
  const openLightbox = (images: string[], index = 0, title?: string) => {
    if (images?.length) setLightbox({ images, index, title });
  };

  // ── Category state (read-only here — managed in the Kategori tab) ──
  const [categories,    setCategories]    = useState<FireCategory[]>([]);

  const headers = { 'x-admin-auth': creds };

  // ── Load products ─────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/products`, { headers });
    if (r.ok) { const { products: p } = await r.json() as { products: FireProduct[] }; setProducts(p); }
    setLoading(false);
  };

  // ── Load categories ───────────────────────────────────────────────
  const loadCats = async () => {
    const r = await fetch(`${API}/api/categories`, { headers });
    if (r.ok) { const { categories: c } = await r.json() as { categories: FireCategory[] }; setCategories(c); }
  };

  useEffect(() => { load(); loadCats(); }, []);

  // ── Seed ──────────────────────────────────────────────────────────
  const seed = async () => {
    if (!await confirm('Migrasi 11 produk default ke Firestore? Produk yang sudah ada tidak akan ditimpa.')) return;
    setSeeding(true);
    const r = await fetch(`${API}/api/seed`, { method: 'POST', headers });
    if (r.ok) {
      const d = await r.json() as { seeded: number };
      toast.success(`${d.seeded} produk baru ditambahkan.`);
      await load();
    } else {
      toast.error('Gagal migrasi data produk.');
    }
    setSeeding(false);
  };

  // ── Excel template + import ────────────────────────────────────────
  const downloadProductTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Produk');
    const colCount = PRODUCT_TEMPLATE_COLS.length;
    ws.columns = PRODUCT_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT DATA PRODUK — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    const catNames = categories.map(c => c.name).join(', ') || '(belum ada kategori)';
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. '
      + `Kolom Kategori harus persis sama dengan salah satu kategori yang sudah ada: ${catNames}. `
      + 'Kolom Buka PO diisi "Ya" atau "Tidak" (kosong dianggap Tidak).';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 46;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    PRODUCT_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
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
      code: 'PRD001', name: 'Keripik Talas Original', category: categories[0]?.name ?? 'Keripik',
      price: 15000, originalPrice: 18000, weight: '100g', stockQty: 50, openPO: 'Tidak',
      badge: 'Best Seller', description: 'Contoh — timpa dengan data produk Anda',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-produk.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importProductsFromExcel = async (file: File) => {
    setImporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, ProductTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, ProductTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectProductColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('name')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Nama" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const catIdByName = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.id]));
      const rows: Record<string, unknown>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw: Record<string, string> = Object.fromEntries(PRODUCT_TEMPLATE_COLS.map(c => [c.key, '']));
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (!raw.name.trim()) return;
        const categoryId = catIdByName.get(raw.category.trim().toLowerCase());
        if (!categoryId) return;
        rows.push({
          code: raw.code, name: raw.name, category: categoryId,
          price: Number(raw.price.replace(/[^0-9.-]/g, '')) || 0,
          originalPrice: Number(raw.originalPrice.replace(/[^0-9.-]/g, '')) || undefined,
          weight: raw.weight, stockQty: Number(raw.stockQty.replace(/[^0-9.-]/g, '')) || 0,
          openPO: /^ya$/i.test(raw.openPO.trim()), badge: raw.badge, description: raw.description,
        });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data produk valid pada file tersebut. Pastikan kolom Nama, Kategori, dan Harga terisi dan Kategori sesuai daftar yang ada.');
        return;
      }

      const r = await fetch(`${API}/api/products/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number; skippedDuplicate: number; stockDroppedNoWarehouse?: number };
        await load();
        const extra = [
          d.skippedDuplicate > 0 ? `${d.skippedDuplicate} Kode duplikat dilewati` : '',
          d.skippedInvalid   > 0 ? `${d.skippedInvalid} baris tidak lengkap dilewati` : '',
        ].filter(Boolean).join(', ');
        toast.success(`${d.created} produk berhasil diimpor.${extra ? ` (${extra})` : ''}`);
        if (d.stockDroppedNoWarehouse) {
          toast.error(`${d.stockDroppedNoWarehouse} produk diimpor dengan stok 0 — atur "Gudang Kasir" di Pengaturan supaya stok impor bisa langsung tercatat per gudang.`);
        }
      } else {
        const d = await r.json().catch(() => ({ error: undefined, created: 0 })) as { error?: string; created?: number };
        if (d.created) await load(); // sebagian sempat tersimpan sebelum gagal — refresh biar tidak dobel-impor
        toast.error(d.error ?? 'Gagal mengimpor data produk.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImporting(false);
    }
  };

  // ── Product CRUD ──────────────────────────────────────────────────
  const openNew   = () => { setEditing({ id: '', ...EMPTY_PRODUCT, category: categories[0]?.id ?? '' }); setIsNew(true); };
  const openEdit  = (p: FireProduct) => { setEditing({ ...p }); setIsNew(false); };
  const closeEdit = () => { setEditing(null); setIsNew(false); };

  const handleDetailChange = (idx: number, val: string) => {
    if (!editing) return;
    const d = [...editing.details]; d[idx] = val;
    setEditing({ ...editing, details: d });
  };
  const addDetail    = () => editing && setEditing({ ...editing, details: [...editing.details, ''] });
  const removeDetail = (idx: number) => editing && setEditing({ ...editing, details: editing.details.filter((_, i) => i !== idx) });

  const compressImage = async (file: File): Promise<File> => {
    const MAX_PX = 1200;
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    return new Promise(resolve =>
      canvas.toBlob(
        blob => resolve(new File([blob!], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', 0.82,
      ),
    );
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers, body: form });
      if (r.ok) {
        const { url } = await r.json() as { url: string };
        if (editing) setEditing({ ...editing, imageUrls: [...editing.imageUrls, url] });
      } else {
        const { error } = await r.json() as { error?: string };
        toast.error(error ?? 'Upload gagal');
      }
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const { id, ...rest } = editing;
    // Stok bukan field yang bisa diedit di form ini (lihat status stok read-only di bawah) —
    // produk baru boleh mulai dari stockQty default (0), tapi edit produk tidak boleh ikut
    // mengirim ulang angka stok lama, supaya tidak menimpa balik stok yang mungkin sudah berubah
    // (mis. ada penjualan) sejak form ini dibuka. Koreksi stok wajib lewat menu Stok.
    const data = isNew
      ? { ...rest, stock: editing.openPO ? 'open_po' : (editing.stockQty ?? 0) > 0 ? 'ready' : 'habis' }
      : (() => { const { stockQty: _stockQty, stock: _stock, ...withoutStock } = rest; return withoutStock; })();
    const r = isNew
      ? await fetch(`${API}/api/products`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      : await fetch(`${API}/api/products/${id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Produk berhasil ditambahkan.' : 'Produk berhasil diperbarui.');
    } else {
      const { error } = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(error ?? 'Gagal menyimpan produk.');
    }
    setSaving(false);
  };

  // Timpa HPP (costPrice) di SEMUA order & rekap konsinyasi lama produk ini dengan Harga Modal
  // yang tersimpan sekarang — dipakai saat HPP lama diketahui salah input dan perlu dikoreksi
  // retroaktif. Beda dari "Hitung Ulang HPP" di Laporan Keuangan (cuma isi transaksi yang HPP-nya
  // kosong), ini betul-betul menulis ulang costPrice transaksi lama secara permanen di database.
  const recalculateHpp = async (id: string, name: string, costPrice: number) => {
    if (!await confirm({
      message: `Timpa HPP di SEMUA transaksi lama "${name}" (order & rekap konsinyasi) dengan Harga Modal ${formatRp(costPrice)}? Laba/rugi periode-periode lalu di Laporan Keuangan akan ikut berubah. Tindakan ini tidak bisa dibatalkan.`,
      danger: true,
    })) return;
    setRecalculatingHpp(true);
    try {
      // Simpan dulu Harga Modal dari form (kalau belum di-klik "Simpan") supaya endpoint di bawah
      // menimpa transaksi lama pakai angka yang sama persis dengan yang terlihat di form ini —
      // bukan angka lama yang masih tersimpan di database.
      await fetch(`${API}/api/products/${id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ costPrice }) });
      const r = await fetch(`${API}/api/products/${id}/recalculate-hpp`, { method: 'POST', headers });
      if (r.ok) {
        const d = await r.json() as { updatedOrders: number; updatedRecaps: number };
        await load();
        toast.success(`HPP "${name}" ditimpa di ${d.updatedOrders} order & ${d.updatedRecaps} rekap konsinyasi.`);
      } else {
        const { error } = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        toast.error(error ?? 'Gagal menghitung ulang HPP.');
      }
    } finally {
      setRecalculatingHpp(false);
    }
  };

  const del = async (id: string, name: string) => {
    if (!await confirm({ message: `Hapus produk "${name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    const r = await fetch(`${API}/api/products/${id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setProducts(p => p.filter(x => x.id !== id));
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      toast.success(`"${name}" berhasil dihapus.`);
    } else {
      toast.error(`Gagal menghapus "${name}".`);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} produk yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const count = selected.size;
    const r = await fetch(`${API}/api/products/bulk-delete`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      setProducts(p => p.filter(x => !selected.has(x.id))); setSelected(new Set());
      toast.success(`${count} produk berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus produk yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const bulkSetPublished = async (published: boolean) => {
    if (selected.size === 0) return;
    setBulkPublishing(true);
    const ids = [...selected];
    const r = await fetch(`${API}/api/products/bulk-publish`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, published }),
    });
    if (r.ok) {
      setProducts(p => p.map(x => ids.includes(x.id) ? { ...x, published } : x));
      setSelected(new Set());
      toast.success(published ? `${ids.length} produk berhasil dipublish.` : `${ids.length} produk disembunyikan dari frontend.`);
    } else {
      toast.error('Gagal mengubah status publish produk.');
    }
    setBulkPublishing(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const STATUS_FONT_COLOR: Record<string, string> = {
    Tersedia: 'FF16A34A',
    Habis:    'FFDC2626',
    'Open PO': 'FFD97706',
  };

  const exportExcel = async (rows: FireProduct[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada produk untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();

      const ws = wb.addWorksheet('Produk');

      const COLS = [
        { header: 'No',          key: 'no',            width: 6  },
        { header: 'Kode',        key: 'code',          width: 10 },
        { header: 'Nama',        key: 'name',           width: 30 },
        { header: 'Kategori',    key: 'category',       width: 16 },
        { header: 'Harga',       key: 'price',          width: 14 },
        { header: 'Harga Coret', key: 'originalPrice',  width: 14 },
        { header: 'Berat',       key: 'weight',         width: 10 },
        { header: 'Status Stok', key: 'stockLabel',     width: 14 },
        { header: 'Stok Qty',    key: 'stockQty',       width: 10 },
        { header: 'Badge',       key: 'badge',          width: 12 },
        { header: 'Buka PO',     key: 'openPO',         width: 10 },
        { header: 'Publish',     key: 'published',      width: 10 },
        { header: 'Deskripsi',   key: 'description',    width: 45 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      // ── Judul laporan ──
      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN PRODUK — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      // ── Sub-judul (ringkasan) ──
      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} produk (${label}) · Diexport ${todayLabel}`;
      subCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      subCell.alignment = { horizontal: 'center', vertical: 'middle' };
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      // ── Header kolom ──
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

      // ── Data rows ──
      rows.forEach((p, i) => {
        const stockLabel = stockStatus(p).label;
        const row = ws.addRow({
          no: i + 1,
          code: p.code || '-',
          name: p.name,
          category: catName(p.category),
          price: p.price,
          originalPrice: p.originalPrice ?? null,
          weight: p.weight || '-',
          stockLabel,
          stockQty: p.stockQty ?? 0,
          badge: p.badge || '-',
          openPO: p.openPO ? 'Ya' : 'Tidak',
          published: p.published !== false ? 'Ya' : 'Tidak',
          description: p.description,
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

        row.getCell('price').numFmt = '"Rp"#,##0';
        row.getCell('price').alignment = { horizontal: 'right', vertical: 'middle' };
        if (p.originalPrice) {
          row.getCell('originalPrice').numFmt = '"Rp"#,##0';
          row.getCell('originalPrice').alignment = { horizontal: 'right', vertical: 'middle' };
          row.getCell('originalPrice').font = { strike: true, color: { argb: 'FF9CA3AF' } };
        }
        row.getCell('no').alignment       = { horizontal: 'center', vertical: 'middle' };
        row.getCell('stockQty').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('openPO').alignment    = { horizontal: 'center', vertical: 'middle' };
        row.getCell('published').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('category').alignment  = { horizontal: 'center', vertical: 'middle' };
        row.getCell('description').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };

        const statusCell = row.getCell('stockLabel');
        statusCell.font = { bold: true, color: { argb: STATUS_FONT_COLOR[stockLabel] ?? 'FF374151' } };
        statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const lastColLetter = ws.getColumn(colCount).letter;
      ws.autoFilter = { from: `A${HEADER_ROW_NUM}`, to: `${lastColLetter}${HEADER_ROW_NUM}` };

      // ── Auto-resize kolom sesuai isi (judul & sub-judul dikecualikan) ──
      ws.columns.forEach(column => {
        let maxLen = 8;
        for (let r = HEADER_ROW_NUM; r <= ws.rowCount; r++) {
          const v = ws.getRow(r).getCell(column.number!).value;
          const len = v == null ? 0 : v.toString().length;
          if (len > maxLen) maxLen = len;
        }
        column.width = Math.min(maxLen + 2, 50);
      });

      // ── Tinggi baris menyesuaikan panjang teks Deskripsi yang di-wrap ──
      const descColWidth = ws.getColumn('description').width ?? 45;
      const charsPerLine = Math.max(10, descColWidth - 2);
      for (let r = HEADER_ROW_NUM + 1; r <= ws.rowCount; r++) {
        const text = ws.getRow(r).getCell('description').value?.toString() ?? '';
        const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
        ws.getRow(r).height = Math.max(20, lines * 14);
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `produk-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} produk (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (rows: FireProduct[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada produk untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR PRODUK',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            // Harga Coret digabung ke kolom Harga ("Rp10.000 (coret Rp15.000)"), dan Buka
            // PO/Publish digabung jadi satu kolom Status — 13 kolom Excel terlalu sempit untuk
            // A4 landscape.
            columns: [
              { header: 'No', width: '4%', align: 'center' },
              { header: 'Kode', width: '7%' },
              { header: 'Nama', width: '17%', bold: true },
              { header: 'Kategori', width: '10%' },
              { header: 'Harga', width: '12%', align: 'right' },
              { header: 'Berat', width: '6%', align: 'center' },
              { header: 'Status Stok', width: '10%', align: 'center' },
              { header: 'Stok', width: '6%', align: 'center' },
              { header: 'Badge', width: '9%' },
              { header: 'Status', width: '10%', align: 'center' },
              { header: 'Deskripsi', width: '9%' },
            ],
            rows: rows.map((p, i) => [
              i + 1,
              p.code || '-',
              p.name,
              catName(p.category),
              p.originalPrice ? `${formatRp(p.price)} (coret ${formatRp(p.originalPrice)})` : formatRp(p.price),
              p.weight || '-',
              stockStatus(p).label,
              p.stockQty ?? 0,
              p.badge || '-',
              [p.published !== false ? 'Publish' : 'Draft', p.openPO ? 'Buka PO' : null].filter(Boolean).join(', '),
              p.description || '-',
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `produk-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} produk (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const togglePageAll = () => {
    const pageIds    = paginated.map(p => p.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  // ── Filter + pagination ───────────────────────────────────────────
  const filtered = products
    .filter(p => {
      const matchCat = catFilter === 'semua' || p.category === catFilter;
      const matchQ   = !search || p.name.toLowerCase().includes(search.toLowerCase());
      const matchPub = pubFilter === 'semua'
        || (pubFilter === 'published' && p.published !== false)
        || (pubFilter === 'draft' && p.published === false);
      return matchCat && matchQ && matchPub;
    })
    .sort((a, b) => {
      const aHabis = stockStatus(a) === STOCK_MAP.habis ? 1 : 0;
      const bHabis = stockStatus(b) === STOCK_MAP.habis ? 1 : 0;
      if (aHabis !== bHabis) return aHabis - bHabis;
      return (a.order ?? 9999) - (b.order ?? 9999);
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const goPage    = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  const catName  = (id: string) => categories.find(c => c.id === id)?.name  ?? id;
  const catEmoji = (id: string) => categories.find(c => c.id === id)?.emoji ?? '🏷️';

  const renderDetail = (p: FireProduct) => (
    <div className="px-4 pb-4 pt-2 space-y-2" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.description}</p>
      <ul className="space-y-1">
        {p.details.map((d, i) => (
          <li key={i} className="flex gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--accent)' }}>·</span>{d}
          </li>
        ))}
      </ul>
      {p.imageUrls?.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {p.imageUrls.map((u, i) => (
            <button key={i} onClick={() => openLightbox(p.imageUrls, i, p.name)}
              className="w-16 h-16 rounded-xl overflow-hidden relative" style={{ background: 'var(--surface-2)' }}>
              <Image src={u} alt="" fill className="object-contain" sizes="64px" unoptimized />
            </button>
          ))}
        </div>
      )}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Stok fisik: <strong style={{ color: 'var(--text-secondary)' }}>{p.stockQty ?? 0} pcs</strong>
        {' · '}Kategori: <strong style={{ color: 'var(--text-secondary)' }}>{catName(p.category)}</strong>
      </p>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="p-4 lg:p-6 space-y-4">

      {/* ── Header: search + actions in one row ── */}
      {products.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {categories.length > 0 && (
            <div className="w-full sm:w-[200px] flex-shrink-0">
              <FilterSelect
                value={catFilter}
                onChange={v => { setCatFilter(v); resetPage(); }}
                height={HEADER_BTN_H}
                searchPlaceholder="Cari kategori…"
                options={[
                  { value: 'semua', label: 'Semua Kategori' },
                  ...categories.map(c => ({ value: c.id, label: `${c.emoji} ${c.name}` })),
                ]}
              />
            </div>
          )}
          <div className="w-full sm:w-[170px] flex-shrink-0">
            <FilterSelect
              value={pubFilter}
              onChange={v => { setPubFilter(v); resetPage(); }}
              height={HEADER_BTN_H}
              options={[
                { value: 'semua', label: 'Semua Status' },
                { value: 'published', label: 'Published' },
                { value: 'draft', label: 'Belum Publish' },
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
                placeholder="Cari produk…"
              />
            </div>
            <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
              <Tooltip label="Unduh Template">
                <button onClick={downloadProductTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  <ExcelIcon size={14} />
                </button>
              </Tooltip>
              <Tooltip label={importing ? 'Mengimpor…' : 'Upload Excel'}>
                <button onClick={() => importFileRef.current?.click()} disabled={importing} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                </button>
              </Tooltip>
              <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) importProductsFromExcel(f); e.target.value = ''; }} />
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
                <Plus size={13} /> <span className="hidden sm:inline">Tambah Produk</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {products.length === 0 ? (
            <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
              <div className="text-5xl mb-4">📦</div>
              <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada produk</p>
              <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
                Tambahkan produk untuk mulai berjualan, atau migrasikan data produk default.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button onClick={openNew} className="btn-primary px-5 py-2.5 text-sm">
                  <Plus size={14} /> Tambah Produk Pertama
                </button>
                <button onClick={seed} disabled={seeding} className="btn-ghost px-5 py-2.5 text-sm">
                  {seeding ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
                  Migrasi Data
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Select-all bar */}
              {paginated.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 card"
                  style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                  <Checkbox
                    checked={paginated.every(p => selected.has(p.id))}
                    indeterminate={paginated.some(p => selected.has(p.id)) && !paginated.every(p => selected.has(p.id))}
                    onChange={togglePageAll}
                  />
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} produk di halaman ini`}
                  </span>
                </div>
              )}

              {/* Product list */}
              {paginated.length === 0 ? (
                <div className="card py-12 text-center">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p>
                </div>
              ) : view === 'table' ? (
                <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                  {paginated.map((p, idx) => {
                    const stock      = stockStatus(p);
                    const outOfStock = stock.label === 'Habis';
                    const isSelected = selected.has(p.id);
                    const rowNum     = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
                    return (
                      <div key={p.id}
                        style={{
                          borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined,
                          background: isSelected ? 'rgba(212,105,30,0.05)' : undefined,
                          transition: 'background 0.1s',
                        }}>
                        <div className="flex items-center gap-2 px-4 py-3.5">
                          <Checkbox checked={isSelected} onChange={() => toggleSelect(p.id)} />

                          {/* Row number */}
                          <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center"
                            style={{ color: 'var(--text-muted)' }}>
                            {rowNum}
                          </span>

                          {/* Thumbnail */}
                          <button
                            onClick={() => p.imageUrls?.length && openLightbox(p.imageUrls, 0, p.name)}
                            disabled={!p.imageUrls?.length}
                            className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 relative"
                            style={{ background: `${p.bgColor}22`, cursor: p.imageUrls?.length ? 'pointer' : 'default' }}>
                            <div style={{ width: '100%', height: '100%', position: 'relative', filter: outOfStock ? 'grayscale(0.8) blur(2px)' : undefined, opacity: outOfStock ? 0.55 : 1, transition: 'filter 0.15s, opacity 0.15s' }}>
                              {p.imageUrls?.[0]
                                ? <Image src={p.imageUrls[0]} alt={p.name} fill className="object-contain" sizes="48px" unoptimized />
                                : <div className="w-full h-full flex items-center justify-center text-2xl">{p.emoji}</div>}
                            </div>
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                              {p.code && (
                                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                  {p.code}
                                </span>
                              )}
                              {p.badge && <span className="badge badge-amber">{p.badge}</span>}
                              <span className={`badge flex items-center gap-1 ${p.published === false ? 'badge-gray' : 'badge-green'}`}>
                                {p.published === false ? <EyeOff size={9} /> : <Eye size={9} />}
                                {p.published === false ? 'Draft' : 'Publish'}
                              </span>
                              {!p.imageUrls?.length && (
                                <span className="badge badge-gray flex items-center gap-1">
                                  <ImageIcon size={9} /> No img
                                </span>
                              )}
                              {!p.qrUrl && (
                                <span className="badge badge-gray flex items-center gap-1">
                                  <QrCode size={9} /> No QR
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>{formatRp(p.price)}</span>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.weight}</span>
                              <span className={`badge ${stock.cls}`}>
                                {stock.label}{stock === STOCK_MAP.ready ? ` · ${p.stockQty ?? 0} pcs` : ''}
                              </span>
                              {isLowStock(p) && (
                                <Tooltip label={`Batas minimum ${p.minStock} pcs`}>
                                  <span className="badge badge-amber">Stok Menipis</span>
                                </Tooltip>
                              )}
                              {p.category && (
                                <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                                  <span style={{ fontSize: 9, lineHeight: 1 }}>{catEmoji(p.category)}</span>
                                  {catName(p.category)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Tooltip label="QR Code">
                              <button onClick={() => setQrProduct(p)} className="btn-ghost p-2" style={{ color: 'var(--text-secondary)' }}>
                                <QrCode size={13} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Edit">
                              <button onClick={() => openEdit(p)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                                <Pencil size={13} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Hapus">
                              <button onClick={() => del(p.id, p.name)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                                <Trash2 size={13} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Lihat detail">
                              <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)} className="btn-ghost p-2">
                                <ChevronRight size={13} style={{ transform: expandedId === p.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                              </button>
                            </Tooltip>
                          </div>
                        </div>

                        {expandedId === p.id && renderDetail(p)}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {paginated.map(p => {
                    const stock      = stockStatus(p);
                    const outOfStock = stock.label === 'Habis';
                    const isSelected = selected.has(p.id);
                    return (
                      <div key={p.id} className="card overflow-hidden flex flex-col"
                        style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                        <div className="relative w-full aspect-square" style={{ background: `${p.bgColor}22` }}>
                          <ImageCarousel
                            imageUrls={p.imageUrls}
                            emoji={p.emoji}
                            alt={p.name}
                            sizes="(max-width: 640px) 50vw, 200px"
                            emojiClassName="text-4xl"
                            onImageClick={p.imageUrls?.length ? (i) => openLightbox(p.imageUrls, i, p.name) : undefined}
                            innerStyle={{ filter: outOfStock ? 'grayscale(0.8) blur(3px)' : undefined, opacity: outOfStock ? 0.55 : 1, transition: 'filter 0.15s, opacity 0.15s' }}
                          />
                          {outOfStock && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <span className="badge badge-red" style={{ fontSize: 11 }}>Stok Habis</span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2 rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.85)' }}>
                            <Checkbox checked={isSelected} onChange={() => toggleSelect(p.id)} />
                          </div>
                          {p.badge && <span className="absolute top-2 right-2 badge badge-amber">{p.badge}</span>}
                          <span className={`absolute top-9 left-2 badge flex items-center gap-1 ${p.published === false ? 'badge-gray' : 'badge-green'}`}>
                            {p.published === false ? <EyeOff size={9} /> : <Eye size={9} />}
                            {p.published === false ? 'Draft' : 'Publish'}
                          </span>
                          {!p.imageUrls?.length && (
                            <span className="absolute bottom-2 right-2 badge badge-gray flex items-center gap-1">
                              <ImageIcon size={9} /> No img
                            </span>
                          )}
                          {!p.qrUrl && (
                            <span className="absolute bottom-2 left-2 badge badge-gray flex items-center gap-1">
                              <QrCode size={9} /> No QR
                            </span>
                          )}
                        </div>

                        <div className="p-3 flex-1 flex flex-col gap-1.5">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>{formatRp(p.price)}</span>
                            <span className={`badge ${stock.cls}`}>
                              {stock.label}{stock === STOCK_MAP.ready ? ` · ${p.stockQty ?? 0} pcs` : ''}
                            </span>
                            {isLowStock(p) && <span className="badge badge-amber">Stok Menipis</span>}
                          </div>
                          {p.category && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full self-start"
                              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                              {catEmoji(p.category)} {catName(p.category)}
                            </span>
                          )}

                          <div className="flex items-center justify-between gap-2 mt-auto pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                            <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                              className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                              Detail <ChevronRight size={12} style={{ transform: expandedId === p.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                            </button>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Tooltip label="QR Code">
                                <button onClick={() => setQrProduct(p)} className="btn-ghost p-1.5" style={{ color: 'var(--text-secondary)' }}>
                                  <QrCode size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Edit">
                                <button onClick={() => openEdit(p)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                                  <Pencil size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Hapus">
                                <button onClick={() => del(p.id, p.name)} className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }}>
                                  <Trash2 size={12} />
                                </button>
                              </Tooltip>
                            </div>
                          </div>
                        </div>

                        {expandedId === p.id && renderDetail(p)}
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
                      {filtered.length} produk · halaman {safePage} dari {totalPages}
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

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportExcel(products.filter(p => selected.has(p.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(products.filter(p => selected.has(p.id)), 'terpilih')} disabled={exportingPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              PDF
            </button>
            <button onClick={() => bulkSetPublished(true)} disabled={bulkPublishing}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {bulkPublishing ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
              Publish
            </button>
            <button onClick={() => bulkSetPublished(false)} disabled={bulkPublishing}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {bulkPublishing ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />}
              Sembunyikan
            </button>
            <button onClick={bulkDelete} disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
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

      {/* ── Product edit modal ── */}
      {editing && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />

            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon">
                  {editing.emoji
                    ? <span style={{ fontSize: 17, lineHeight: 1 }}>{editing.emoji}</span>
                    : <Package size={17} />}
                </div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Produk' : 'Edit Produk'}</p>
                  <p className="modal-subtitle">{isNew ? 'Isi detail produk baru' : editing.name || 'Produk'}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Images */}
                <div>
                  <p className="section-label" style={{ marginBottom: 10 }}>
                    Foto Produk <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— geser untuk ubah urutan, foto pertama jadi sampul</span>
                  </p>
                  <Reorder.Group as="div" axis="x" values={editing.imageUrls}
                    onReorder={newOrder => setEditing({ ...editing, imageUrls: newOrder })}
                    style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {editing.imageUrls.map((u, i) => (
                      <Reorder.Item key={u} value={u} as="div"
                        className="relative w-20 h-20 rounded-xl overflow-hidden group cursor-grab active:cursor-grabbing"
                        style={{ background: 'var(--surface-2)' }}>
                        <Image src={u} alt="" fill className="object-contain pointer-events-none" sizes="80px" unoptimized draggable={false} />
                        {i === 0 && (
                          <span className="absolute bottom-1 left-1 badge badge-gray" style={{ fontSize: 9, padding: '1px 6px' }}>Sampul</span>
                        )}
                        <Tooltip label="Hapus foto">
                          <button onClick={() => setEditing({ ...editing, imageUrls: editing.imageUrls.filter((_, j) => j !== i) })}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <X size={11} />
                          </button>
                        </Tooltip>
                      </Reorder.Item>
                    ))}
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                      className="w-20 h-20 rounded-xl flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors"
                      style={{ border: '2px dashed var(--border)', color: 'var(--text-muted)', background: 'var(--surface-2)' }}>
                      {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                      {uploading ? 'Upload…' : 'Tambah'}
                    </button>
                  </Reorder.Group>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0])} />
                </div>

                {/* 2-column grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Col 1 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Emoji + Name */}
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flexShrink: 0 }}>
                        <label className="field-label">Emoji</label>
                        <EmojiPicker
                          value={editing.emoji}
                          onChange={emoji => setEditing({ ...editing, emoji })}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="field-label">Nama Produk *</label>
                        <input
                          value={editing.name}
                          onChange={e => setEditing({ ...editing, name: e.target.value })}
                          className="input"
                        />
                      </div>
                    </div>

                    {([
                      { label: 'Kode Produk',    key: 'code'   as const, type: 'text' },
                      { label: 'Berat / Ukuran', key: 'weight' as const, type: 'text' },
                    ] as const).map(f => (
                      <div key={f.key}>
                        <label className="field-label">{f.label}</label>
                        <input type={f.type} value={(editing[f.key] as string) ?? ''}
                          onChange={e => setEditing({ ...editing, [f.key]: e.target.value })}
                          className="input" />
                      </div>
                    ))}

                    <div>
                      <label className="field-label">Warna & Gradient</label>
                      <ColorThemePicker
                        bgColor={editing.bgColor}
                        gradient={editing.gradient}
                        onChange={theme => setEditing({ ...editing, ...theme })}
                      />
                    </div>
                  </div>

                  {/* Col 2 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {([
                      { label: 'Harga (Rp)',                       key: 'price'         as const },
                      { label: 'Harga Modal / HPP (Rp, opsional)', key: 'costPrice'     as const },
                      { label: 'Harga Coret (Rp, opsional)',       key: 'originalPrice' as const },
                    ] as const).map(f => (
                      <div key={f.key}>
                        <label className="field-label">{f.label}</label>
                        {/* costPrice bisa desimal — HPP dihitung ulang otomatis dari rata-rata bergerak
                            tiap ada Produksi (lihat production/route.ts), jadi harus dibulatkan dulu
                            sebelum ditaruh di NumberInput (dia buang titik desimal & gabung digit,
                            sama seperti bug avgCost di Bahan Baku). */}
                        <NumberInput value={(() => { const v = editing[f.key] as number | undefined; return v ? Math.round(v) : ''; })()}
                          onChange={raw => setEditing({ ...editing, [f.key]: raw ? Number(raw) : 0 })}
                        />
                      </div>
                    ))}
                    {!!editing.costPrice && editing.price > 0 && (
                      <p style={{ fontSize: 10.5, marginTop: -8, color: 'var(--text-muted)' }}>
                        Margin: {formatRp(editing.price - editing.costPrice)} / pcs ({Math.round(((editing.price - editing.costPrice) / editing.price) * 100)}%)
                      </p>
                    )}
                    {!isNew && (
                      <div>
                        <button type="button" onClick={() => recalculateHpp(editing.id, editing.name, editing.costPrice ?? 0)}
                          disabled={recalculatingHpp} className="btn-ghost text-xs font-semibold"
                          style={{ height: 32, padding: '0 10px' }}>
                          {recalculatingHpp ? <Loader2 size={13} className="animate-spin" /> : null}
                          Timpa HPP ke Semua Transaksi Lama
                        </button>
                        <p style={{ fontSize: 10, marginTop: 4, color: 'var(--text-muted)' }}>
                          Pakai kalau Harga Modal di atas adalah koreksi HPP yang salah tersimpan sejak dulu — semua order & rekap konsinyasi lama produk ini akan ditimpa dengan angka ini (bukan cuma yang belum terisi).
                        </p>
                      </div>
                    )}

                    {/* Selects */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="field-label">Kategori</label>
                        <SearchSelect value={editing.category}
                          onChange={v => setEditing({ ...editing, category: v })}
                          options={categories.map(c => ({ value: c.id, label: `${c.emoji} ${c.name}` }))}
                          placeholder="— Belum ada —" searchPlaceholder="Cari kategori…" />
                      </div>
                      <div>
                        <label className="field-label">Badge</label>
                        <SearchSelect value={editing.badge ?? ''}
                          onChange={v => setEditing({ ...editing, badge: v })}
                          options={BADGE_OPTS.map(o => ({ value: o, label: o || '–' }))}
                          placeholder="–" searchPlaceholder="Cari badge…" />
                      </div>
                    </div>

                    {/* Status stok — read-only, dihitung dari data gudang (kecuali PO diaktifkan) */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                      <div>
                        <p className="field-label" style={{ marginBottom: 2 }}>Status Stok</p>
                        <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Otomatis dari data gudang & transaksi di menu Stok</p>
                      </div>
                      <span className={`badge ${stockStatus(editing).cls}`}>
                        {stockStatus(editing).label} · {editing.stockQty ?? 0} pcs
                      </span>
                    </div>

                    <div>
                      <label className="field-label">Stok Minimum (peringatan &quot;Stok Menipis&quot;)</label>
                      <NumberInput value={editing.minStock ?? 0}
                        onChange={raw => setEditing({ ...editing, minStock: Number(raw) || 0 })}
                        placeholder="0 = tidak ada peringatan" />
                    </div>

                    {/* Toggle Open PO */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                      <div>
                        <p className="field-label" style={{ marginBottom: 2 }}>Buka Pre-Order (PO)</p>
                        <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Aktifkan untuk tetap menerima pesanan walau stok gudang 0</p>
                      </div>
                      <Switch checked={!!editing.openPO} onChange={() => setEditing({ ...editing, openPO: !editing.openPO })} />
                    </div>

                    {/* Toggle Publish */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                      <div>
                        <p className="field-label" style={{ marginBottom: 2 }}>Publish ke Frontend</p>
                        <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Nonaktifkan untuk menyembunyikan produk ini dari toko online</p>
                      </div>
                      <Switch checked={editing.published !== false} onChange={() => setEditing({ ...editing, published: !(editing.published !== false) })} />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="field-label">Deskripsi</label>
                      <textarea rows={4} value={editing.description}
                        onChange={e => setEditing({ ...editing, description: e.target.value })}
                        className="input resize-none" />
                    </div>
                  </div>
                </div>

                {/* Detail points */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label className="field-label" style={{ marginBottom: 0 }}>Detail Produk</label>
                    <button onClick={addDetail} style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      <Plus size={11} /> Tambah baris
                    </button>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {editing.details.map((d, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8 }}>
                        <input value={d} onChange={e => handleDetailChange(i, e.target.value)} className="input flex-1" style={{ fontSize: 13 }} />
                        {editing.details.length > 1 && (
                          <Tooltip label="Hapus baris">
                            <button onClick={() => removeDetail(i)} className="btn-ghost" style={{ padding: '8px', color: 'var(--danger)', flexShrink: 0 }}>
                              <X size={13} />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={closeEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={save} disabled={saving || !editing.name}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Produk'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code modal ── */}
      {qrProduct && (
        <QRCodeModal
          product={qrProduct}
          headers={headers}
          onClose={() => setQrProduct(null)}
          onSaved={(id, qrUrl) => setProducts(ps => ps.map(x => x.id === id ? { ...x, qrUrl } : x))}
        />
      )}

      {/* ── Image lightbox ── */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          title={lightbox.title}
          onIndexChange={i => setLightbox(l => l && { ...l, index: i })}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
