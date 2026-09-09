'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Plus, Pencil, Trash2, X, Check, Loader2, Search,
  ChevronLeft, ChevronRight, ImageIcon, Tag, Upload,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import EmojiPicker from '@/components/EmojiPicker';
import ImageUploadBox from '@/components/ImageUploadBox';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import PageSizeSelect from '@/components/PageSizeSelect';

const API       = '';
const HEADER_BTN_H = 34;

interface FireCategory {
  id: string; name: string; emoji: string; description?: string; order?: number; bannerUrl?: string;
}

const EMPTY_CAT: Omit<FireCategory, 'id'> & { slug: string } = {
  name: '', emoji: '🏷️', description: '', slug: '', bannerUrl: '',
};

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ─── Excel import ─────────────────────────────────────────────────────────────
const CATEGORY_TEMPLATE_COLS = [
  { header: 'Nama*',     key: 'name',        width: 24 },
  { header: 'ID/Slug',   key: 'slug',        width: 16 },
  { header: 'Emoji',     key: 'emoji',       width: 10 },
  { header: 'Deskripsi', key: 'description', width: 36 },
] as const;

type CategoryTemplateKey = typeof CATEGORY_TEMPLATE_COLS[number]['key'];

function detectCategoryColumn(header: string): CategoryTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('nama')) return 'name';
  if (h.includes('slug') || h.includes('id')) return 'slug';
  if (h.includes('emoji')) return 'emoji';
  if (h.includes('deskripsi')) return 'description';
  return null;
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

