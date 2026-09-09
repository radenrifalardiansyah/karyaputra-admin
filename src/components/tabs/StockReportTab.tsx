'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import {
  Loader2, RefreshCw, TrendingUp, TrendingDown, Warehouse,
  ChevronRight, ChevronLeft, Package, ArrowLeftRight, Clock, Ban, Search,
  AlertTriangle, Wallet, Boxes,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import { useViewMode, type ViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import ScrollChips from '@/components/ScrollChips';
import { useToast } from '@/components/Toast';
import Tooltip from '@/components/Tooltip';
import ImageCarousel from '@/components/ImageCarousel';
import TopbarPortal from '@/components/TopbarPortal';
import PageSizeSelect from '@/components/PageSizeSelect';
import StockReportPDF from '@/lib/pdf/StockReportPDF';
import StockCardPDF from '@/lib/pdf/StockCardPDF';
import { toDataUri } from '@/lib/pdf/logo';

const API = '';
const HEADER_BTN_H = 34;

// ── Laporan Stok — periode ────────────────────────────────────────────────────
type ReportPeriodKey = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
const REPORT_PERIOD_OPTIONS: { id: ReportPeriodKey; label: string }[] = [
  { id: 'today',  label: 'Hari Ini' },
  { id: '7d',     label: '7 Hari' },
  { id: '30d',    label: '30 Hari' },
  { id: 'month',  label: 'Bulan Ini' },
  { id: 'year',   label: 'Tahun Ini' },
  { id: 'custom', label: 'Custom' },
];

function reportToISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function reportPeriodRange(period: ReportPeriodKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = reportToISO(now);
  switch (period) {
    case 'today': return { from: today, to: today };
    case '7d': { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: reportToISO(d), to: today }; }
    case '30d': { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: reportToISO(d), to: today }; }
    case 'month': { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { from: reportToISO(d), to: today }; }
    case 'year': { const d = new Date(now.getFullYear(), 0, 1); return { from: reportToISO(d), to: today }; }
    case 'custom': return { from: customFrom || today, to: customTo || today };
  }
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

// pageSize bisa Infinity (opsi "Semua" di PageSizeSelect) — (1 - 1) * Infinity = NaN di JS,
// jadi hitung manual supaya baris pertama tetap index 0 saat seluruh data ditampilkan satu halaman.
const pageStartIndex = (page: number, pageSize: number) =>
  Number.isFinite(pageSize) ? (page - 1) * pageSize : 0;

interface WarehouseData {
  id: string;
  name: string;
  location: string;
  description: string;
}

interface ProductStock {
  productId: string;
  productName: string;
  stockQty: number;
}

interface TxEntry {
  id: string;
  type: 'in' | 'out' | 'transfer' | 'reject';
  warehouseId?: string;
  warehouseName?: string;
  fromWarehouseId?: string;
  fromWarehouseName?: string;
  toWarehouseId?: string;
  toWarehouseName?: string;
  productId: string;
  productName?: string;
  qty: number;
  note?: string;
  createdAt?: { seconds?: number; _seconds?: number };
}

interface Product {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  imageUrls?: string[];
  category?: string;
  stock?: string;
  stockQty?: number;
  costPrice?: number;
}

interface WhStockRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  stockQty: number;
}

interface Category {
  id: string;
  label: string;
  emoji: string;
}

function entrySeconds(entry: Pick<TxEntry, 'createdAt'>) {
  return entry.createdAt?.seconds ?? entry.createdAt?._seconds ?? 0;
}

function formatDate(entry: Pick<TxEntry, 'createdAt'>) {
  const seconds = entry.createdAt?.seconds ?? entry.createdAt?._seconds;
  if (seconds)
    return new Date(seconds * 1000).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  return '–';
}