export default function CategoriesTab({ creds }: { creds: string }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const storeHeader = useStoreHeader(creds);

  const [categories,  setCategories]  = useState<FireCategory[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [seedingCats,   setSeedingCats]   = useState(false);

  const [editingCat,    setEditingCat]    = useState<(Omit<FireCategory, 'id'> & { id: string; slug: string }) | null>(null);
  const [isNewCat,      setIsNewCat]      = useState(false);
  const [savingCat,     setSavingCat]     = useState(false);
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [catError,      setCatError]      = useState('');
  const [catSearch,     setCatSearch]     = useState('');
  const [catPage,       setCatPage]       = useState(1);
  const [catPageSize,   setCatPageSize]   = useState(10);
  const [catView, setCatView] = useViewMode('categories');
  const [uploadingBanner, setUploadingBanner] = useState(false);

  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting,    setExporting]    = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [importing,    setImporting]    = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const headers = { 'x-admin-auth': creds };

  const loadCats = async () => {
    setCatsLoading(true);
    const r = await fetch(`${API}/api/categories`, { headers });
    if (r.ok) { const { categories: c } = await r.json() as { categories: FireCategory[] }; setCategories(c); }
    setCatsLoading(false);
  };

  const loadProductCounts = async () => {
    const r = await fetch(`${API}/api/products`, { headers });
    if (r.ok) {
      const { products: p } = await r.json() as { products: { category: string }[] };
      const counts: Record<string, number> = {};
      for (const prod of p) counts[prod.category] = (counts[prod.category] ?? 0) + 1;
      setProductCounts(counts);
    }
  };

  useEffect(() => { loadCats(); loadProductCounts(); }, []);

  const seedCategories = async () => {
    if (!await confirm('Tambahkan 4 kategori default (Keripik, Mie, Snack, Paket)?')) return;
    setSeedingCats(true);
    const defaults = [
      { slug: 'keripik', name: 'Keripik',  emoji: '🥔', description: 'Keripik Talas Renyah',    order: 1 },
      { slug: 'mie',     name: 'Mie',      emoji: '🍝', description: 'Mie Kremes Crispy',        order: 2 },
      { slug: 'snack',   name: 'Snack',    emoji: '🍿', description: 'Cemilan Seru Lainnya',     order: 3 },
      { slug: 'paket',   name: 'Paket',    emoji: '🎁', description: 'Paket Hemat Pilihan',      order: 4 },
    ];
    let failed = 0;
    for (const d of defaults) {
      const r = await fetch(`${API}/api/categories`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      if (!r.ok) failed++;
    }
    await loadCats();
    setSeedingCats(false);
    if (failed === 0) toast.success('Kategori default berhasil ditambahkan.');
    else toast.error(`${failed} dari ${defaults.length} kategori gagal ditambahkan.`);
  };

  const openNewCat  = () => { setEditingCat({ ...EMPTY_CAT, id: '' }); setIsNewCat(true);  setCatError(''); };
  const openEditCat = (c: FireCategory) => { setEditingCat({ ...c, slug: c.id }); setIsNewCat(false); setCatError(''); };
  const closeEditCat = () => { setEditingCat(null); setIsNewCat(false); setCatError(''); };

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

  const uploadBannerImage = async (file: File) => {
    setUploadingBanner(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers, body: form });
      if (r.ok) {
        const { url } = await r.json() as { url: string };
        setEditingCat(ec => ec && { ...ec, bannerUrl: url });
      } else {
        const { error } = await r.json() as { error?: string };
        toast.error(error ?? 'Upload gagal');
      }
    } finally {
      setUploadingBanner(false);
    }
  };

  const saveCat = async () => {
    if (!editingCat) return;
    setSavingCat(true); setCatError('');
    const slug = isNewCat ? (editingCat.slug || slugify(editingCat.name)) : editingCat.id;
    if (!slug || !editingCat.name.trim()) {
      setCatError('Nama kategori wajib diisi.'); setSavingCat(false); return;
    }
    if (isNewCat) {
      const r = await fetch(`${API}/api/categories`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // `order` sengaja tidak dikirim — server yang menghitung posisi berikutnya
          // (max(order)+1) supaya tidak bentrok dengan kategori lain yang masih ada.
          slug, name: editingCat.name, emoji: editingCat.emoji,
          description: editingCat.description,
          bannerUrl: editingCat.bannerUrl,
        }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        setCatError(d.error ?? 'Gagal menyimpan kategori.'); setSavingCat(false);
        toast.error(d.error ?? 'Gagal menyimpan kategori.');
        return;
      }
    } else {
      const r = await fetch(`${API}/api/categories/${editingCat.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingCat.name, emoji: editingCat.emoji, description: editingCat.description,
          bannerUrl: editingCat.bannerUrl,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        setCatError(d.error ?? 'Gagal menyimpan kategori.'); setSavingCat(false);
        toast.error(d.error ?? 'Gagal menyimpan kategori.');
        return;
      }
    }
    await loadCats(); closeEditCat(); setSavingCat(false);
    toast.success(isNewCat ? 'Kategori berhasil ditambahkan.' : 'Kategori berhasil diperbarui.');
  };

  const deleteCat = async (id: string, name: string) => {
    if (!await confirm({ message: `Hapus kategori "${name}"?`, danger: true })) return;
    setDeletingCatId(id);
    const r = await fetch(`${API}/api/categories/${id}`, { method: 'DELETE', headers });
    if (!r.ok) {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus kategori.');
    } else {
      await loadCats();
      toast.success(`Kategori "${name}" berhasil dihapus.`);
    }
    setDeletingCatId(null);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} kategori yang dipilih? Kategori yang masih dipakai produk akan dilewati.`, danger: true })) return;
    setBulkDeleting(true);
    const ids = [...selected];
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/categories/${id}`, { method: 'DELETE', headers })));
    const okIds = ids.filter((_, i) => results[i].ok);
    await loadCats();
    setSelected(new Set());
    if (okIds.length === ids.length) toast.success(`${okIds.length} kategori berhasil dihapus.`);
    else if (okIds.length === 0) toast.error('Tidak ada kategori yang bisa dihapus — masih dipakai produk.');
    else toast.error(`${okIds.length} dari ${ids.length} kategori berhasil dihapus. Sisanya masih dipakai produk.`);
    setBulkDeleting(false);
  };

  const exportExcel = async (rows: FireCategory[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada kategori untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Kategori');

      const COLS = [
        { header: 'No',          key: 'no',          width: 6  },
        { header: 'ID/Slug',     key: 'id',          width: 16 },
        { header: 'Nama',        key: 'name',        width: 24 },
        { header: 'Emoji',       key: 'emoji',       width: 10 },
        { header: 'Deskripsi',   key: 'description', width: 36 },
        { header: 'Jml Produk',  key: 'count',       width: 12 },
        { header: 'Banner',      key: 'banner',      width: 10 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN KATEGORI — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} kategori (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((c, i) => {
        const row = ws.addRow({
          no: i + 1,
          id: c.id,
          name: c.name,
          emoji: c.emoji || '-',
          description: c.description || '-',
          count: productCounts[c.id] ?? 0,
          banner: c.bannerUrl ? 'Ya' : 'Tidak',
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
        row.getCell('emoji').alignment  = { horizontal: 'center', vertical: 'middle' };
        row.getCell('count').alignment  = { horizontal: 'center', vertical: 'middle' };
        row.getCell('banner').alignment = { horizontal: 'center', vertical: 'middle' };
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
      a.download = `kategori-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} kategori (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (rows: FireCategory[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada kategori untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR KATEGORI',
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            // Kolom Emoji sengaja tidak disertakan (beda dari Excel) — font standar react-pdf
            // (Helvetica) tidak punya glyph emoji, hasilnya karakter rusak/kotak di PDF.
            columns: [
              { header: 'No', width: '5%', align: 'center' },
              { header: 'ID/Slug', width: '16%' },
              { header: 'Nama', width: '22%', bold: true },
              { header: 'Deskripsi', width: '35%' },
              { header: 'Jml Produk', width: '12%', align: 'center' },
              { header: 'Banner', width: '10%', align: 'center' },
            ],
            rows: rows.map((c, i) => [
              i + 1, c.id, c.name, c.description || '-', productCounts[c.id] ?? 0, c.bannerUrl ? 'Ya' : 'Tidak',
            ]),
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kategori-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} kategori (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const downloadCategoryTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Kategori');
    const colCount = CATEGORY_TEMPLATE_COLS.length;
    ws.columns = CATEGORY_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT DATA KATEGORI — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. '
      + 'Kolom ID/Slug boleh dikosongkan — akan dibuat otomatis dari nama.';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 34;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    CATEGORY_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
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
      name: 'Keripik', slug: 'keripik', emoji: '🥔', description: 'Keripik Talas Renyah — contoh, timpa dengan data Anda',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-kategori.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importCategoriesFromExcel = async (file: File) => {
    setImporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, CategoryTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, CategoryTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectCategoryColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('name')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Nama" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: Record<string, string>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw: Record<string, string> = Object.fromEntries(CATEGORY_TEMPLATE_COLS.map(c => [c.key, '']));
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (raw.name.trim()) rows.push(raw);
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data kategori valid pada file tersebut.');
        return;
      }

      const r = await fetch(`${API}/api/categories/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number; skippedDuplicate: number };
        await loadCats();
        const extra = [
          d.skippedDuplicate > 0 ? `${d.skippedDuplicate} ID/Slug duplikat dilewati` : '',
          d.skippedInvalid   > 0 ? `${d.skippedInvalid} baris tidak lengkap dilewati` : '',
        ].filter(Boolean).join(', ');
        toast.success(`${d.created} kategori berhasil diimpor.${extra ? ` (${extra})` : ''}`);
      } else {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        toast.error(d.error ?? 'Gagal mengimpor data kategori.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImporting(false);
    }
  };

  const filteredCats = categories.filter(c =>
    !catSearch || c.name.toLowerCase().includes(catSearch.toLowerCase()) || c.id.toLowerCase().includes(catSearch.toLowerCase())
  );
  const catTotalPages = Math.max(1, Math.ceil(filteredCats.length / catPageSize));
  const catSafePage   = Math.min(catPage, catTotalPages);
  const catPaginated  = filteredCats.slice((catSafePage - 1) * catPageSize, catSafePage * catPageSize);

  const goCatPage    = (p: number) => setCatPage(Math.max(1, Math.min(p, catTotalPages)));
  const resetCatPage = () => setCatPage(1);

  const togglePageAll = () => {
    const pageIds     = catPaginated.map(c => c.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  if (catsLoading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-4">

      {/* Header: search + actions in one row */}
      {categories.length > 0 && (
        <div className="flex flex-row items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{
              position: 'absolute', left: 14, top: '50%',
              transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
            }} />
            <input
              value={catSearch}
              onChange={e => { setCatSearch(e.target.value); resetCatPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari kategori…"
            />
          </div>
          <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
            <Tooltip label="Unduh Template">
              <button onClick={downloadCategoryTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                <ExcelIcon size={14} />
              </button>
            </Tooltip>
            <Tooltip label={importing ? 'Mengimpor…' : 'Upload Excel'}>
              <button onClick={() => importFileRef.current?.click()} disabled={importing} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              </button>
            </Tooltip>
            <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) importCategoriesFromExcel(f); e.target.value = ''; }} />
            <Tooltip label="Export Excel">
              <button onClick={() => exportExcel(filteredCats, 'sesuai filter')} disabled={exporting} aria-label="Export Excel"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
              </button>
            </Tooltip>
            <Tooltip label="Export PDF">
              <button onClick={() => exportPdf(filteredCats, 'sesuai filter')} disabled={exportingPdf} aria-label="Export PDF"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
              </button>
            </Tooltip>
            <ViewToggle mode={catView} onChange={setCatView} height={HEADER_BTN_H} />
            <button onClick={openNewCat} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
              <Plus size={13} /> <span className="hidden sm:inline">Tambah Kategori</span>
            </button>
          </div>
        </div>
      )}

      {categories.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
            <Tag size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada kategori</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            Klik &quot;Tambah Kategori&quot; untuk membuat kategori produk pertama.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button onClick={openNewCat} className="btn-primary px-5 py-2.5 text-sm">
              <Plus size={14} /> Tambah Kategori Pertama
            </button>
            <button onClick={seedCategories} disabled={seedingCats} className="btn-ghost px-5 py-2.5 text-sm">
              {seedingCats ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
              {seedingCats ? 'Menambahkan…' : 'Kategori Default'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Select-all bar */}
          {catPaginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card"
              style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={catPaginated.every(c => selected.has(c.id))}
                indeterminate={catPaginated.some(c => selected.has(c.id)) && !catPaginated.every(c => selected.has(c.id))}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${catPaginated.length} kategori di halaman ini`}
              </span>
            </div>
          )}

          {catPaginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada kategori yang cocok.</p>
            </div>
          ) : catView === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {catPaginated.map((c, idx) => {
                const count      = productCounts[c.id] ?? 0;
                const isDeleting = deletingCatId === c.id;
                const isSelected = selected.has(c.id);
                return (
                  <div key={c.id}
                    style={{
                      borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined,
                      background: isSelected ? 'rgba(212,105,30,0.05)' : undefined,
                      transition: 'background 0.1s',
                    }}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(c.id)} />

                      {/* Emoji / banner thumbnail */}
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 relative overflow-hidden"
                        style={{ background: 'var(--accent-bg)' }}>
                        {c.bannerUrl
                          ? <Image src={c.bannerUrl} alt="" fill className="object-cover" sizes="40px" unoptimized />
                          : c.emoji}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                            {c.id}
                          </span>
                          <span className="badge badge-amber text-[10px]">{count} produk</span>
                          {!c.bannerUrl && (
                            <span className="badge badge-gray text-[10px] flex items-center gap-1">
                              <ImageIcon size={9} /> No banner
                            </span>
                          )}
                        </div>
                        {c.description && (
                          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{c.description}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Tooltip label="Edit">
                          <button onClick={() => openEditCat(c)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                            <Pencil size={13} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button
                            onClick={() => deleteCat(c.id, c.name)}
                            disabled={isDeleting || count > 0}
                            className="btn-ghost p-2 disabled:opacity-30"
                            title={count > 0 ? `Tidak bisa dihapus — ${count} produk menggunakannya` : 'Hapus kategori'}
                            style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {catPaginated.map(c => {
                const count      = productCounts[c.id] ?? 0;
                const isDeleting = deletingCatId === c.id;
                const isSelected = selected.has(c.id);
                return (
                  <div key={c.id} className="card overflow-hidden flex flex-col relative"
                    style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(c.id)} />
                    </div>
                    {c.bannerUrl && (
                      <div className="relative w-full" style={{ aspectRatio: '2 / 1', background: 'var(--surface-2)' }}>
                        <Image src={c.bannerUrl} alt={c.name} fill className="object-cover" sizes="(max-width: 640px) 50vw, 240px" unoptimized />
                      </div>
                    )}
                    <div className="p-4 flex flex-col gap-2 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                          style={{ background: 'var(--accent-bg)' }}>
                          {c.emoji}
                        </div>
                        <span className="badge badge-amber text-[10px] flex-shrink-0 ml-auto">{count} produk</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded inline-block mt-1"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                          {c.id}
                        </span>
                      </div>
                      {c.description && (
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{c.description}</p>
                      )}
                      <div className="flex items-center justify-between mt-auto pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                        <Tooltip label="Edit">
                          <button onClick={() => openEditCat(c)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Hapus">
                          <button
                            onClick={() => deleteCat(c.id, c.name)}
                            disabled={isDeleting || count > 0}
                            className="btn-ghost p-1.5 disabled:opacity-30"
                            title={count > 0 ? `Tidak bisa dihapus — ${count} produk menggunakannya` : 'Hapus kategori'}
                            style={{ color: 'var(--danger)' }}>
                            {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {filteredCats.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filteredCats.length} kategori · halaman {catSafePage} dari {catTotalPages}
                </p>
                <PageSizeSelect value={catPageSize} onChange={n => { setCatPageSize(n); resetCatPage(); }} />
              </div>
              {catTotalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Tooltip label="Halaman sebelumnya">
                    <button onClick={() => goCatPage(catSafePage - 1)} disabled={catSafePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronLeft size={14} />
                    </button>
                  </Tooltip>
                  {Array.from({ length: catTotalPages }, (_, i) => i + 1)
                    .filter(n => n === 1 || n === catTotalPages || Math.abs(n - catSafePage) <= 1)
                    .reduce<(number | '…')[]>((acc, n, i, arr) => {
                      if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(n); return acc;
                    }, [])
                    .map((n, i) =>
                      n === '…'
                        ? <span key={`ce${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                        : <button key={n} onClick={() => goCatPage(n as number)}
                            className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                            style={catSafePage === n
                              ? { background: 'var(--accent)', color: '#fff' }
                              : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                            {n}
                          </button>
                    )
                  }
                  <Tooltip label="Halaman berikutnya">
                    <button onClick={() => goCatPage(catSafePage + 1)} disabled={catSafePage === catTotalPages} className="btn-ghost p-2 disabled:opacity-30">
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
            <button onClick={() => exportExcel(categories.filter(c => selected.has(c.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => exportPdf(categories.filter(c => selected.has(c.id)), 'terpilih')} disabled={exportingPdf}
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
            <button onClick={() => setSelected(new Set())}
              className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Category edit modal */}
      {editingCat && (
        <div className="modal-overlay" onClick={closeEditCat}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />

            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon">
                  <span style={{ fontSize: 17, lineHeight: 1 }}>{editingCat.emoji || '🏷️'}</span>
                </div>
                <div>
                  <p className="modal-title">{isNewCat ? 'Tambah Kategori' : 'Edit Kategori'}</p>
                  <p className="modal-subtitle">{isNewCat ? 'Buat kategori produk baru' : `Edit: ${editingCat.name}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={closeEditCat} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Emoji + Name */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flexShrink: 0 }}>
                    <label className="field-label">Emoji</label>
                    <EmojiPicker
                      value={editingCat.emoji}
                      onChange={emoji => setEditingCat({ ...editingCat, emoji })}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Nama Kategori <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input
                      value={editingCat.name}
                      onChange={e => {
                        const name = e.target.value;
                        setEditingCat({ ...editingCat, name, ...(isNewCat ? { slug: slugify(name) } : {}) });
                      }}
                      className="input"
                      placeholder="Contoh: Keripik"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Slug / ID */}
                <div>
                  <label className="field-label">
                    ID / Slug{isNewCat ? ' (auto dari nama, bisa diedit)' : ' (tidak bisa diubah)'}
                  </label>
                  <input
                    value={isNewCat ? (editingCat.slug || slugify(editingCat.name)) : editingCat.id}
                    onChange={e => isNewCat && setEditingCat({ ...editingCat, slug: slugify(e.target.value) })}
                    readOnly={!isNewCat}
                    className="input"
                    style={!isNewCat ? { opacity: 0.55, cursor: 'not-allowed', fontFamily: 'monospace' } : { fontFamily: 'monospace' }}
                    placeholder="contoh: keripik"
                  />
                  <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
                    Digunakan sebagai referensi di data produk. Hanya huruf kecil, angka, dan tanda hubung.
                  </p>
                </div>

                {/* Description */}
                <div>
                  <label className="field-label">Deskripsi (opsional)</label>
                  <input
                    value={editingCat.description ?? ''}
                    onChange={e => setEditingCat({ ...editingCat, description: e.target.value })}
                    className="input"
                    placeholder="Contoh: Keripik Talas Renyah"
                  />
                </div>

                {/* Banner */}
                <div>
                  <label className="field-label">Banner Kategori (opsional)</label>
                  <ImageUploadBox
                    src={editingCat.bannerUrl}
                    alt="Banner kategori"
                    uploading={uploadingBanner}
                    onSelect={f => uploadBannerImage(f)}
                    onRemove={() => setEditingCat({ ...editingCat, bannerUrl: '' })}
                    aspect="2 / 1"
                    emptyText="Unggah Banner"
                  />
                  <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
                    Tampil sebagai banner saat kategori ini dipilih di halaman toko (rasio 2:1).
                  </p>
                </div>

                {catError && (
                  <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {catError}
                  </p>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={closeEditCat} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={saveCat} disabled={savingCat || !editingCat.name.trim()}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingCat ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {savingCat ? 'Menyimpan…' : 'Simpan Kategori'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