// ── Pagination — dipakai tabel produk & riwayat mutasi ───────────────────────
function Pagination({ total, safePage, totalPages, pageSize, onPageSize, onGoPage, unit }: {
  total: number; safePage: number; totalPages: number; pageSize: number;
  onPageSize: (n: number) => void; onGoPage: (p: number) => void; unit: string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {total} {unit} · halaman {safePage} dari {totalPages}
        </p>
        <PageSizeSelect value={pageSize} onChange={onPageSize} />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onGoPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
            <ChevronLeft size={14} />
          </button>
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
            )
          }
          <button onClick={() => onGoPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── TxList — daftar riwayat mutasi (Tabel/Kartu) ─────────────────────────────
function TxList({
  entries, loading, emptyLabel, warehouses, products, view, startIndex = 0,
}: {
  entries: TxEntry[];
  loading: boolean;
  emptyLabel: string;
  warehouses: WarehouseData[];
  products: Product[];
  view: ViewMode;
  startIndex?: number;
}) {
  const wName = (id?: string) => warehouses.find(w => w.id === id)?.name ?? id ?? '–';
  const pName = (entry: TxEntry) => entry.productName || products.find(p => p.id === entry.productId)?.name || entry.productId;
  const pEmoji = (id: string) => products.find(p => p.id === id)?.emoji ?? '📦';
  const pImages = (id: string) => products.find(p => p.id === id)?.imageUrls;
  const pBgColor = (id: string) => products.find(p => p.id === id)?.bgColor ?? '#F5F0E9';

  const typeBadge = (type: TxEntry['type']) => {
    if (type === 'in')       return { label: 'Masuk',    Icon: TrendingUp,     color: 'var(--success)', bg: 'var(--success-bg)' };
    if (type === 'out')      return { label: 'Keluar',   Icon: TrendingDown,   color: 'var(--danger)',  bg: 'var(--danger-bg)'  };
    if (type === 'reject')   return { label: 'Reject',   Icon: Ban,            color: 'var(--danger)',  bg: 'var(--danger-bg)'  };
    return                          { label: 'Transfer', Icon: ArrowLeftRight, color: '#0284C7',        bg: '#EFF6FF'            };
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  if (entries.length === 0) return (
    <div className="rounded-2xl p-12 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
      <Clock size={24} style={{ color: 'var(--text-muted)', margin: '0 auto 10px', display: 'block' }} />
      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</p>
    </div>
  );

  const rows = entries.map((e, i) => {
    const isIn = e.type === 'in';
    const isTransfer = e.type === 'transfer';
    const badge = typeBadge(e.type);
    const locationLabel = isTransfer
      ? `${e.fromWarehouseName || wName(e.fromWarehouseId)}  →  ${e.toWarehouseName || wName(e.toWarehouseId)}`
      : (e.warehouseName || wName(e.warehouseId));
    return { e, isIn, isTransfer, badge, locationLabel, num: startIndex + i + 1 };
  });

  if (view === 'table') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(({ e, isIn, isTransfer, badge, locationLabel, num }) => (
        <div key={e.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', borderRadius: 12,
          background: 'var(--surface)', border: '1px solid var(--border-2)',
        }}>
          <span style={{ width: 22, flexShrink: 0, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {num}
          </span>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${pBgColor(e.productId)}22`, fontSize: 16, position: 'relative', overflow: 'hidden',
          }}>
            {pImages(e.productId)?.[0]
              ? <Image src={pImages(e.productId)![0]} alt={pName(e)} fill className="object-contain" sizes="36px" unoptimized />
              : pEmoji(e.productId)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-1.5">
              <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pName(e)}
              </p>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em',
                color: badge.color, background: badge.bg, borderRadius: 999, padding: '1.5px 6px 1.5px 5px',
              }}>
                <badge.Icon size={9} strokeWidth={2.5} /> {badge.label}
              </span>
            </div>
            <p style={{
              fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
              display: 'flex', alignItems: 'center', gap: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {isTransfer ? <ArrowLeftRight size={10} style={{ flexShrink: 0 }} /> : <Warehouse size={10} style={{ flexShrink: 0 }} />}
              {locationLabel}
            </p>
            {e.note && (
              <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                &ldquo;{e.note}&rdquo;
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: badge.color, fontVariantNumeric: 'tabular-nums' }}>
              {isIn ? '+' : isTransfer ? '' : '–'}{e.qty} unit
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
              {formatDate(e)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {rows.map(({ e, isIn, isTransfer, badge, locationLabel, num }) => (
        <div key={e.id} className="card overflow-hidden flex flex-col" style={{ borderColor: 'var(--border-2)' }}>
          <div className="relative w-full aspect-square" style={{ background: `${pBgColor(e.productId)}22` }}>
            <ImageCarousel
              imageUrls={pImages(e.productId)}
              emoji={pEmoji(e.productId)}
              alt={pName(e)}
              sizes="(max-width: 640px) 50vw, 200px"
              emojiClassName="text-4xl"
            />
            <span className="absolute top-2 left-2 flex items-center justify-center" style={{
              width: 18, height: 18, borderRadius: 999, fontSize: 9.5, fontWeight: 800,
              color: 'var(--text-secondary)', background: 'var(--surface)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontVariantNumeric: 'tabular-nums',
            }}>
              {num}
            </span>
            <span className="absolute top-2 right-2" style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em',
              color: badge.color, background: 'var(--surface)', borderRadius: 999, padding: '2px 7px 2px 6px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
            }}>
              <badge.Icon size={9} strokeWidth={2.5} /> {badge.label}
            </span>
          </div>
          <div className="px-3 pt-2 pb-3">
            <p className="text-[11px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
              {pName(e)}
            </p>
            <p className="text-[10.5px] mt-1 flex items-center gap-1 truncate" style={{ color: 'var(--text-muted)' }}>
              {isTransfer ? <ArrowLeftRight size={9} style={{ flexShrink: 0 }} /> : <Warehouse size={9} style={{ flexShrink: 0 }} />}
              {locationLabel}
            </p>
            {e.note && (
              <p className="text-[10.5px] mt-0.5 italic truncate" style={{ color: 'var(--text-muted)' }}>&ldquo;{e.note}&rdquo;</p>
            )}
            <div className="flex items-center justify-between mt-2 pt-1.5" style={{ borderTop: '1px solid var(--border-2)' }}>
              <p className="text-xs font-extrabold tabular" style={{ color: badge.color }}>
                {isIn ? '+' : isTransfer ? '' : '–'}{e.qty} unit
              </p>
              <p className="text-[10px] tabular" style={{ color: 'var(--text-muted)' }}>{formatDate(e)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ReportTable — tabel detail stok per produk ───────────────────────────────
interface ReportRow {
  product: Product;
  qty: number;
  costPrice: number;
  nilai: number;
  stokAwal: number;
  masuk: number;
  keluar: number;
  net: number;
  status: 'habis' | 'rendah' | 'normal' | 'open_po';
  ledger: TxEntry[];
}

const REPORT_STATUS_STYLE = {
  habis:   { label: 'Habis',   color: '#DC2626', bg: '#FEF2F2' },
  rendah:  { label: 'Rendah',  color: '#15803D', bg: '#F0FDF4' },
  normal:  { label: 'Normal',  color: '#15803D', bg: '#F0FDF4' },
  open_po: { label: 'Open PO', color: '#15803D', bg: '#F0FDF4' },
} as const;

const TX_TYPE_BADGE: Record<string, { label: string; Icon: React.ElementType; color: string; bg: string }> = {
  in:       { label: 'Masuk',    Icon: TrendingUp,     color: 'var(--success)', bg: 'var(--success-bg)' },
  out:      { label: 'Keluar',   Icon: TrendingDown,   color: 'var(--danger)',  bg: 'var(--danger-bg)'  },
  reject:   { label: 'Reject',   Icon: Ban,            color: 'var(--danger)',  bg: 'var(--danger-bg)'  },
  transfer: { label: 'Transfer', Icon: ArrowLeftRight, color: '#0284C7',        bg: '#EFF6FF'            },
};
const TX_TYPE_BADGE_FALLBACK = { label: 'Lainnya', Icon: ArrowLeftRight, color: 'var(--text-muted)', bg: 'var(--surface-2)' };
function getTxBadge(type: string) {
  return TX_TYPE_BADGE[type] ?? TX_TYPE_BADGE_FALLBACK;
}

// Klasifikasi debit/kredit satu entri ledger untuk kartu stok — transfer hanya berpengaruh
// (debit di tujuan / kredit di asal) kalau lagi melihat gudang tertentu; di scope "semua gudang"
// transfer bersifat netral (barang tetap ada, cuma pindah lokasi).
function classifyMovement(e: TxEntry, whFilter: string): { debit: number; kredit: number } {
  if (e.type === 'in') return { debit: e.qty, kredit: 0 };
  if (e.type === 'out' || e.type === 'reject') return { debit: 0, kredit: e.qty };
  if (e.type === 'transfer' && whFilter !== 'semua') {
    if (e.toWarehouseId === whFilter) return { debit: e.qty, kredit: 0 };
    if (e.fromWarehouseId === whFilter) return { debit: 0, kredit: e.qty };
  }
  return { debit: 0, kredit: 0 };
}

interface StockCardMovement { entry: TxEntry; debit: number; kredit: number; saldo: number }

function buildStockCardMovements(ledger: TxEntry[], stokAwal: number, whFilter: string): StockCardMovement[] {
  let saldo = stokAwal;
  return ledger.map(entry => {
    const { debit, kredit } = classifyMovement(entry, whFilter);
    saldo += debit - kredit;
    return { entry, debit, kredit, saldo };
  });
}

function movementLocation(e: TxEntry, warehouses: WarehouseData[]) {
  const wName = (id?: string) => warehouses.find(w => w.id === id)?.name ?? id ?? '–';
  if (e.type === 'transfer') return `${e.fromWarehouseName || wName(e.fromWarehouseId)} → ${e.toWarehouseName || wName(e.toWarehouseId)}`;
  return e.warehouseName || wName(e.warehouseId) || '–';
}

// ── StockCardPanel — kartu stok (debit/kredit/saldo) satu produk, dibuka lewat expand row ──
function StockCardPanel({ row, whFilter, warehouses, onPrint, printing }: {
  row: ReportRow;
  whFilter: string;
  warehouses: WarehouseData[];
  onPrint: () => void;
  printing: boolean;
}) {
  const movements = buildStockCardMovements(row.ledger, row.stokAwal, whFilter);
  return (
    <div className="mt-2 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border-2)' }}>
        <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Kartu Stok — {row.product.name}</p>
        <button onClick={onPrint} disabled={printing}
          className="btn-ghost px-2.5 py-1.5 text-[11px] font-semibold flex-shrink-0">
          {printing ? <Loader2 size={12} className="animate-spin" /> : <PdfIcon size={12} />}
          Cetak Kartu Stok
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {['Tanggal', 'Tipe', 'Lokasi', 'Keterangan', 'Debit', 'Kredit', 'Saldo'].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-bold uppercase tracking-wide whitespace-nowrap ${i >= 4 ? 'text-right' : 'text-left'}`}
                  style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border-2)' }}>
              <td className="px-3 py-2 italic" colSpan={6} style={{ color: 'var(--text-muted)' }}>Saldo Awal Periode</td>
              <td className="px-3 py-2 text-right font-bold tabular" style={{ color: 'var(--text-primary)' }}>{row.stokAwal}</td>
            </tr>
            {movements.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center" colSpan={7} style={{ color: 'var(--text-muted)' }}>Tidak ada mutasi di periode ini.</td>
              </tr>
            )}
            {movements.map(({ entry, debit, kredit, saldo }) => {
              const badge = getTxBadge(entry.type);
              return (
                <tr key={entry.id} style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <td className="px-3 py-2 whitespace-nowrap tabular" style={{ color: 'var(--text-secondary)' }}>{formatDate(entry)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 font-bold" style={{ color: badge.color, fontSize: 10 }}>
                      <badge.Icon size={10} /> {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 truncate max-w-[180px]" style={{ color: 'var(--text-secondary)' }}>{movementLocation(entry, warehouses)}</td>
                  <td className="px-3 py-2 truncate max-w-[200px] italic" style={{ color: 'var(--text-muted)' }}>{entry.note || '–'}</td>
                  <td className="px-3 py-2 text-right tabular font-semibold" style={{ color: debit > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{debit > 0 ? `+${debit}` : '–'}</td>
                  <td className="px-3 py-2 text-right tabular font-semibold" style={{ color: kredit > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{kredit > 0 ? `–${kredit}` : '–'}</td>
                  <td className="px-3 py-2 text-right tabular font-bold" style={{ color: 'var(--text-primary)' }}>{saldo}</td>
                </tr>
              );
            })}
            <tr>
              <td className="px-3 py-2 font-bold" colSpan={6} style={{ color: 'var(--text-primary)' }}>Saldo Akhir</td>
              <td className="px-3 py-2 text-right font-extrabold tabular" style={{ color: 'var(--accent)' }}>{row.qty}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportTable({ rows, categories, warehouses, whFilter, startIndex = 0, onPrintCard, printingCardId }: {
  rows: ReportRow[];
  categories: Category[];
  warehouses: WarehouseData[];
  whFilter: string;
  startIndex?: number;
  onPrintCard: (row: ReportRow) => void;
  printingCardId: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const catLabel = (id?: string) => categories.find(c => c.id === id)?.label;
  const formatRpCell = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  return (
    <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
      <div className="hidden lg:flex px-4 py-2.5 items-center gap-3" style={{ borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
        <span className="w-6 flex-shrink-0" />
        <span className="flex-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Produk</span>
        <span className="w-14 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Awal</span>
        <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Masuk</span>
        <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Keluar</span>
        <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Stok</span>
        <span className="w-24 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>HPP</span>
        <span className="w-28 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Nilai Stok</span>
        <span className="w-20 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Status</span>
        <span className="w-6 flex-shrink-0" />
      </div>
      <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
        {rows.map((r, i) => {
          const st = REPORT_STATUS_STYLE[r.status];
          const cat = catLabel(r.product.category);
          const isOpen = expanded.has(r.product.id);
          return (
            <div key={r.product.id} className="px-4 py-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                <div className="flex items-center gap-3 lg:contents">
                  <span className="hidden lg:inline-block w-6 flex-shrink-0 text-right text-[11px] font-bold tabular" style={{ color: 'var(--text-muted)' }}>
                    {startIndex + i + 1}
                  </span>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-base relative overflow-hidden" style={{ background: `${r.product.bgColor}22` }}>
                    {r.product.imageUrls?.[0]
                      ? <Image src={r.product.imageUrls[0]} alt={r.product.name} fill className="object-contain" sizes="36px" unoptimized />
                      : r.product.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{r.product.name}</p>
                    {cat && <p className="text-[10.5px] truncate" style={{ color: 'var(--text-muted)' }}>{cat}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 lg:contents">
                  <div className="lg:w-14 lg:flex-shrink-0 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Awal</p>
                    <p className="text-sm font-bold tabular lg:text-right" style={{ color: 'var(--text-secondary)' }}>{r.stokAwal}</p>
                  </div>
                  <div className="lg:w-16 lg:flex-shrink-0 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Masuk</p>
                    <p className="text-sm font-bold tabular lg:text-right" style={{ color: r.masuk > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                      {r.masuk > 0 ? `+${r.masuk}` : '–'}
                    </p>
                  </div>
                  <div className="lg:w-16 lg:flex-shrink-0 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Keluar</p>
                    <p className="text-sm font-bold tabular lg:text-right" style={{ color: r.keluar > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {r.keluar > 0 ? `–${r.keluar}` : '–'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 lg:contents">
                  <div className="lg:w-16 lg:flex-shrink-0 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Stok</p>
                    <p className="text-sm font-bold tabular lg:text-right" style={{ color: 'var(--text-primary)' }}>{r.qty}</p>
                  </div>
                  <div className="lg:w-24 lg:flex-shrink-0 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>HPP</p>
                    <p className="text-sm tabular truncate lg:text-right" style={{ color: 'var(--text-secondary)' }}>{formatRpCell(r.costPrice)}</p>
                  </div>
                  <div className="lg:w-28 lg:flex-shrink-0 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Nilai Stok</p>
                    <p className="text-sm font-bold tabular truncate lg:text-right" style={{ color: 'var(--accent)' }}>{formatRpCell(r.nilai)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 lg:contents">
                  <div className="lg:w-20 lg:flex-shrink-0 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Status</p>
                    <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full lg:ml-auto" style={{ color: st.color, background: st.bg }}>
                      {st.label}
                    </span>
                  </div>
                  <Tooltip label={isOpen ? 'Tutup kartu stok' : 'Lihat kartu stok'}>
                    <button onClick={() => toggle(r.product.id)} className="btn-ghost p-2">
                      <ChevronRight size={13} style={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                    </button>
                  </Tooltip>
                </div>
              </div>
              {isOpen && (
                <StockCardPanel row={r} whFilter={whFilter} warehouses={warehouses}
                  onPrint={() => onPrintCard(r)} printing={printingCardId === r.product.id} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function StockReportTab({
  creds,
  products = [],
  categories = [],
}: {
  creds: string;
  products?: Product[];
  categories?: Category[];
}) {
  const toast = useToast();

  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [historyView, setHistoryView] = useViewMode('stock-history');

  const [reportPeriod, setReportPeriod]         = useState<ReportPeriodKey>('month');
  const [reportCustomFrom, setReportCustomFrom] = useState('');
  const [reportCustomTo, setReportCustomTo]     = useState('');
  const [reportWhFilter, setReportWhFilter]     = useState('semua');
  const [reportCatFilter, setReportCatFilter]   = useState('semua');
  const [reportSearch, setReportSearch]         = useState('');
  const [reportPage, setReportPage]             = useState(1);
  const [reportPageSize, setReportPageSize]     = useState(10);
  const [reportTxPage, setReportTxPage]         = useState(1);
  const [reportTxPageSize, setReportTxPageSize] = useState(10);
  const [reportLedger, setReportLedger]         = useState<TxEntry[]>([]);
  const [reportLedgerLoading, setReportLedgerLoading] = useState(false);
  const [allWhStocks, setAllWhStocks]           = useState<WhStockRow[]>([]);
  const [allWhStocksLoading, setAllWhStocksLoading] = useState(false);
  const [exportingReport, setExportingReport]   = useState(false);
  const [printingReportPdf, setPrintingReportPdf] = useState(false);
  const [printingCardId, setPrintingCardId]     = useState<string | null>(null);
  const [storeInfo, setStoreInfo] = useState<{ storeName?: string; storeTagline?: string; address?: string; city?: string; whatsapp?: string; logo?: string }>({});
  const [logoDataUri, setLogoDataUri] = useState<string | undefined>(undefined);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  useEffect(() => {
    fetch(`${API}/api/settings`, { headers }).then(async r => {
      if (r.ok) setStoreInfo((await r.json() as { settings: typeof storeInfo }).settings ?? {});
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { toDataUri(storeInfo.logo).then(setLogoDataUri); }, [storeInfo.logo]);

  const storeHeader = {
    name:    storeInfo.storeName?.trim() || 'Cemilan Teh Risma',
    tagline: storeInfo.storeTagline?.trim() || undefined,
    address: [storeInfo.address, storeInfo.city].filter(Boolean).join(', ') || undefined,
    phone:   storeInfo.whatsapp?.trim() || undefined,
    logo:    logoDataUri,
  };

  const loadWarehouses = async () => {
    const r = await fetch(`${API}/api/warehouses`, { headers });
    if (r.ok) {
      const { warehouses: w } = await r.json() as { warehouses: WarehouseData[] };
      setWarehouses(w);
    }
  };

  const { from: reportFrom, to: reportTo } = reportPeriodRange(reportPeriod, reportCustomFrom, reportCustomTo);

  const loadReportLedger = async () => {
    setReportLedgerLoading(true);
    const r = await fetch(`${API}/api/stock?from=${reportFrom}&to=${reportTo}`, { headers });
    if (r.ok) {
      const { entries } = await r.json() as { entries: TxEntry[] };
      setReportLedger(entries);
    }
    setReportLedgerLoading(false);
  };

  const loadAllWhStocks = async () => {
    if (warehouses.length === 0) { setAllWhStocks([]); return; }
    setAllWhStocksLoading(true);
    const results = await Promise.all(warehouses.map(async w => {
      const r = await fetch(`${API}/api/warehouses/${w.id}/stock`, { headers });
      if (!r.ok) return [];
      const { stocks: s } = await r.json() as { stocks: ProductStock[] };
      return s.map(x => ({ warehouseId: w.id, warehouseName: w.name, ...x }));
    }));
    setAllWhStocks(results.flat());
    setAllWhStocksLoading(false);
  };

  useEffect(() => { loadWarehouses(); }, []);
  useEffect(() => { loadReportLedger(); loadAllWhStocks(); }, [reportFrom, reportTo, warehouses]); // eslint-disable-line react-hooks/exhaustive-deps

  const wName = (id?: string) => warehouses.find(w => w.id === id)?.name ?? '';

  const reportLedgerFiltered = reportWhFilter === 'semua'
    ? reportLedger
    : reportLedger.filter(e =>
        e.warehouseId === reportWhFilter ||
        e.fromWarehouseId === reportWhFilter ||
        e.toWarehouseId === reportWhFilter,
      );

  const sumQty = (entries: TxEntry[], types: TxEntry['type'][]) =>
    entries.filter(e => types.includes(e.type)).reduce((s, e) => s + e.qty, 0);

  const reportMasukQty   = sumQty(reportLedgerFiltered, ['in']);
  const reportKeluarQty  = sumQty(reportLedgerFiltered, ['out', 'reject']);
  const reportTrIn       = reportWhFilter === 'semua' ? 0 : reportLedgerFiltered.filter(e => e.type === 'transfer' && e.toWarehouseId === reportWhFilter).reduce((s, e) => s + e.qty, 0);
  const reportTrOut      = reportWhFilter === 'semua' ? 0 : reportLedgerFiltered.filter(e => e.type === 'transfer' && e.fromWarehouseId === reportWhFilter).reduce((s, e) => s + e.qty, 0);
  const reportTransferCt = reportLedgerFiltered.filter(e => e.type === 'transfer').length;
  const reportNetQty     = reportMasukQty + reportTrIn - reportKeluarQty - reportTrOut;

  const currentQtyMap = new Map<string, number>();
  if (reportWhFilter === 'semua') {
    products.forEach(p => currentQtyMap.set(p.id, p.stockQty ?? 0));
  } else {
    allWhStocks.filter(s => s.warehouseId === reportWhFilter).forEach(s => currentQtyMap.set(s.productId, s.stockQty));
  }

  const reportRowsAll = products.map(p => {
    const qty = currentQtyMap.get(p.id) ?? 0;
    const costPrice = p.costPrice ?? 0;
    const ledgerForP = reportLedgerFiltered.filter(e => e.productId === p.id);
    const masuk = sumQty(ledgerForP, ['in']);
    const keluar = sumQty(ledgerForP, ['out', 'reject']);
    const trIn  = reportWhFilter === 'semua' ? 0 : ledgerForP.filter(e => e.type === 'transfer' && e.toWarehouseId === reportWhFilter).reduce((s, e) => s + e.qty, 0);
    const trOut = reportWhFilter === 'semua' ? 0 : ledgerForP.filter(e => e.type === 'transfer' && e.fromWarehouseId === reportWhFilter).reduce((s, e) => s + e.qty, 0);
    const isPO = p.stock === 'open_po';
    const status: 'habis' | 'rendah' | 'normal' | 'open_po' = isPO ? 'open_po' : qty === 0 ? 'habis' : qty < 10 ? 'rendah' : 'normal';
    const net = masuk + trIn - keluar - trOut;
    // Stok Awal = saldo sebelum periode terpilih — dihitung mundur dari stok saat ini dikurangi
    // net mutasi periode ini. Akurat selama `to` periode mencakup hari ini (semua opsi periode
    // kecuali "Custom" dengan tanggal akhir di masa lampau, sama seperti batasan status/qty di atas).
    const stokAwal = qty - net;
    const ledger = [...ledgerForP].sort((a, b) => entrySeconds(a) - entrySeconds(b));
    return {
      product: p, qty, costPrice, nilai: qty * costPrice, stokAwal,
      masuk, keluar, net, status, ledger,
    };
  });

  const reportCatCounts = categories
    .map(c => ({ ...c, count: reportRowsAll.filter(r => r.product.category === c.id).length }))
    .filter(c => c.count > 0);

  const reportScopeRows = reportCatFilter === 'semua' ? reportRowsAll : reportRowsAll.filter(r => r.product.category === reportCatFilter);
  const reportDisplayRows = (reportSearch
    ? reportScopeRows.filter(r => r.product.name.toLowerCase().includes(reportSearch.toLowerCase()))
    : reportScopeRows
  ).slice().sort((a, b) => b.nilai - a.nilai);

  const reportTotalNilai   = reportScopeRows.reduce((s, r) => s + r.nilai, 0);
  const reportTotalUnit    = reportScopeRows.reduce((s, r) => s + r.qty, 0);
  const reportJenisProduk  = reportScopeRows.filter(r => r.qty > 0 || r.status === 'open_po').length;
  const reportRendahCount  = reportScopeRows.filter(r => r.status === 'rendah').length;
  const reportHabisCount   = reportScopeRows.filter(r => r.status === 'habis').length;

  const totalReportPages = Math.max(1, Math.ceil(reportDisplayRows.length / reportPageSize));
  const safeReportPage   = Math.min(reportPage, totalReportPages);
  const paginatedReportRows = reportDisplayRows.slice((safeReportPage - 1) * reportPageSize, safeReportPage * reportPageSize);
  const goReportPage     = (p: number) => setReportPage(Math.max(1, Math.min(p, totalReportPages)));

  const reportLedgerSorted = [...reportLedgerFiltered].sort((a, b) => entrySeconds(b) - entrySeconds(a));
  const totalReportTxPages = Math.max(1, Math.ceil(reportLedgerSorted.length / reportTxPageSize));
  const safeReportTxPage   = Math.min(reportTxPage, totalReportTxPages);
  const paginatedReportTx  = reportLedgerSorted.slice((safeReportTxPage - 1) * reportTxPageSize, safeReportTxPage * reportTxPageSize);
  const goReportTxPage     = (p: number) => setReportTxPage(Math.max(1, Math.min(p, totalReportTxPages)));

  const reportPeriodLabel = REPORT_PERIOD_OPTIONS.find(p => p.id === reportPeriod)?.label ?? '';
  const reportWhLabel = reportWhFilter === 'semua' ? 'Semua Gudang' : (warehouses.find(w => w.id === reportWhFilter)?.name ?? '');

  const exportReportExcel = async () => {
    setExportingReport(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();

      const styleTitle = (ws: ExcelJS.Worksheet, title: string, subtitle: string, colCount: number) => {
        ws.mergeCells(1, 1, 1, colCount);
        const t = ws.getCell(1, 1);
        t.value = title; t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
        ws.getRow(1).height = 28;
        ws.mergeCells(2, 1, 2, colCount);
        const s = ws.getCell(2, 1);
        s.value = subtitle; s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
        s.alignment = { horizontal: 'center', vertical: 'middle' };
        s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
        ws.getRow(2).height = 20;
      };
      const styleHeader = (ws: ExcelJS.Worksheet, rowNum: number, hdrs: string[]) => {
        const row = ws.getRow(rowNum);
        hdrs.forEach((h, i) => { row.getCell(i + 1).value = h; });
        row.height = 24;
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        ws.views = [{ state: 'frozen', ySplit: rowNum }];
      };
      const zebra = (ws: ExcelJS.Worksheet, rowNum: number, idx: number) => {
        ws.getRow(rowNum).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
      };

      // ── Sheet 1: Ringkasan ──
      const wsR = wb.addWorksheet('Ringkasan');
      wsR.columns = [{ key: 'a', width: 32 }, { key: 'b', width: 20 }];
      styleTitle(wsR, 'RINGKASAN LAPORAN STOK — CEMILAN TEH RISMA', `${reportWhLabel} · Periode: ${reportPeriodLabel} (${reportFrom} s/d ${reportTo})`, 2);
      styleHeader(wsR, 3, ['Keterangan', 'Jumlah']);
      const rRows: [string, number | string][] = [
        ['Total Nilai Stok (HPP)', reportTotalNilai], ['Total Unit Stok', reportTotalUnit],
        ['Jenis Produk', reportJenisProduk], ['Stok Rendah (< 10 unit)', reportRendahCount], ['Stok Habis', reportHabisCount],
        ['Stok Masuk (periode)', reportMasukQty], ['Stok Keluar (periode)', reportKeluarQty],
        ['Transaksi Transfer (periode)', reportTransferCt], ['Net Perubahan (periode)', reportNetQty],
      ];
      rRows.forEach(([label, val], i) => {
        const rowNum = 4 + i;
        wsR.getRow(rowNum).getCell(1).value = label;
        wsR.getRow(rowNum).getCell(2).value = val;
        if (label === 'Total Nilai Stok (HPP)') wsR.getRow(rowNum).getCell(2).numFmt = '"Rp"#,##0';
        zebra(wsR, rowNum, i);
      });

      // ── Sheet 2: Detail Stok per Produk ──
      const wsD = wb.addWorksheet('Detail Stok per Produk');
      wsD.columns = [
        { key: 'produk', width: 30 }, { key: 'kategori', width: 16 }, { key: 'awal', width: 10 },
        { key: 'qty', width: 12 }, { key: 'hpp', width: 16 }, { key: 'nilai', width: 18 },
        { key: 'masuk', width: 12 }, { key: 'keluar', width: 12 }, { key: 'net', width: 12 }, { key: 'status', width: 14 },
      ];
      styleTitle(wsD, 'DETAIL STOK PER PRODUK — CEMILAN TEH RISMA', `${reportWhLabel} · Periode mutasi: ${reportPeriodLabel} (${reportFrom} s/d ${reportTo})`, 10);
      styleHeader(wsD, 3, ['Produk', 'Kategori', 'Stok Awal', 'Stok Akhir', 'HPP', 'Nilai Stok', 'Masuk', 'Keluar', 'Net', 'Status']);
      const catLabelFor = (id?: string) => categories.find(c => c.id === id)?.label ?? (id ?? '');
      const statusLabel = { habis: 'Habis', rendah: 'Rendah', normal: 'Normal', open_po: 'Open PO' };
      [...reportRowsAll].sort((a, b) => b.nilai - a.nilai).forEach((r, i) => {
        const rowNum = 4 + i;
        const row = wsD.getRow(rowNum);
        row.getCell(1).value = r.product.name;
        row.getCell(2).value = catLabelFor(r.product.category);
        row.getCell(3).value = r.stokAwal;
        row.getCell(4).value = r.qty;
        row.getCell(5).value = r.costPrice;
        row.getCell(6).value = r.nilai;
        row.getCell(7).value = r.masuk;
        row.getCell(8).value = r.keluar;
        row.getCell(9).value = r.net;
        row.getCell(10).value = statusLabel[r.status];
        row.getCell(5).numFmt = '"Rp"#,##0';
        row.getCell(6).numFmt = '"Rp"#,##0';
        zebra(wsD, rowNum, i);
      });

      // ── Sheet 3: Riwayat Mutasi ──
      const wsM = wb.addWorksheet('Riwayat Mutasi');
      wsM.columns = [
        { key: 'tgl', width: 16 }, { key: 'tipe', width: 12 }, { key: 'produk', width: 28 },
        { key: 'lokasi', width: 30 }, { key: 'qty', width: 10 }, { key: 'ket', width: 30 },
      ];
      styleTitle(wsM, 'RIWAYAT MUTASI STOK — CEMILAN TEH RISMA', `${reportWhLabel} · Periode: ${reportPeriodLabel} (${reportFrom} s/d ${reportTo})`, 6);
      styleHeader(wsM, 3, ['Tanggal', 'Tipe', 'Produk', 'Lokasi', 'Qty', 'Keterangan']);
      const tipeLabel = { in: 'Masuk', out: 'Keluar', reject: 'Reject', transfer: 'Transfer' };
      reportLedgerSorted.forEach((e, i) => {
        const rowNum = 4 + i;
        const row = wsM.getRow(rowNum);
        const seconds = e.createdAt?.seconds ?? e.createdAt?._seconds;
        row.getCell(1).value = seconds ? new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
        row.getCell(2).value = tipeLabel[e.type];
        row.getCell(3).value = e.productName || products.find(p => p.id === e.productId)?.name || e.productId;
        row.getCell(4).value = e.type === 'transfer'
          ? `${e.fromWarehouseName || wName(e.fromWarehouseId)} → ${e.toWarehouseName || wName(e.toWarehouseId)}`
          : (e.warehouseName || wName(e.warehouseId));
        row.getCell(5).value = e.qty;
        row.getCell(6).value = e.note ?? '';
        zebra(wsM, rowNum, i);
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-stok-${reportFrom}-sd-${reportTo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally { setExportingReport(false); }
  };

  const printReportPdf = async () => {
    setPrintingReportPdf(true);
    try {
      const rows = [...reportRowsAll].sort((a, b) => b.nilai - a.nilai).map((r, i) => ({
        no: i + 1,
        productName: r.product.name,
        category: categories.find(c => c.id === r.product.category)?.label,
        stokAwal: r.stokAwal,
        masuk: r.masuk,
        keluar: r.keluar,
        stokAkhir: r.qty,
        hpp: r.costPrice,
        nilai: r.nilai,
        status: REPORT_STATUS_STYLE[r.status].label,
      }));
      const blob = await pdf(
        <StockReportPDF
          store={storeHeader}
          data={{
            periodLabel: reportPeriodLabel, from: reportFrom, to: reportTo, whLabel: reportWhLabel,
            totalNilai: reportTotalNilai, totalUnit: reportTotalUnit, jenisProduk: reportJenisProduk,
            rendahCount: reportRendahCount, habisCount: reportHabisCount,
            masukQty: reportMasukQty, keluarQty: reportKeluarQty, transferCt: reportTransferCt, netQty: reportNetQty,
            rows,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-stok-${reportFrom}-sd-${reportTo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal membuat laporan PDF.');
    } finally {
      setPrintingReportPdf(false);
    }
  };

  const printStockCard = async (row: ReportRow) => {
    setPrintingCardId(row.product.id);
    try {
      const movements = buildStockCardMovements(row.ledger, row.stokAwal, reportWhFilter).map(({ entry, debit, kredit, saldo }) => ({
        date: formatDate(entry),
        tipe: getTxBadge(entry.type).label,
        lokasi: movementLocation(entry, warehouses),
        note: entry.note,
        debit, kredit, saldo,
      }));
      const blob = await pdf(
        <StockCardPDF
          store={storeHeader}
          data={{
            productName: row.product.name,
            category: categories.find(c => c.id === row.product.category)?.label,
            periodLabel: reportPeriodLabel, from: reportFrom, to: reportTo, whLabel: reportWhLabel,
            stokAwal: row.stokAwal, masuk: row.masuk, keluar: row.keluar, stokAkhir: row.qty,
            movements,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kartu-stok-${row.product.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${reportFrom}-sd-${reportTo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal membuat kartu stok PDF.');
    } finally {
      setPrintingCardId(null);
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-up">
      <TopbarPortal>
        <button onClick={exportReportExcel} disabled={exportingReport} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Export Excel">
          {exportingReport ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
        </button>
        <button onClick={printReportPdf} disabled={printingReportPdf} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Cetak PDF">
          {printingReportPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
        </button>
        <button onClick={() => { loadReportLedger(); loadAllWhStocks(); }}
          className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
          <RefreshCw size={14} className={(reportLedgerLoading || allWhStocksLoading) ? 'animate-spin' : ''} />
        </button>
      </TopbarPortal>

      {/* Pemilih periode */}
      <div className="flex flex-wrap items-center gap-2">
        {REPORT_PERIOD_OPTIONS.map(p => (
          <button key={p.id} onClick={() => setReportPeriod(p.id)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={reportPeriod === p.id ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {p.label}
          </button>
        ))}
        {reportPeriod === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={reportCustomFrom} onChange={e => setReportCustomFrom(e.target.value)} className="input" style={{ height: 36, width: 'auto' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <input type="date" value={reportCustomTo} onChange={e => setReportCustomTo(e.target.value)} className="input" style={{ height: 36, width: 'auto' }} />
          </div>
        )}
      </div>

      {/* Filter gudang */}
      <ScrollChips>
        <button onClick={() => setReportWhFilter('semua')} className={`tab-chip text-xs py-1.5 ${reportWhFilter === 'semua' ? 'active' : ''}`}>
          <Warehouse size={11} /> Semua Gudang
        </button>
        {warehouses.map(w => (
          <button key={w.id} onClick={() => setReportWhFilter(w.id)} className={`tab-chip text-xs py-1.5 ${reportWhFilter === w.id ? 'active' : ''}`}>
            {w.name}
          </button>
        ))}
      </ScrollChips>

      {/* Ringkasan stok saat ini */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
          Ringkasan Stok Saat Ini — {reportWhLabel}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { icon: <Wallet size={16} />, label: 'Nilai Stok (HPP)', val: formatRp(reportTotalNilai), color: 'var(--accent)' },
            { icon: <Boxes size={16} />, label: 'Total Unit', val: reportTotalUnit, color: '#0284C7' },
            { icon: <Package size={16} />, label: 'Jenis Produk', val: reportJenisProduk, color: 'var(--success)' },
            { icon: <AlertTriangle size={16} />, label: 'Stok Rendah', val: reportRendahCount, color: '#15803D' },
            { icon: <Ban size={16} />, label: 'Stok Habis', val: reportHabisCount, color: 'var(--danger)' },
          ].map((c, i) => (
            <div key={i} className="card p-4">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: 'var(--accent-bg)', color: c.color }}>
                {c.icon}
              </div>
              <p className="text-xl font-extrabold tabular" style={{ color: c.color }}>{c.val}</p>
              <p className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Ringkasan mutasi periode */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
          Mutasi Periode {reportPeriodLabel} ({reportFrom} s/d {reportTo})
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: <TrendingUp size={16} />, label: 'Stok Masuk', val: `+${reportMasukQty}`, color: 'var(--success)' },
            { icon: <TrendingDown size={16} />, label: 'Stok Keluar', val: `–${reportKeluarQty}`, color: 'var(--danger)' },
            { icon: <ArrowLeftRight size={16} />, label: 'Transfer', val: reportTransferCt, color: '#0284C7' },
            { icon: reportNetQty >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />, label: 'Net Perubahan',
              val: `${reportNetQty >= 0 ? '+' : ''}${reportNetQty}`, color: reportNetQty >= 0 ? 'var(--success)' : 'var(--danger)' },
          ].map((c, i) => (
            <div key={i} className="card p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: c.color }}>
                {c.icon}
              </div>
              <div>
                <p className="text-lg font-extrabold tabular leading-none" style={{ color: c.color }}>{c.val}</p>
                <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail per produk */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm font-bold flex-1" style={{ color: 'var(--text-primary)' }}>Detail Stok per Produk</p>
          <div className="relative sm:max-w-xs">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={reportSearch} onChange={e => { setReportSearch(e.target.value); setReportPage(1); }}
              className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder="Cari produk…" />
          </div>
        </div>

        {reportCatCounts.length > 0 && (
          <ScrollChips>
            <button onClick={() => { setReportCatFilter('semua'); setReportPage(1); }}
              className={`tab-chip text-xs py-1.5 ${reportCatFilter === 'semua' ? 'active' : ''}`}>
              Semua ({reportRowsAll.length})
            </button>
            {reportCatCounts.map(c => (
              <button key={c.id} onClick={() => { setReportCatFilter(c.id); setReportPage(1); }}
                className={`tab-chip text-xs py-1.5 ${reportCatFilter === c.id ? 'active' : ''}`}>
                {c.emoji} {c.label} ({c.count})
              </button>
            ))}
          </ScrollChips>
        )}

        {paginatedReportRows.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p>
          </div>
        ) : (
          <>
            <ReportTable rows={paginatedReportRows} categories={categories} warehouses={warehouses} whFilter={reportWhFilter}
              startIndex={pageStartIndex(safeReportPage, reportPageSize)}
              onPrintCard={printStockCard} printingCardId={printingCardId} />
            <Pagination total={reportDisplayRows.length} safePage={safeReportPage} totalPages={totalReportPages}
              pageSize={reportPageSize} onPageSize={n => { setReportPageSize(n); setReportPage(1); }}
              onGoPage={goReportPage} unit="produk" />
          </>
        )}
      </div>

      {/* Riwayat mutasi periode */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Riwayat Mutasi — {reportWhLabel}</p>
          <ViewToggle mode={historyView} onChange={setHistoryView} height={HEADER_BTN_H} />
        </div>
        {reportLedgerLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : (
          <>
            <TxList entries={paginatedReportTx} loading={false} emptyLabel="Tidak ada mutasi stok di periode ini"
              warehouses={warehouses} products={products} view={historyView}
              startIndex={pageStartIndex(safeReportTxPage, reportTxPageSize)} />
            <Pagination total={reportLedgerSorted.length} safePage={safeReportTxPage} totalPages={totalReportTxPages}
              pageSize={reportTxPageSize} onPageSize={n => { setReportTxPageSize(n); setReportTxPage(1); }}
              onGoPage={goReportTxPage} unit="mutasi" />
          </>
        )}
      </div>
    </div>
  );
}
