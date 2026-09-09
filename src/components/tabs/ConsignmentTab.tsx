'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Store, Send, ClipboardList, Plus, Pencil, Trash2, X, Check, Loader2, RefreshCw,
  Clock, AlertTriangle, Phone, MapPin, StickyNote,
  Search, ChevronLeft, ChevronRight, Upload,
  History, Warehouse, Ban, MessageCircle, PackageCheck, PieChart, ScanLine,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ImageUploadBox from '@/components/ImageUploadBox';
import { type PeriodKey, periodRange, PERIOD_OPTIONS } from '@/lib/period';
import ConsignmentAnalyticsSection, { type ConsignmentAnalyticsData } from '@/components/dashboard/ConsignmentAnalyticsSection';
import ExcelJS from 'exceljs';
import { pdf, Document } from '@react-pdf/renderer';
import TopbarPortal from '@/components/TopbarPortal';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import BarcodeScannerModal from '@/components/BarcodeScannerModal';
import { resolveScannedProductId } from '@/lib/scan';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import Tooltip from '@/components/Tooltip';
import { RecordHistoryButton, RecordHistoryPanel } from '@/components/RecordHistory';
import type { PosProduct } from '@/lib/pos-types';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';
import ShipmentNotePDF, { ShipmentNotePDFPage } from '@/lib/pdf/ShipmentNotePDF';
import RecapNotePDF, { RecapNotePDFPage } from '@/lib/pdf/RecapNotePDF';
import { groupAndMergeRecaps } from '@/lib/consignment-recap-merge';
import { groupAndMergeShipments } from '@/lib/consignment-shipment-merge';
import LocationHistoryPDF from '@/lib/pdf/LocationHistoryPDF';
import LocationsListPDF from '@/lib/pdf/LocationsListPDF';
import { toDataUri } from '@/lib/pdf/logo';
import { useVisiblePolling } from '@/lib/useVisiblePolling';

const API = '';
const HEADER_BTN_H = 34;
// Locations' load also re-fetches per-location stock (N+1, uncached) — longer than Kasir/
// Pesanan's interval since this one is pricier per tick.
const CONSIGNMENT_POLL_MS = 45_000;

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

function formatDate(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Format untuk input datetime-local (tanggal + jam bisa diedit, dipakai di form Kirim Stok & Rekap Harian)
function toLocalDateTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : '62' + d;
}

type SubTab = 'lokasi' | 'kirim' | 'rekap' | 'analitik';
const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'lokasi', label: 'Lokasi',      Icon: Store },
  { id: 'kirim',  label: 'Kirim Stok',  Icon: Send },
  { id: 'rekap',  label: 'Rekap Harian', Icon: ClipboardList },
  { id: 'analitik', label: 'Analitik',  Icon: PieChart },
];

interface ConsignmentLocation {
  id: string; name: string; contactName: string; contactPhone: string; address: string; note: string; code?: string; logoUrl?: string;
}

function LocationLogo({ location, size }: { location: { name: string; logoUrl?: string }; size: number }) {
  if (location.logoUrl) {
    return (
      <div className="rounded-xl overflow-hidden flex-shrink-0" style={{ width: size, height: size, background: 'var(--surface)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={location.logoUrl} alt={location.name} className="w-full h-full" style={{ objectFit: 'contain' }} />
      </div>
    );
  }
  return (
    <div className="rounded-xl flex-shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
      <Store size={Math.round(size * 0.45)} />
    </div>
  );
}
type LocationForm = { name: string; contactName: string; contactPhone: string; address: string; note: string; code: string; logoUrl: string };
const EMPTY_LOCATION: LocationForm = { name: '', contactName: '', contactPhone: '', address: '', note: '', code: '', logoUrl: '' };

const LOCATION_CODE_PREFIX = 'MTR';

function nextLocationCode(locations: ConsignmentLocation[]) {
  let max = 0;
  for (const l of locations) {
    const m = new RegExp(`^${LOCATION_CODE_PREFIX}(\\d+)$`, 'i').exec((l.code ?? '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${LOCATION_CODE_PREFIX}${String(max + 1).padStart(3, '0')}`;
}

interface ConsignmentStockItem { productId: string; productName: string; stockQty: number; hargaTitip: number }

interface ShipmentItem { productId: string; productName: string; qty: number; hargaTitip: number; subtotal: number }
interface Shipment {
  id: string; locationId?: string; locationName: string; warehouseId?: string; warehouseName?: string;
  items: ShipmentItem[]; note?: string; createdAt?: { seconds: number };
}

interface RecapItem { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject: number; hargaTitip: number; revenue: number }
interface Recap {
  id: string; locationId?: string; locationName: string; items: RecapItem[];
  totalSold: number; totalRetur: number; totalReject: number; totalRevenue: number; note?: string;
  paymentStatus?: 'lunas' | 'belum_lunas';
  warehouseId?: string; warehouseName?: string;
  createdAt?: { seconds: number };
  walletId?: string | null;
}

interface ConsignmentWarehouse { id: string; name: string }

interface SendRow { productId: string; qty: string; hargaTitip: string }
const EMPTY_SEND_ROW: SendRow = { productId: '', qty: '', hargaTitip: '' };

// ─── Excel import (Lokasi) ─────────────────────────────────────────────────────
const LOCATION_TEMPLATE_COLS = [
  { header: 'Nama Lokasi*', key: 'name',        width: 24 },
  { header: 'Nama Kontak',  key: 'contactName', width: 20 },
  { header: 'Telepon',      key: 'contactPhone', width: 18 },
  { header: 'Alamat',       key: 'address',     width: 32 },
  { header: 'Catatan',      key: 'note',        width: 28 },
] as const;

type LocationTemplateKey = typeof LOCATION_TEMPLATE_COLS[number]['key'];

function detectLocationColumn(header: string): LocationTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('lokasi')) return 'name';
  if (h.includes('kontak')) return 'contactName';
  if (h.includes('telepon') || h.includes('hp') || h.includes('whatsapp') || h.includes('phone')) return 'contactPhone';
  if (h.includes('alamat') || h.includes('address')) return 'address';
  if (h.includes('catatan') || h.includes('note')) return 'note';
  if (h.includes('nama')) return 'name';
  return null;
}

// Pagination bar (shared markup across the three lists in this tab)
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
            )
          }
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

interface LocationStats { totalKirim: number; totalSold: number; totalRetur: number; totalReject: number; totalRevenue: number }
const EMPTY_LOCATION_STATS: LocationStats = { totalKirim: 0, totalSold: 0, totalRetur: 0, totalReject: 0, totalRevenue: 0 };

// Filter periode untuk statistik lokasi (sama seperti di tab Laporan).
type LocationPeriodKey = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
const LOCATION_PERIOD_OPTIONS: { id: LocationPeriodKey; label: string }[] = [
  { id: 'today', label: 'Hari Ini' },
  { id: '7d',    label: '7 Hari' },
  { id: '30d',   label: '30 Hari' },
  { id: 'month', label: 'Bulan Ini' },
  { id: 'year',  label: 'Tahun Ini' },
  { id: 'custom', label: 'Custom' },
];
function locationToISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function locationPeriodRange(period: LocationPeriodKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = locationToISO(now);
  switch (period) {
    case 'today': return { from: today, to: today };
    case '7d': { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: locationToISO(d), to: today }; }
    case '30d': { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: locationToISO(d), to: today }; }
    case 'month': { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { from: locationToISO(d), to: today }; }
    case 'year': { const d = new Date(now.getFullYear(), 0, 1); return { from: locationToISO(d), to: today }; }
    case 'custom': return { from: customFrom || today, to: customTo || today };
  }
}

// Ringkasan stok saat ini / dikirim / pendapatan / selisih / persentase / jual-retur-reject per
// lokasi (dipakai di table & card, sama seperti di modal Riwayat). Selisih & persentase dihitung
// dari Dikirim vs Pendapatan — menunjukkan seberapa besar nilai titip yang belum "kembali" jadi
// pendapatan (masih di stok lokasi, belum direkap, atau hilang lewat retur/reject).
// `dense`: card grid (Kartu view) keeps each tile in a narrow ~1/3-width column no matter how
// wide the viewport gets, so tiles must cap at 3 columns instead of following viewport breakpoints
// (xl:grid-cols-6 would cram 6 tiles into that narrow card and truncate every label).
function LocationStatTiles({ stockQty, stockValue, stats, dense = false }: { stockQty: number; stockValue: number; stats: LocationStats; dense?: boolean }) {
  const selisih = stats.totalKirim - stats.totalRevenue;
  const pctLabel = stats.totalKirim > 0 ? `${((stats.totalRevenue / stats.totalKirim) * 100).toFixed(1)}%` : '–';
  const tileLabelCls = "text-[9px] font-semibold uppercase leading-tight whitespace-nowrap overflow-hidden text-ellipsis";
  const tileValueCls = "text-xs font-bold tabular leading-tight mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis";
  return (
    <div className={dense ? "grid grid-cols-2 sm:grid-cols-3 gap-1.5" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5"}>
      <div className="flex flex-col justify-between px-3 py-2 rounded-lg min-h-[52px] min-w-0" style={{ background: stockQty > 0 ? 'var(--success-bg)' : 'var(--surface-2)' }}>
        <p className={tileLabelCls} style={{ color: 'var(--text-muted)' }}>Stok Saat Ini</p>
        <div className="min-w-0">
          <p className={tileValueCls} style={{ color: stockQty > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{stockQty} pcs</p>
          <p className="text-[10px] tabular leading-tight whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: 'var(--text-muted)' }}>{formatRp(stockValue)}</p>
        </div>
      </div>
      <div className="flex flex-col justify-between px-3 py-2 rounded-lg min-h-[52px] min-w-0" style={{ background: 'var(--surface-2)' }}>
        <p className={tileLabelCls} style={{ color: 'var(--text-muted)' }}>Dikirim</p>
        <p className={tileValueCls} style={{ color: 'var(--text-primary)' }}>{formatRp(stats.totalKirim)}</p>
      </div>
      <div className="flex flex-col justify-between px-3 py-2 rounded-lg min-h-[52px] min-w-0" style={{ background: stats.totalRevenue > 0 ? 'var(--success-bg)' : 'var(--surface-2)' }}>
        <p className={tileLabelCls} style={{ color: 'var(--text-muted)' }}>Pendapatan</p>
        <p className={tileValueCls} style={{ color: stats.totalRevenue > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{formatRp(stats.totalRevenue)}</p>
      </div>
      <div className="flex flex-col justify-between px-3 py-2 rounded-lg min-h-[52px] min-w-0" style={{ background: 'var(--surface-2)' }}>
        <p className={tileLabelCls} style={{ color: 'var(--text-muted)' }}>Selisih</p>
        <p className={tileValueCls} style={{ color: selisih > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>{formatRp(selisih)}</p>
      </div>
      <div className="flex flex-col justify-between px-3 py-2 rounded-lg min-h-[52px] min-w-0" style={{ background: 'var(--surface-2)' }}>
        <p className={tileLabelCls} style={{ color: 'var(--text-muted)' }}>% Terealisasi</p>
        <p className={tileValueCls} style={{ color: 'var(--text-primary)' }}>{pctLabel}</p>
      </div>
      <div className="flex flex-col justify-between px-3 py-2 rounded-lg min-h-[52px] min-w-0" style={{ background: 'var(--surface-2)' }}>
        <p className={tileLabelCls} style={{ color: 'var(--text-muted)' }}>Jual/Retur/Reject</p>
        <p className={tileValueCls} style={{ color: 'var(--text-primary)' }}>{stats.totalSold} / {stats.totalRetur} / {stats.totalReject}</p>
      </div>
    </div>
  );
}

export default function ConsignmentTab({ creds, products, highlightShipmentId, highlightRecapId, onHighlightHandled }: {
  creds: string; products: PosProduct[];
  highlightShipmentId?: string | null; highlightRecapId?: string | null; onHighlightHandled?: () => void;
}) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const wallets = useWallets(creds);
  const [walletBalances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

  const [subTab, setSubTab] = useState<SubTab>('lokasi');

  // ── Analitik Mitra (kirim/pendapatan/pelunasan lintas lokasi) — agregasi server-side ──
  const [analyticsPeriod, setAnalyticsPeriod] = useState<PeriodKey>('30d');
  const [analyticsCustomFrom, setAnalyticsCustomFrom] = useState('');
  const [analyticsCustomTo, setAnalyticsCustomTo] = useState('');
  const [analyticsData, setAnalyticsData] = useState<ConsignmentAnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const { from, to } = periodRange(analyticsPeriod, analyticsCustomFrom, analyticsCustomTo);
      const r = await fetch(`${API}/api/analytics/consignment?from=${from}&to=${to}`, { headers });
      if (r.ok) setAnalyticsData(await r.json() as ConsignmentAnalyticsData);
    } catch {}
    setAnalyticsLoading(false);
  };
  useEffect(() => {
    if (subTab !== 'analitik') return;
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, analyticsPeriod, analyticsCustomFrom, analyticsCustomTo]);

  // ── Riwayat audit per record (generic, dipakai di 3 list: lokasi/kirim/rekap) ──
  // Beda dengan `historyLocation` di bawah (riwayat bisnis kirim/rekap per lokasi, modal) —
  // ini adalah audit trail siapa membuat/mengubah/menghapus record itu sendiri (collapse inline).
  const [auditHistoryId, setAuditHistoryId] = useState<string | null>(null);
  const toggleAuditHistory = (id: string) => setAuditHistoryId(cur => cur === id ? null : id);

  // Datang dari klik "Lihat" di modal detail notifikasi (consignment_send / consignment_overdue/recap).
  const [highlightedShipmentId, setHighlightedShipmentId] = useState<string | null>(null);
  const [highlightedRecapId, setHighlightedRecapId] = useState<string | null>(null);
  const shipmentRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const recapRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Gudang (untuk tujuan retur/reject di Rekap Harian) ────────
  const [warehouses, setWarehouses] = useState<ConsignmentWarehouse[]>([]);
  const loadWarehouses = async () => {
    const r = await fetch(`${API}/api/warehouses`, { headers });
    if (r.ok) setWarehouses((await r.json() as { warehouses: ConsignmentWarehouse[] }).warehouses);
  };
  useEffect(() => { loadWarehouses(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Info toko (nota/rekap PDF) ──────────────────────────────────
  const [storeInfo, setStoreInfo] = useState<{ storeName?: string; storeTagline?: string; ownerName?: string; ownerSignature?: string; ownerStamp?: string; address?: string; city?: string; whatsapp?: string; logo?: string }>({});
  const [logoDataUri, setLogoDataUri] = useState<string | undefined>(undefined);
  const [signatureDataUri, setSignatureDataUri] = useState<string | undefined>(undefined);
  const [stampDataUri, setStampDataUri] = useState<string | undefined>(undefined);
  useEffect(() => {
    fetch(`${API}/api/settings`, { headers }).then(async r => {
      if (r.ok) setStoreInfo((await r.json() as { settings: typeof storeInfo }).settings ?? {});
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { toDataUri(storeInfo.logo).then(setLogoDataUri); }, [storeInfo.logo]);
  useEffect(() => { toDataUri(storeInfo.ownerSignature).then(setSignatureDataUri); }, [storeInfo.ownerSignature]);
  useEffect(() => { toDataUri(storeInfo.ownerStamp).then(setStampDataUri); }, [storeInfo.ownerStamp]);
  const storeHeader = {
    name:           storeInfo.storeName?.trim() || 'Cemilan Teh Risma',
    tagline:        storeInfo.storeTagline?.trim() || undefined,
    ownerName:      storeInfo.ownerName?.trim() || undefined,
    ownerSignature: signatureDataUri,
    ownerStamp:     stampDataUri,
    address:        [storeInfo.address, storeInfo.city].filter(Boolean).join(', ') || undefined,
    phone:          storeInfo.whatsapp?.trim() || undefined,
    logo:           logoDataUri,
  };

  // ── Riwayat per lokasi (modal) ─────────────────────────────────
  const [historyLocation,  setHistoryLocation]  = useState<ConsignmentLocation | null>(null);
  const [historyLoading,   setHistoryLoading]   = useState(false);
  const [historyShipments, setHistoryShipments] = useState<Shipment[]>([]);
  const [historyRecaps,    setHistoryRecaps]    = useState<Recap[]>([]);
  const [exportingHistoryExcel, setExportingHistoryExcel] = useState(false);
  const [exportingHistoryPdf,   setExportingHistoryPdf]   = useState(false);

  const openLocationHistory = async (l: ConsignmentLocation) => {
    setHistoryLocation(l);
    setHistoryLoading(true);
    try {
      const [sr, rr] = await Promise.all([
        fetch(`${API}/api/consignment/send?limit=500`, { headers }),
        fetch(`${API}/api/consignment/recap?limit=500`, { headers }),
      ]);
      const sData = sr.ok ? (await sr.json() as { shipments: Shipment[] }).shipments : [];
      const rData = rr.ok ? (await rr.json() as { recaps: Recap[] }).recaps : [];
      setHistoryShipments(sData.filter(s => s.locationId === l.id));
      setHistoryRecaps(rData.filter(r => r.locationId === l.id));
    } finally {
      setHistoryLoading(false);
    }
  };
  const closeLocationHistory = () => { setHistoryLocation(null); setHistoryShipments([]); setHistoryRecaps([]); };

  // ── Lokasi ───────────────────────────────────────────────────
  const [locations,        setLocations]        = useState<ConsignmentLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationStock,    setLocationStock]    = useState<Record<string, ConsignmentStockItem[]>>({});
  const [locationStats,    setLocationStats]    = useState<Record<string, LocationStats>>({});
  const [showLForm,   setShowLForm]   = useState(false);
  const [editingL,    setEditingL]    = useState<ConsignmentLocation | null>(null);
  const [lForm,       setLForm]       = useState<LocationForm>(EMPTY_LOCATION);
  const [savingL,     setSavingL]     = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [deletingLId, setDeletingLId] = useState<string | null>(null);
  const [locationView, setLocationView] = useViewMode('consignment-locations', 'card');

  const [locationSearch,   setLocationSearch]   = useState('');
  const [locationOnlyInStock, setLocationOnlyInStock] = useState(false);
  const [locationPeriod,     setLocationPeriod]     = useState<LocationPeriodKey>('month');
  const [locationCustomFrom, setLocationCustomFrom] = useState('');
  const [locationCustomTo,   setLocationCustomTo]   = useState('');
  const [locationPage,     setLocationPage]     = useState(1);
  const [locationPageSize, setLocationPageSize] = useState(10);
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [bulkDeletingLocations, setBulkDeletingLocations] = useState(false);
  const [exportingLocations, setExportingLocations] = useState(false);
  const [exportingLocationsPdf, setExportingLocationsPdf] = useState(false);
  const [importingLocations, setImportingLocations] = useState(false);
  const importLocationFileRef = useRef<HTMLInputElement>(null);

  const loadLocationStats = async (ls: ConsignmentLocation[]) => {
    const { from, to } = locationPeriodRange(locationPeriod, locationCustomFrom, locationCustomTo);
    const qs = `from=${from}&to=${to}`;
    const [sr, rr] = await Promise.all([
      fetch(`${API}/api/consignment/send?${qs}`, { headers }),
      fetch(`${API}/api/consignment/recap?${qs}`, { headers }),
    ]);
    const sendData  = sr.ok ? (await sr.json() as { shipments: Shipment[] }).shipments : [];
    const recapData = rr.ok ? (await rr.json() as { recaps: Recap[] }).recaps : [];
    const stats: Record<string, LocationStats> = {};
    for (const l of ls) stats[l.id] = { ...EMPTY_LOCATION_STATS };
    for (const s of sendData) {
      if (!s.locationId || !stats[s.locationId]) continue;
      stats[s.locationId].totalKirim += s.items.reduce((ss, it) => ss + it.subtotal, 0);
    }
    for (const rec of recapData) {
      if (!rec.locationId || !stats[rec.locationId]) continue;
      stats[rec.locationId].totalSold    += rec.totalSold;
      stats[rec.locationId].totalRetur   += rec.totalRetur;
      stats[rec.locationId].totalReject  += rec.totalReject || 0;
      stats[rec.locationId].totalRevenue += rec.totalRevenue;
    }
    setLocationStats(stats);
  };

  const loadLocations = async () => {
    setLocationsLoading(true);
    const r = await fetch(`${API}/api/consignment/locations`, { headers });
    if (r.ok) {
      const { locations: ls } = await r.json() as { locations: ConsignmentLocation[] };
      setLocations(ls);
      const stockEntries = await Promise.all(ls.map(async l => {
        const stockRes = await fetch(`${API}/api/consignment/locations/${l.id}/stock`, { headers });
        const stock = stockRes.ok ? (await stockRes.json() as { stock: ConsignmentStockItem[] }).stock : [];
        return [l.id, stock] as const;
      }));
      setLocationStock(Object.fromEntries(stockEntries));
      await loadLocationStats(ls);
    }
    setLocationsLoading(false);
  };
  useEffect(() => { loadLocations(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (locations.length > 0) loadLocationStats(locations); }, [locationPeriod, locationCustomFrom, locationCustomTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateL = () => { setEditingL(null); setLForm({ ...EMPTY_LOCATION, code: nextLocationCode(locations) }); setShowLForm(true); };
  const openEditL = (l: ConsignmentLocation) => {
    setEditingL(l); setLForm({ name: l.name, contactName: l.contactName, contactPhone: l.contactPhone, address: l.address, note: l.note, code: l.code ?? '', logoUrl: l.logoUrl ?? '' }); setShowLForm(true);
  };
  const uploadLocationLogo = async (file?: File) => {
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
      setLForm(f => ({ ...f, logoUrl: url }));
    } catch {
      toast.error('Gagal mengunggah logo mitra.');
    } finally {
      setLogoUploading(false);
    }
  };
  const saveLocation = async () => {
    if (!lForm.name.trim()) return;
    setSavingL(true);
    const r = editingL
      ? await fetch(`${API}/api/consignment/locations/${editingL.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(lForm) })
      : await fetch(`${API}/api/consignment/locations`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(lForm) });
    if (r.ok) { await loadLocations(); setShowLForm(false); toast.success(editingL ? 'Lokasi berhasil diperbarui.' : 'Lokasi berhasil ditambahkan.'); }
    else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menyimpan lokasi.');
    }
    setSavingL(false);
  };
  const deleteLocation = async (l: ConsignmentLocation) => {
    if (!await confirm({ message: `Hapus lokasi "${l.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingLId(l.id);
    const r = await fetch(`${API}/api/consignment/locations/${l.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setLocations(prev => prev.filter(x => x.id !== l.id));
      setSelectedLocations(s => { const n = new Set(s); n.delete(l.id); return n; });
      toast.success(`"${l.name}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus lokasi.');
    }
    setDeletingLId(null);
  };

  const locationStockTotals = (id: string) => {
    const stock = locationStock[id] ?? [];
    return {
      qty:   stock.reduce((s, it) => s + it.stockQty, 0),
      value: stock.reduce((s, it) => s + it.stockQty * it.hargaTitip, 0),
    };
  };

  const locationStatsFor = (id: string): LocationStats => locationStats[id] ?? EMPTY_LOCATION_STATS;

  const bulkDeleteLocations = async () => {
    if (selectedLocations.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedLocations.size} lokasi yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeletingLocations(true);
    const count = selectedLocations.size;
    const ids = [...selectedLocations];
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/consignment/locations/${id}`, { method: 'DELETE', headers })));
    const okIds = ids.filter((_, i) => results[i].ok);
    setLocations(prev => prev.filter(l => !okIds.includes(l.id)));
    setSelectedLocations(new Set());
    if (okIds.length === count) toast.success(`${count} lokasi berhasil dihapus.`);
    else toast.error(`Hanya ${okIds.length} dari ${count} lokasi berhasil dihapus.`);
    setBulkDeletingLocations(false);
  };

  const toggleSelectLocation = (id: string) =>
    setSelectedLocations(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportLocationsExcel = async (rows: ConsignmentLocation[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada lokasi untuk diexport.'); return; }
    setExportingLocations(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Lokasi Konsinyasi');

      const COLS = [
        { header: 'No',               key: 'no',          width: 6  },
        { header: 'Nama Lokasi',      key: 'name',        width: 24 },
        { header: 'Nama Kontak',      key: 'contactName', width: 20 },
        { header: 'Telepon',         key: 'contactPhone', width: 18 },
        { header: 'Alamat',           key: 'address',     width: 32 },
        { header: 'Stok Titip (pcs)', key: 'stockQty',    width: 16 },
        { header: 'Nilai Stok Titip', key: 'stockValue',  width: 18 },
        { header: 'Catatan',          key: 'note',        width: 28 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LOKASI KONSINYASI — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} lokasi (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((l, i) => {
        const totals = locationStockTotals(l.id);
        const row = ws.addRow({
          no: i + 1,
          name: l.name,
          contactName: l.contactName || '-',
          contactPhone: l.contactPhone || '-',
          address: l.address || '-',
          stockQty: totals.qty,
          stockValue: totals.value,
          note: l.note || '-',
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
        row.getCell('stockQty').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('address').alignment  = { horizontal: 'left', vertical: 'top', wrapText: true };
        row.getCell('stockValue').numFmt  = '#,##0';
      });

      const lastColLetter = ws.getColumn(colCount).letter;
      ws.autoFilter = { from: `A${HEADER_ROW_NUM}`, to: `${lastColLetter}${HEADER_ROW_NUM}` };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lokasi-konsinyasi-karyaputra-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} lokasi (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingLocations(false);
    }
  };

  const exportLocationsPDF = async (rows: ConsignmentLocation[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada lokasi untuk diexport.'); return; }
    setExportingLocationsPdf(true);
    try {
      const pdfRows = rows.map((l, i) => {
        const totals = locationStockTotals(l.id);
        return {
          no:          i + 1,
          name:        l.name,
          contactName: l.contactName || undefined,
          contactPhone:l.contactPhone || undefined,
          address:     l.address || undefined,
          stockQty:    totals.qty,
          stockValue:  totals.value,
          note:        l.note || undefined,
        };
      });

      const blob = await pdf(
        <LocationsListPDF
          store={storeHeader}
          data={{
            label,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            totalStock:  pdfRows.reduce((s, r) => s + r.stockQty, 0),
            totalValue:  pdfRows.reduce((s, r) => s + r.stockValue, 0),
            rows: pdfRows,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lokasi-konsinyasi-karyaputra-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} lokasi (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally {
      setExportingLocationsPdf(false);
    }
  };

  const downloadLocationTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Lokasi');
    const colCount = LOCATION_TEMPLATE_COLS.length;
    ws.columns = LOCATION_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT LOKASI KONSINYASI — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3.';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 30;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    LOCATION_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
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
    ws.getColumn('contactPhone').numFmt = '@';

    const exampleRow = ws.addRow({
      name: 'Warung Bu Yanti', contactName: 'Bu Yanti', contactPhone: '081234567890',
      address: 'Jl. Melati No. 3', note: '',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-lokasi-konsinyasi.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importLocationsFromExcel = async (file: File) => {
    setImportingLocations(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, LocationTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, LocationTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectLocationColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        if (map.has(1) || [...map.values()].includes('name')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Nama Lokasi" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: LocationForm[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw: Record<string, string> = Object.fromEntries(LOCATION_TEMPLATE_COLS.map(c => [c.key, '']));
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (!raw.name.trim()) return;
        rows.push({ name: raw.name, contactName: raw.contactName, contactPhone: raw.contactPhone, address: raw.address, note: raw.note, code: '', logoUrl: '' });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data lokasi valid pada file tersebut.');
        return;
      }

      let created = 0;
      for (const row of rows) {
        const r = await fetch(`${API}/api/consignment/locations`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(row),
        });
        if (r.ok) created++;
      }
      await loadLocations();
      const failed = rows.length - created;
      toast.success(`${created} lokasi berhasil diimpor.${failed > 0 ? ` ${failed} baris gagal.` : ''}`);
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImportingLocations(false);
    }
  };

  const filteredLocations = locations.filter(l => {
    if (locationOnlyInStock && locationStockTotals(l.id).qty <= 0) return false;
    if (!locationSearch) return true;
    const q = locationSearch.toLowerCase();
    return l.name.toLowerCase().includes(q)
      || l.contactName.toLowerCase().includes(q)
      || l.contactPhone.toLowerCase().includes(q)
      || l.address.toLowerCase().includes(q)
      || (l.code ?? '').toLowerCase().includes(q);
  });
  const totalLocationPages   = Math.max(1, Math.ceil(filteredLocations.length / locationPageSize));
  const safeLocationPage     = Math.min(locationPage, totalLocationPages);
  const paginatedLocations   = filteredLocations.slice((safeLocationPage - 1) * locationPageSize, safeLocationPage * locationPageSize);
  const goLocationPage       = (p: number) => setLocationPage(Math.max(1, Math.min(p, totalLocationPages)));
  const resetLocationPage    = () => setLocationPage(1);

  const togglePageAllLocations = () => {
    const pageIds     = paginatedLocations.map(l => l.id);
    const allSelected = pageIds.every(id => selectedLocations.has(id));
    setSelectedLocations(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  // ── Kirim Stok ───────────────────────────────────────────────
  const [showSendForm,   setShowSendForm]   = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [sendLocationId,  setSendLocationId]  = useState('');
  const [sendWarehouseId, setSendWarehouseId] = useState('');
  const [sendRows,       setSendRows]       = useState<SendRow[]>([{ ...EMPTY_SEND_ROW }]);
  const [sendNote,       setSendNote]       = useState('');
  const [sendDate,       setSendDate]       = useState(() => toLocalDateTimeInput(new Date()));
  const [sending,        setSending]        = useState(false);
  const [shipments,        setShipments]        = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(true);
  const [shipmentView, setShipmentView] = useViewMode('consignment-shipments', 'table');

  const [shipmentSearch,   setShipmentSearch]   = useState('');
  const [shipmentPeriod,     setShipmentPeriod]     = useState<PeriodKey>('month');
  const [shipmentCustomFrom, setShipmentCustomFrom] = useState('');
  const [shipmentCustomTo,   setShipmentCustomTo]   = useState('');
  const [shipmentPage,     setShipmentPage]     = useState(1);
  const [shipmentPageSize, setShipmentPageSize] = useState(10);
  const [selectedShipments, setSelectedShipments] = useState<Set<string>>(new Set());
  const [exportingShipments, setExportingShipments] = useState(false);
  const [deletingShipmentId, setDeletingShipmentId] = useState<string | null>(null);
  const [bulkDeletingShipments, setBulkDeletingShipments] = useState(false);
  const [printingShipmentId, setPrintingShipmentId] = useState<string | null>(null);
  const [printingShipmentsBulk, setPrintingShipmentsBulk] = useState(false);

  const loadShipments = async () => {
    setShipmentsLoading(true);
    const { from, to } = periodRange(shipmentPeriod, shipmentCustomFrom, shipmentCustomTo);
    const r = await fetch(`${API}/api/consignment/send?from=${from}&to=${to}`, { headers });
    if (r.ok) setShipments((await r.json() as { shipments: Shipment[] }).shipments);
    setShipmentsLoading(false);
  };
  useEffect(() => { loadShipments(); }, [shipmentPeriod, shipmentCustomFrom, shipmentCustomTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSendRow    = () => setSendRows(prev => [...prev, { ...EMPTY_SEND_ROW }]);
  const removeSendRow = (i: number) => setSendRows(prev => prev.filter((_, idx) => idx !== i));
  const updateSendRow = (i: number, patch: Partial<SendRow>) => setSendRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const [showSendScanner, setShowSendScanner] = useState(false);
  const handleSendScan = (text: string) => {
    const productId = resolveScannedProductId(text, products);
    if (!productId) { toast.error('Produk tidak dikenali dari QR ini.'); return { ok: false, label: 'Produk tidak dikenali' }; }
    const product = products.find(p => p.id === productId)!;
    setSendRows(prev => {
      const existingIdx = prev.findIndex(r => r.productId === productId);
      if (existingIdx >= 0) {
        const nextQty = (parseFloat(prev[existingIdx].qty) || 0) + 1;
        return prev.map((r, i) => i === existingIdx ? { ...r, qty: String(nextQty) } : r);
      }
      const emptyIdx = prev.findIndex(r => !r.productId);
      if (emptyIdx >= 0) return prev.map((r, i) => i === emptyIdx ? { ...r, productId, qty: '1' } : r);
      return [...prev, { productId, qty: '1', hargaTitip: '' }];
    });
    toast.success(`+1 ${product.name}`);
    return { ok: true, label: `+1 ${product.name}` };
  };

  const sendTotal = sendRows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.hargaTitip) || 0), 0);
  const sendTotalQty = sendRows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
  const canSubmitSend = !!sendLocationId && !!sendWarehouseId
    && sendRows.some(r => r.productId && (parseFloat(r.qty) || 0) > 0 && (parseFloat(r.hargaTitip) || 0) > 0);

  const openCreateSend = () => {
    setEditingShipment(null); setSendLocationId(''); setSendWarehouseId(''); setSendRows([{ ...EMPTY_SEND_ROW }]); setSendNote('');
    setSendDate(toLocalDateTimeInput(new Date()));
    setShowSendForm(true);
  };
  const openSendForLocation = (l: ConsignmentLocation) => {
    openCreateSend();
    setSendLocationId(l.id);
  };
  const openEditSend = (s: Shipment) => {
    setEditingShipment(s);
    setSendLocationId(s.locationId ?? '');
    setSendWarehouseId(s.warehouseId ?? '');
    // hargaTitip bisa desimal (rata-rata tertimbang saat server gabungkan baris produk duplikat
    // dalam satu Kirim) — NumberInput cuma untuk Rupiah bulat & buang titik desimal kalau tidak
    // dibulatkan dulu (sama seperti bug avgCost Bahan Baku).
    setSendRows(s.items.map(it => ({ productId: it.productId, qty: String(it.qty), hargaTitip: String(Math.round(it.hargaTitip)) })));
    setSendNote(s.note ?? '');
    setSendDate(s.createdAt?.seconds ? toLocalDateTimeInput(new Date(s.createdAt.seconds * 1000)) : toLocalDateTimeInput(new Date()));
    setShowSendForm(true);
  };

  const submitSend = async () => {
    if (!canSubmitSend) return;
    setSending(true);
    try {
      const location = locations.find(l => l.id === sendLocationId)!;
      const warehouse = warehouses.find(w => w.id === sendWarehouseId)!;
      const items = sendRows
        .filter(r => r.productId && (parseFloat(r.qty) || 0) > 0 && (parseFloat(r.hargaTitip) || 0) > 0)
        .map(r => {
          const p = products.find(pp => pp.id === r.productId)!;
          return { productId: p.id, productName: p.name, qty: parseFloat(r.qty) || 0, hargaTitip: parseFloat(r.hargaTitip) || 0 };
        });
      const body = JSON.stringify({
        locationId: location.id, locationName: location.name,
        warehouseId: warehouse.id, warehouseName: warehouse.name,
        items, note: sendNote, date: new Date(sendDate).toISOString(),
      });
      const res = editingShipment
        ? await fetch(`${API}/api/consignment/send/${editingShipment.id}`, {
            method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body,
          })
        : await fetch(`${API}/api/consignment/send`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body,
          });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal menyimpan pengiriman.'); return; }
      toast.success(editingShipment ? 'Riwayat kirim berhasil diperbarui.' : `Stok berhasil dikirim ke "${location.name}".`);
      setShowSendForm(false); setEditingShipment(null);
      setSendLocationId(''); setSendWarehouseId(''); setSendRows([{ ...EMPTY_SEND_ROW }]); setSendNote('');
      await Promise.all([loadShipments(), loadLocations()]);
    } finally { setSending(false); }
  };

  const exportShipmentsExcel = async (rows: Shipment[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada riwayat kirim untuk diexport.'); return; }
    setExportingShipments(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Riwayat Kirim');

      const COLS = [
        { header: 'No',        key: 'no',       width: 6  },
        { header: 'Lokasi',    key: 'location', width: 24 },
        { header: 'Tanggal',   key: 'date',     width: 20 },
        { header: 'Produk',    key: 'items',    width: 44 },
        { header: 'Total Nilai Titip', key: 'total', width: 18 },
        { header: 'Catatan',   key: 'note',     width: 26 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'RIWAYAT KIRIM STOK KONSINYASI — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} pengiriman (${label}) · Diexport ${todayLabel}`;
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
          no: i + 1,
          location: s.locationName,
          date: formatDate(s.createdAt?.seconds),
          items: s.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', '),
          total: s.items.reduce((sum, it) => sum + it.subtotal, 0),
          note: s.note || '-',
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
        row.getCell('no').alignment    = { horizontal: 'center', vertical: 'middle' };
        row.getCell('items').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        row.getCell('total').numFmt    = '#,##0';
      });

      const lastColLetter = ws.getColumn(colCount).letter;
      ws.autoFilter = { from: `A${HEADER_ROW_NUM}`, to: `${lastColLetter}${HEADER_ROW_NUM}` };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `riwayat-kirim-konsinyasi-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} riwayat kirim (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingShipments(false);
    }
  };

  const toggleSelectShipment = (id: string) =>
    setSelectedShipments(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const deleteShipment = async (s: Shipment) => {
    if (!await confirm({ message: `Hapus riwayat kirim ke "${s.locationName}"? Stok toko akan dikembalikan.`, danger: true })) return;
    setDeletingShipmentId(s.id);
    const r = await fetch(`${API}/api/consignment/send/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setShipments(prev => prev.filter(x => x.id !== s.id));
      setSelectedShipments(sel => { const n = new Set(sel); n.delete(s.id); return n; });
      toast.success('Riwayat kirim berhasil dihapus.');
      await loadLocations();
    } else {
      const data = await r.json().catch(() => ({} as { error?: string }));
      toast.error(data.error ?? 'Gagal menghapus riwayat kirim.');
    }
    setDeletingShipmentId(null);
  };

  const printShipmentNota = async (s: Shipment) => {
    setPrintingShipmentId(s.id);
    try {
      const location = locations.find(l => l.id === s.locationId);
      const total = s.items.reduce((sum, it) => sum + it.subtotal, 0);
      const blob = await pdf(
        <ShipmentNotePDF
          store={storeHeader}
          data={{
            locationName:   s.locationName,
            locationCode:   location?.code,
            contactName:    location?.contactName,
            contactPhone:   location?.contactPhone,
            address:        location?.address,
            warehouseName:  s.warehouseName,
            date:           formatDate(s.createdAt?.seconds),
            printedAt:      new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            docNo:          `KRM-${s.id.slice(-6).toUpperCase()}`,
            note:           s.note,
            items:          s.items,
            total,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nota-kirim-${s.locationName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${toISODate(new Date((s.createdAt?.seconds ?? Date.now() / 1000) * 1000))}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal membuat nota PDF.');
    }
    setPrintingShipmentId(null);
  };

  // Cetak nota kirim PDF untuk beberapa pengiriman sekaligus sesuai ceklis — satu file, satu
  // halaman per mitra. Pengiriman yang diceklis dikelompokkan per lokasi/mitra dulu: kalau
  // beberapa pengiriman ternyata ke mitra yang sama, qty & subtotalnya dijumlahkan jadi satu
  // halaman ringkasan (per produk); mitra yang berbeda tetap dapat halamannya masing-masing.
  // Sama persis dengan `printRecapsBulk` di tab Rekap.
  const printShipmentsBulk = async (rows: Shipment[]) => {
    if (rows.length === 0) { toast.error('Tidak ada pengiriman untuk dicetak.'); return; }
    setPrintingShipmentsBulk(true);
    try {
      const groups = groupAndMergeShipments(rows, locationId => {
        const location = locations.find(l => l.id === locationId);
        return location
          ? { code: location.code, contactName: location.contactName, contactPhone: location.contactPhone, address: location.address }
          : undefined;
      });

      const blob = await pdf(
        <Document>
          {groups.map((g, i) => <ShipmentNotePDFPage key={i} data={g.data} store={storeHeader} />)}
        </Document>
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nota-kirim-gabungan-${rows.length}-${toISODate(new Date())}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil cetak ${rows.length} pengiriman (${groups.length} mitra) ke satu PDF.`);
    } catch {
      toast.error('Gagal membuat nota PDF.');
    } finally {
      setPrintingShipmentsBulk(false);
    }
  };

  // Nota kirim dikirim via WA sebagai teks rincian + link PDF (server render on-demand di
  // /api/consignment/send/[id]/pdf) — link ini publik supaya mitra bisa buka tanpa login admin.
  const sendShipmentWhatsApp = (s: Shipment) => {
    const location = locations.find(l => l.id === s.locationId);
    const phone = location?.contactPhone?.trim();
    if (!phone) { toast.error(`Nomor WhatsApp untuk "${s.locationName}" belum diisi di data lokasi.`); return; }

    const total = s.items.reduce((sum, it) => sum + it.subtotal, 0);
    const pdfUrl = `${window.location.origin}/api/consignment/send/${s.id}/pdf`;
    const SEP = '─────────────────────';
    const itemLines = s.items
      .map((it, i) => `${i + 1}. ${it.productName}\n   ${it.qty} pcs x ${formatRp(it.hargaTitip)} = *${formatRp(it.subtotal)}*`)
      .join('\n');
    const message = `*${storeHeader.name.toUpperCase()}*
${storeHeader.address ? `${storeHeader.address}\n` : ''}${storeHeader.phone ? `${storeHeader.phone}\n` : ''}${SEP}

Halo *${location?.contactName || s.locationName}*!
Berikut nota kirim stok titip untuk *${s.locationName}*:

Tanggal : ${formatDate(s.createdAt?.seconds)}
${SEP}
${itemLines}
${SEP}
*Total Nilai Titip : ${formatRp(total)}*
${SEP}
${s.note ? `Catatan : ${s.note}\n${SEP}\n` : ''}Nota PDF:
${pdfUrl}

Terima kasih!
_${storeHeader.name}_`.trim();

    window.open(`https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const bulkDeleteShipments = async () => {
    if (selectedShipments.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedShipments.size} riwayat kirim yang dipilih? Stok toko akan dikembalikan.`, danger: true })) return;
    setBulkDeletingShipments(true);
    const count = selectedShipments.size;
    const ids = [...selectedShipments];
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/consignment/send/${id}`, { method: 'DELETE', headers })));
    const okIds = ids.filter((_, i) => results[i].ok);
    setShipments(prev => prev.filter(s => !okIds.includes(s.id)));
    setSelectedShipments(new Set());
    await loadLocations();
    if (okIds.length === count) toast.success(`${count} riwayat kirim berhasil dihapus.`);
    else toast.error(`Hanya ${okIds.length} dari ${count} riwayat kirim berhasil dihapus.`);
    setBulkDeletingShipments(false);
  };

  const filteredShipments = shipments.filter(s => {
    if (!shipmentSearch) return true;
    const q = shipmentSearch.toLowerCase();
    return s.locationName.toLowerCase().includes(q)
      || s.items.some(it => it.productName.toLowerCase().includes(q))
      || (s.note ?? '').toLowerCase().includes(q);
  });
  const totalShipmentPages = Math.max(1, Math.ceil(filteredShipments.length / shipmentPageSize));
  const safeShipmentPage   = Math.min(shipmentPage, totalShipmentPages);
  const paginatedShipments = filteredShipments.slice((safeShipmentPage - 1) * shipmentPageSize, safeShipmentPage * shipmentPageSize);
  const goShipmentPage     = (p: number) => setShipmentPage(Math.max(1, Math.min(p, totalShipmentPages)));
  const resetShipmentPage  = () => setShipmentPage(1);

  useEffect(() => {
    if (!highlightShipmentId || shipments.length === 0) return;
    const idx = shipments.findIndex(s => s.id === highlightShipmentId);
    if (idx === -1) { onHighlightHandled?.(); return; }
    setSubTab('kirim');
    setShipmentSearch('');
    setShipmentPage(Math.floor(idx / shipmentPageSize) + 1);
    setHighlightedShipmentId(highlightShipmentId);
    requestAnimationFrame(() => shipmentRowRefs.current[highlightShipmentId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    onHighlightHandled?.();
    const t = setTimeout(() => setHighlightedShipmentId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightShipmentId, shipments]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePageAllShipments = () => {
    const pageIds     = paginatedShipments.map(s => s.id);
    const allSelected = pageIds.every(id => selectedShipments.has(id));
    setSelectedShipments(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  // ── Rekap Harian ─────────────────────────────────────────────
  const [showRecapForm,  setShowRecapForm]  = useState(false);
  const [editingRecap,   setEditingRecap]   = useState<Recap | null>(null);
  const [recapLocationId,   setRecapLocationId]   = useState('');
  const [recapStock,        setRecapStock]        = useState<ConsignmentStockItem[]>([]);
  const [recapStockLoading, setRecapStockLoading] = useState(false);
  const [recapInputs,       setRecapInputs]       = useState<Record<string, { sold: string; retur: string; reject: string }>>({});
  const [showRecapScanner,  setShowRecapScanner]  = useState(false);
  const [recapScanMode,     setRecapScanMode]     = useState<'sold' | 'retur' | 'reject'>('sold');
  const recapScanModeLabel: Record<'sold' | 'retur' | 'reject', string> = { sold: 'Terjual', retur: 'Retur', reject: 'Reject' };
  const handleRecapScan = (text: string) => {
    const productId = resolveScannedProductId(text, products);
    const stockItem = productId ? recapStock.find(s => s.productId === productId) : undefined;
    if (!productId || !stockItem) {
      toast.error('Produk ini tidak ada di stok konsinyasi lokasi ini.');
      return { ok: false, label: 'Tidak ada di stok lokasi ini' };
    }
    setRecapInputs(prev => {
      const cur = prev[productId] ?? { sold: '', retur: '', reject: '' };
      const next = (parseFloat(cur[recapScanMode]) || 0) + 1;
      return { ...prev, [productId]: { ...cur, [recapScanMode]: String(next) } };
    });
    const label = `${recapScanModeLabel[recapScanMode]} +1 ${stockItem.productName}`;
    toast.success(label);
    return { ok: true, label };
  };
  const [recapNote,         setRecapNote]         = useState('');
  const [recapPaymentStatus, setRecapPaymentStatus] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [recapWalletId,     setRecapWalletId]     = useState('');
  const [recapWarehouseId,  setRecapWarehouseId]  = useState('');
  const [recapDate,         setRecapDate]         = useState(() => toLocalDateTimeInput(new Date()));
  const [submittingRecap,   setSubmittingRecap]   = useState(false);
  const [recaps,        setRecaps]        = useState<Recap[]>([]);
  const [recapsLoading, setRecapsLoading] = useState(true);
  const [markingRecapId, setMarkingRecapId] = useState<string | null>(null);
  const [markLunasRecap, setMarkLunasRecap] = useState<Recap | null>(null);
  const [markLunasRecapWalletId, setMarkLunasRecapWalletId] = useState('');
  const [showBulkMarkLunasRecaps, setShowBulkMarkLunasRecaps] = useState(false);
  const [bulkMarkLunasWalletId, setBulkMarkLunasWalletId] = useState('');
  const [bulkMarkingLunasRecaps, setBulkMarkingLunasRecaps] = useState(false);
  const [recapView, setRecapView] = useViewMode('consignment-recaps', 'table');

  const [recapSearch,   setRecapSearch]   = useState('');
  const [recapOnlyBelumLunas, setRecapOnlyBelumLunas] = useState(false);
  const [recapPeriod,     setRecapPeriod]     = useState<PeriodKey>('month');
  const [recapCustomFrom, setRecapCustomFrom] = useState('');
  const [recapCustomTo,   setRecapCustomTo]   = useState('');
  const [recapPage,     setRecapPage]     = useState(1);
  const [recapPageSize, setRecapPageSize] = useState(10);
  const [selectedRecaps, setSelectedRecaps] = useState<Set<string>>(new Set());
  const [exportingRecaps, setExportingRecaps] = useState(false);
  const [deletingRecapId, setDeletingRecapId] = useState<string | null>(null);
  const [bulkDeletingRecaps, setBulkDeletingRecaps] = useState(false);
  const [printingRecapId, setPrintingRecapId] = useState<string | null>(null);
  const [printingRecapsBulk, setPrintingRecapsBulk] = useState(false);

  const loadRecaps = async () => {
    setRecapsLoading(true);
    const { from, to } = periodRange(recapPeriod, recapCustomFrom, recapCustomTo);
    const r = await fetch(`${API}/api/consignment/recap?from=${from}&to=${to}`, { headers });
    if (r.ok) setRecaps((await r.json() as { recaps: Recap[] }).recaps);
    setRecapsLoading(false);
  };
  useEffect(() => { loadRecaps(); }, [recapPeriod, recapCustomFrom, recapCustomTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh — only the sub-tab currently in view (skips the pricier N+1 location/stock
  // fetch entirely while looking at Kirim/Rekap/Analitik). Each `loadX` already guards its
  // "loading" spinner with `&& list.length === 0`, so a background reload here doesn't
  // re-trigger the full-page placeholder once data has loaded once.
  const pollActiveSubTab = () => {
    if (subTab === 'lokasi') loadLocations();
    else if (subTab === 'kirim') loadShipments();
    else if (subTab === 'rekap') loadRecaps();
    else if (subTab === 'analitik') fetchAnalytics();
  };
  useVisiblePolling(pollActiveSubTab, CONSIGNMENT_POLL_MS, [subTab]);

  const loadRecapStock = async (locationId: string) => {
    setRecapStockLoading(true);
    setRecapInputs({});
    if (!locationId) { setRecapStock([]); setRecapStockLoading(false); return; }
    const r = await fetch(`${API}/api/consignment/locations/${locationId}/stock`, { headers });
    setRecapStock(r.ok ? (await r.json() as { stock: ConsignmentStockItem[] }).stock : []);
    setRecapStockLoading(false);
  };

  const recapRows = recapStock.map(item => {
    const input = recapInputs[item.productId] ?? { sold: '', retur: '', reject: '' };
    const sold   = parseFloat(input.sold)   || 0;
    const retur  = parseFloat(input.retur)  || 0;
    const reject = parseFloat(input.reject) || 0;
    const sisa   = item.stockQty - sold - retur - reject;
    return { item, sold, retur, reject, sisa, exceeds: sold + retur + reject > item.stockQty };
  });
  const recapTotalRevenue = recapRows.reduce((s, r) => s + r.sold * r.item.hargaTitip, 0);
  const recapTotalRetur   = recapRows.reduce((s, r) => s + r.retur, 0);
  const recapTotalReject  = recapRows.reduce((s, r) => s + r.reject, 0);
  const recapHasExceeds   = recapRows.some(r => r.exceeds);
  const recapNeedsWarehouse = recapTotalRetur + recapTotalReject > 0;
  const canSubmitRecap    = !!recapLocationId && recapRows.some(r => r.sold > 0 || r.retur > 0 || r.reject > 0)
    && !recapHasExceeds && (!recapNeedsWarehouse || !!recapWarehouseId)
    && (recapPaymentStatus === 'belum_lunas' || !!recapWalletId);

  const openCreateRecap = () => {
    setEditingRecap(null);
    setRecapLocationId(''); setRecapStock([]); setRecapInputs({});
    setRecapNote(''); setRecapPaymentStatus('lunas'); setRecapWalletId(''); setRecapWarehouseId('');
    setRecapDate(toLocalDateTimeInput(new Date()));
    setShowRecapForm(true);
  };
  const openRecapForLocation = (l: ConsignmentLocation) => {
    openCreateRecap();
    setRecapLocationId(l.id);
    loadRecapStock(l.id);
  };
  const openEditRecap = async (r: Recap) => {
    setEditingRecap(r);
    setRecapNote(r.note ?? '');
    setRecapPaymentStatus(r.paymentStatus ?? 'lunas');
    setRecapWalletId(r.walletId ?? '');
    setRecapWarehouseId(r.warehouseId ?? '');
    setRecapLocationId(r.locationId ?? '');
    setRecapDate(r.createdAt?.seconds ? toLocalDateTimeInput(new Date(r.createdAt.seconds * 1000)) : toLocalDateTimeInput(new Date()));
    await loadRecapStock(r.locationId ?? '');
    // Kembalikan qty rekap ini ke stok lokasi secara sementara di UI, supaya validasi
    // "sisa stok di lokasi" konsisten dengan reversal yang dilakukan backend saat disimpan.
    // Hanya item milik transaksi ini yang ditampilkan, bukan seluruh stok titip di lokasi.
    setRecapStock(prev => {
      const map = new Map(prev.map(it => [it.productId, { ...it }]));
      return r.items.map(it => {
        const restore = it.qtySold + it.qtyRetur + it.qtyReject;
        const existing = map.get(it.productId);
        return existing
          ? { ...existing, stockQty: existing.stockQty + restore }
          : { productId: it.productId, productName: it.productName, stockQty: restore, hargaTitip: it.hargaTitip };
      });
    });
    setRecapInputs(Object.fromEntries(r.items.map(it => [it.productId, {
      sold: it.qtySold ? String(it.qtySold) : '', retur: it.qtyRetur ? String(it.qtyRetur) : '', reject: it.qtyReject ? String(it.qtyReject) : '',
    }])));
    setShowRecapForm(true);
  };

  const submitRecap = async () => {
    if (!canSubmitRecap) return;
    setSubmittingRecap(true);
    try {
      const location = locations.find(l => l.id === recapLocationId)!;
      const warehouse = warehouses.find(w => w.id === recapWarehouseId);
      const items = recapRows
        .filter(r => r.sold > 0 || r.retur > 0 || r.reject > 0)
        .map(r => ({ productId: r.item.productId, productName: r.item.productName, qtySold: r.sold, qtyRetur: r.retur, qtyReject: r.reject }));
      const body = JSON.stringify({
        locationId: location.id, locationName: location.name, items, note: recapNote,
        paymentStatus: recapPaymentStatus,
        walletId: recapPaymentStatus === 'lunas' ? recapWalletId : null,
        warehouseId: recapNeedsWarehouse ? recapWarehouseId : undefined,
        warehouseName: recapNeedsWarehouse ? warehouse?.name : undefined,
        date: new Date(recapDate).toISOString(),
      });
      const res = editingRecap
        ? await fetch(`${API}/api/consignment/recap/${editingRecap.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body })
        : await fetch(`${API}/api/consignment/recap`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal menyimpan rekap.'); return; }
      toast.success(editingRecap ? 'Riwayat rekap berhasil diperbarui.' : `Rekap tersimpan — pendapatan ${formatRp(recapTotalRevenue)} dari "${location.name}".`);
      setShowRecapForm(false); setEditingRecap(null);
      setRecapNote(''); setRecapPaymentStatus('lunas'); setRecapWalletId(''); setRecapWarehouseId('');
      setRecapDate(toLocalDateTimeInput(new Date()));
      await Promise.all([loadRecaps(), loadLocations()]);
      refetchBalances();
    } finally { setSubmittingRecap(false); }
  };

  const markRecapLunas = async (id: string, walletId: string) => {
    setMarkingRecapId(id);
    const r = await fetch(`${API}/api/consignment/recap/${id}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletId }),
    });
    if (r.ok) { toast.success('Rekap ditandai lunas.'); await loadRecaps(); refetchBalances(); }
    else toast.error('Gagal menandai lunas.');
    setMarkingRecapId(null);
  };
  const confirmMarkRecapLunas = async () => {
    if (!markLunasRecap || !markLunasRecapWalletId) return;
    await markRecapLunas(markLunasRecap.id, markLunasRecapWalletId);
    setMarkLunasRecap(null);
    setMarkLunasRecapWalletId('');
  };

  const exportRecapsExcel = async (rows: Recap[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada riwayat rekap untuk diexport.'); return; }
    setExportingRecaps(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Riwayat Rekap');

      const COLS = [
        { header: 'No',              key: 'no',       width: 6  },
        { header: 'Lokasi',          key: 'location', width: 24 },
        { header: 'Tanggal',         key: 'date',     width: 20 },
        { header: 'Produk',          key: 'items',    width: 44 },
        { header: 'Total Terjual',   key: 'sold',     width: 14 },
        { header: 'Total Retur',     key: 'retur',    width: 14 },
        { header: 'Total Reject',    key: 'reject',   width: 14 },
        { header: 'Gudang Tujuan',   key: 'warehouse', width: 20 },
        { header: 'Total Pendapatan', key: 'revenue', width: 18 },
        { header: 'Status Bayar',    key: 'status',   width: 14 },
        { header: 'Catatan',         key: 'note',     width: 26 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'RIWAYAT REKAP HARIAN KONSINYASI — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      subCell.value = `${rows.length} rekap (${label}) · Diexport ${todayLabel}`;
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

      rows.forEach((r, i) => {
        const row = ws.addRow({
          no: i + 1,
          location: r.locationName,
          date: formatDate(r.createdAt?.seconds),
          items: r.items.map(it => `${it.productName} (jual ${it.qtySold}${it.qtyRetur > 0 ? `, retur ${it.qtyRetur}` : ''}${it.qtyReject > 0 ? `, reject ${it.qtyReject}` : ''})`).join(', '),
          sold: r.totalSold,
          retur: r.totalRetur,
          reject: r.totalReject || 0,
          warehouse: r.warehouseName || '-',
          revenue: r.totalRevenue,
          status: r.paymentStatus === 'belum_lunas' ? 'Belum Lunas' : 'Lunas',
          note: r.note || '-',
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
        row.getCell('no').alignment      = { horizontal: 'center', vertical: 'middle' };
        row.getCell('sold').alignment    = { horizontal: 'center', vertical: 'middle' };
        row.getCell('retur').alignment   = { horizontal: 'center', vertical: 'middle' };
        row.getCell('reject').alignment  = { horizontal: 'center', vertical: 'middle' };
        row.getCell('items').alignment   = { horizontal: 'left', vertical: 'top', wrapText: true };
        row.getCell('revenue').numFmt    = '#,##0';
        const statusCell = row.getCell('status');
        statusCell.font = { bold: true, color: { argb: r.paymentStatus === 'belum_lunas' ? 'FFDC2626' : 'FF16A34A' } };
        statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const lastColLetter = ws.getColumn(colCount).letter;
      ws.autoFilter = { from: `A${HEADER_ROW_NUM}`, to: `${lastColLetter}${HEADER_ROW_NUM}` };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `riwayat-rekap-konsinyasi-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} riwayat rekap (${label}) ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingRecaps(false);
    }
  };

  const toggleSelectRecap = (id: string) =>
    setSelectedRecaps(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const deleteRecap = async (r: Recap) => {
    if (!await confirm({ message: `Hapus riwayat rekap "${r.locationName}"? Stok titip di lokasi akan dikembalikan.`, danger: true })) return;
    setDeletingRecapId(r.id);
    const res = await fetch(`${API}/api/consignment/recap/${r.id}`, { method: 'DELETE', headers });
    if (res.ok) {
      setRecaps(prev => prev.filter(x => x.id !== r.id));
      setSelectedRecaps(sel => { const n = new Set(sel); n.delete(r.id); return n; });
      toast.success('Riwayat rekap berhasil dihapus.');
      await loadLocations();
      refetchBalances();
    } else {
      const data = await res.json().catch(() => ({} as { error?: string }));
      toast.error(data.error ?? 'Gagal menghapus riwayat rekap.');
    }
    setDeletingRecapId(null);
  };

  const printRecapNota = async (r: Recap) => {
    setPrintingRecapId(r.id);
    try {
      const location = locations.find(l => l.id === r.locationId);
      const blob = await pdf(
        <RecapNotePDF
          store={storeHeader}
          data={{
            locationName:   r.locationName,
            locationCode:   location?.code,
            warehouseName:  r.warehouseName,
            date:           formatDate(r.createdAt?.seconds),
            printedAt:      new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            docNo:          `RKP-${r.id.slice(-6).toUpperCase()}`,
            paymentStatus:  r.paymentStatus,
            note:           r.note,
            items:          r.items,
            totalSold:      r.totalSold,
            totalRetur:     r.totalRetur,
            totalReject:    r.totalReject,
            totalRevenue:   r.totalRevenue,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rekap-harian-${r.locationName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${toISODate(new Date((r.createdAt?.seconds ?? Date.now() / 1000) * 1000))}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal membuat rekap PDF.');
    }
    setPrintingRecapId(null);
  };

  // Cetak rekap PDF untuk beberapa rekap sekaligus — satu file, satu halaman per mitra.
  // Rekap-rekap yang diceklis dikelompokkan per lokasi/mitra dulu: kalau beberapa rekap
  // ternyata dari mitra yang sama, qty & pendapatannya dijumlahkan jadi satu halaman
  // ringkasan (per produk); mitra yang berbeda tetap dapat halamannya masing-masing.
  const printRecapsBulk = async (rows: Recap[]) => {
    if (rows.length === 0) { toast.error('Tidak ada rekap untuk dicetak.'); return; }
    setPrintingRecapsBulk(true);
    try {
      const groups = groupAndMergeRecaps(rows, locationId => locations.find(l => l.id === locationId)?.code);

      const blob = await pdf(
        <Document>
          {groups.map((g, i) => <RecapNotePDFPage key={i} data={g.data} store={storeHeader} />)}
        </Document>
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rekap-harian-gabungan-${rows.length}-${toISODate(new Date())}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil cetak ${rows.length} rekap (${groups.length} mitra) ke satu PDF.`);
    } catch {
      toast.error('Gagal membuat rekap PDF.');
    } finally {
      setPrintingRecapsBulk(false);
    }
  };

  // Kirim reminder WA untuk rekap yang belum lunas — link nota-nya mengarah ke route publik
  // yang merender PDF gabungan on-the-fly dari `ids` (grup mitra yang sama otomatis jadi 1
  // ringkasan, sama seperti export PDF gabungan di atas), jadi mitra buka satu link untuk
  // seluruh rekap yang belum ia lunasi.
  const openRecapWhatsApp = (group: ReturnType<typeof groupAndMergeRecaps>[number], phone: string, contactName?: string) => {
    const { data } = group;
    const pdfUrl = `${window.location.origin}/api/consignment/recap/pdf?ids=${group.recapIds.join(',')}`;
    const SEP = '─────────────────────';
    const itemLines = data.items
      .map((it, i) => `${i + 1}. ${it.productName}\n   jual ${it.qtySold}${it.qtyRetur ? `, retur ${it.qtyRetur}` : ''}${it.qtyReject ? `, reject ${it.qtyReject}` : ''} · ${formatRp(it.revenue)}`)
      .join('\n');
    const message = `*${storeHeader.name.toUpperCase()}*
${storeHeader.address ? `${storeHeader.address}\n` : ''}${storeHeader.phone ? `${storeHeader.phone}\n` : ''}${SEP}

Halo *${contactName || data.locationName}*!
Reminder tagihan konsinyasi *${data.locationName}* yang belum lunas:

Periode : ${data.date}
${SEP}
${itemLines}
${SEP}
*Total Tagihan : ${formatRp(data.totalRevenue)}*
${SEP}
Nota Rekap PDF:
${pdfUrl}

Mohon konfirmasi pembayarannya ya. Terima kasih!
_${storeHeader.name}_`.trim();

    window.open(`https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const sendRecapWhatsApp = (r: Recap) => {
    const location = locations.find(l => l.id === r.locationId);
    const phone = location?.contactPhone?.trim();
    if (!phone) { toast.error(`Nomor WhatsApp untuk "${r.locationName}" belum diisi di data lokasi.`); return; }
    const [group] = groupAndMergeRecaps([r], () => location?.code);
    openRecapWhatsApp(group, phone, location?.contactName);
  };

  const sendRecapsWhatsAppBulk = (rows: Recap[]) => {
    const unpaid = rows.filter(r => (r.paymentStatus ?? 'lunas') === 'belum_lunas');
    if (unpaid.length === 0) { toast.error('Tidak ada rekap belum lunas yang dipilih.'); return; }

    const groups = groupAndMergeRecaps(unpaid, locationId => locations.find(l => l.id === locationId)?.code);
    const skipped: string[] = [];
    let sent = 0;
    groups.forEach(g => {
      const location = locations.find(l => l.id === g.locationId);
      const phone = location?.contactPhone?.trim();
      if (!phone) { skipped.push(g.data.locationName); return; }
      openRecapWhatsApp(g, phone, location?.contactName);
      sent++;
    });

    if (sent > 0) {
      toast.success(`Membuka WhatsApp untuk ${sent} mitra${skipped.length > 0 ? ` (${skipped.length} dilewati, nomor WA belum diisi)` : ''}.`);
    } else {
      toast.error(`Nomor WhatsApp belum diisi untuk: ${skipped.join(', ')}`);
    }
  };

  const bulkDeleteRecaps = async () => {
    if (selectedRecaps.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedRecaps.size} riwayat rekap yang dipilih? Stok titip di lokasi akan dikembalikan.`, danger: true })) return;
    setBulkDeletingRecaps(true);
    const count = selectedRecaps.size;
    const ids = [...selectedRecaps];
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/consignment/recap/${id}`, { method: 'DELETE', headers })));
    const okIds = ids.filter((_, i) => results[i].ok);
    setRecaps(prev => prev.filter(r => !okIds.includes(r.id)));
    setSelectedRecaps(new Set());
    await loadLocations();
    if (okIds.length === count) toast.success(`${count} riwayat rekap berhasil dihapus.`);
    else toast.error(`Hanya ${okIds.length} dari ${count} riwayat rekap berhasil dihapus.`);
    setBulkDeletingRecaps(false);
  };

  const belumLunasSelectedRecaps = recaps.filter(r => selectedRecaps.has(r.id) && r.paymentStatus === 'belum_lunas');

  const confirmBulkMarkRecapsLunas = async () => {
    if (!bulkMarkLunasWalletId || belumLunasSelectedRecaps.length === 0) return;
    setBulkMarkingLunasRecaps(true);
    const ids = belumLunasSelectedRecaps.map(r => r.id);
    const results = await Promise.all(ids.map(id => fetch(`${API}/api/consignment/recap/${id}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletId: bulkMarkLunasWalletId }),
    })));
    const okCount = results.filter(r => r.ok).length;
    await loadRecaps();
    refetchBalances();
    setSelectedRecaps(new Set());
    setShowBulkMarkLunasRecaps(false);
    setBulkMarkLunasWalletId('');
    if (okCount === ids.length) toast.success(`${okCount} rekap ditandai lunas.`);
    else toast.error(`Hanya ${okCount} dari ${ids.length} rekap berhasil ditandai lunas.`);
    setBulkMarkingLunasRecaps(false);
  };

  const filteredRecaps = recaps.filter(r => {
    if (recapOnlyBelumLunas && r.paymentStatus !== 'belum_lunas') return false;
    if (!recapSearch) return true;
    const q = recapSearch.toLowerCase();
    return r.locationName.toLowerCase().includes(q)
      || r.items.some(it => it.productName.toLowerCase().includes(q))
      || (r.note ?? '').toLowerCase().includes(q);
  });
  const totalRecapPages = Math.max(1, Math.ceil(filteredRecaps.length / recapPageSize));
  const safeRecapPage   = Math.min(recapPage, totalRecapPages);
  const paginatedRecaps = filteredRecaps.slice((safeRecapPage - 1) * recapPageSize, safeRecapPage * recapPageSize);
  const goRecapPage     = (p: number) => setRecapPage(Math.max(1, Math.min(p, totalRecapPages)));
  const resetRecapPage  = () => setRecapPage(1);

  useEffect(() => {
    if (!highlightRecapId || recaps.length === 0) return;
    const idx = recaps.findIndex(r => r.id === highlightRecapId);
    if (idx === -1) { onHighlightHandled?.(); return; }
    setSubTab('rekap');
    setRecapSearch('');
    setRecapPage(Math.floor(idx / recapPageSize) + 1);
    setHighlightedRecapId(highlightRecapId);
    requestAnimationFrame(() => recapRowRefs.current[highlightRecapId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    onHighlightHandled?.();
    const t = setTimeout(() => setHighlightedRecapId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightRecapId, recaps]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePageAllRecaps = () => {
    const pageIds     = paginatedRecaps.map(r => r.id);
    const allSelected = pageIds.every(id => selectedRecaps.has(id));
    setSelectedRecaps(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const locationOptions = locations.map(l => ({ value: l.id, label: l.name }));
  const productOptions  = products.map(p => ({ value: p.id, label: p.name, imageUrl: p.imageUrls?.[0], emoji: p.emoji }));
  const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };

  // ── Riwayat per lokasi (data turunan untuk modal) ─────────────
  type HistoryEntry =
    | { kind: 'kirim'; seconds: number; shipment: Shipment }
    | { kind: 'rekap'; seconds: number; recap: Recap };
  const historyTimeline: HistoryEntry[] = [
    ...historyShipments.map(s => ({ kind: 'kirim' as const, seconds: s.createdAt?.seconds ?? 0, shipment: s })),
    ...historyRecaps.map(r => ({ kind: 'rekap' as const, seconds: r.createdAt?.seconds ?? 0, recap: r })),
  ].sort((a, b) => b.seconds - a.seconds);
  const historyTotalKirim   = historyShipments.reduce((s, sh) => s + sh.items.reduce((ss, it) => ss + it.subtotal, 0), 0);
  const historyTotalSold    = historyRecaps.reduce((s, r) => s + r.totalSold, 0);
  const historyTotalRetur   = historyRecaps.reduce((s, r) => s + r.totalRetur, 0);
  const historyTotalReject  = historyRecaps.reduce((s, r) => s + (r.totalReject || 0), 0);
  const historyTotalRevenue = historyRecaps.reduce((s, r) => s + r.totalRevenue, 0);
  const historyBelumLunas   = historyRecaps.filter(r => r.paymentStatus === 'belum_lunas').length;

  // Excel riwayat lokasi — 2 sheet (Kirim & Rekap) dalam satu file, sama gaya dengan
  // exportShipmentsExcel/exportRecapsExcel tapi diringkas ke satu lokasi saja.
  const exportHistoryExcel = async () => {
    if (!historyLocation) return;
    if (historyShipments.length === 0 && historyRecaps.length === 0) { toast.error('Tidak ada riwayat untuk diexport.'); return; }
    setExportingHistoryExcel(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

      const buildSheet = (
        name: string, title: string, subtitle: string,
        cols: { header: string; key: string; width: number }[],
        addRows: (ws: ExcelJS.Worksheet) => void,
      ) => {
        const ws = wb.addWorksheet(name);
        const colCount = cols.length;
        ws.columns = cols.map(c => ({ key: c.key, width: c.width }));

        ws.mergeCells(1, 1, 1, colCount);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = title;
        titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
        ws.getRow(1).height = 26;

        ws.mergeCells(2, 1, 2, colCount);
        const subCell = ws.getCell(2, 1);
        subCell.value = subtitle;
        subCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
        subCell.alignment = { horizontal: 'center', vertical: 'middle' };
        subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
        ws.getRow(2).height = 20;

        const HEADER_ROW_NUM = 3;
        const headerRow = ws.getRow(HEADER_ROW_NUM);
        cols.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
        headerRow.height = 22;
        headerRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFC96018' } }, bottom: { style: 'thin', color: { argb: 'FFC96018' } },
            left: { style: 'thin', color: { argb: 'FFC96018' } }, right: { style: 'thin', color: { argb: 'FFC96018' } },
          };
        });
        ws.views = [{ state: 'frozen', ySplit: HEADER_ROW_NUM }];

        addRows(ws);

        const lastColLetter = ws.getColumn(colCount).letter;
        ws.autoFilter = { from: `A${HEADER_ROW_NUM}`, to: `${lastColLetter}${HEADER_ROW_NUM}` };
      };

      buildSheet(
        'Kirim', `RIWAYAT KIRIM — ${historyLocation.name.toUpperCase()}`,
        `${historyShipments.length} pengiriman · Diexport ${todayLabel}`,
        [
          { header: 'No', key: 'no', width: 6 },
          { header: 'Tanggal', key: 'date', width: 20 },
          { header: 'Produk', key: 'items', width: 46 },
          { header: 'Total Nilai Titip', key: 'total', width: 18 },
          { header: 'Catatan', key: 'note', width: 28 },
        ],
        ws => {
          historyShipments.forEach((sh, i) => {
            const row = ws.addRow({
              no: i + 1,
              date: formatDate(sh.createdAt?.seconds),
              items: sh.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', '),
              total: sh.items.reduce((sum, it) => sum + it.subtotal, 0),
              note: sh.note || '-',
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
            row.getCell('no').alignment    = { horizontal: 'center', vertical: 'middle' };
            row.getCell('items').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
            row.getCell('total').numFmt    = '#,##0';
          });
        },
      );

      buildSheet(
        'Rekap', `RIWAYAT REKAP — ${historyLocation.name.toUpperCase()}`,
        `${historyRecaps.length} rekap · Diexport ${todayLabel}`,
        [
          { header: 'No', key: 'no', width: 6 },
          { header: 'Tanggal', key: 'date', width: 20 },
          { header: 'Produk', key: 'items', width: 46 },
          { header: 'Terjual', key: 'sold', width: 12 },
          { header: 'Retur', key: 'retur', width: 12 },
          { header: 'Reject', key: 'reject', width: 12 },
          { header: 'Gudang Tujuan', key: 'warehouse', width: 20 },
          { header: 'Pendapatan', key: 'revenue', width: 16 },
          { header: 'Status Bayar', key: 'status', width: 14 },
          { header: 'Catatan', key: 'note', width: 26 },
        ],
        ws => {
          historyRecaps.forEach((r, i) => {
            const row = ws.addRow({
              no: i + 1,
              date: formatDate(r.createdAt?.seconds),
              items: r.items.map(it => `${it.productName} (jual ${it.qtySold}${it.qtyRetur > 0 ? `, retur ${it.qtyRetur}` : ''}${it.qtyReject > 0 ? `, reject ${it.qtyReject}` : ''})`).join(', '),
              sold: r.totalSold,
              retur: r.totalRetur,
              reject: r.totalReject || 0,
              warehouse: r.warehouseName || '-',
              revenue: r.totalRevenue,
              status: r.paymentStatus === 'belum_lunas' ? 'Belum Lunas' : 'Lunas',
              note: r.note || '-',
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
            row.getCell('no').alignment      = { horizontal: 'center', vertical: 'middle' };
            row.getCell('sold').alignment    = { horizontal: 'center', vertical: 'middle' };
            row.getCell('retur').alignment   = { horizontal: 'center', vertical: 'middle' };
            row.getCell('reject').alignment  = { horizontal: 'center', vertical: 'middle' };
            row.getCell('items').alignment   = { horizontal: 'left', vertical: 'top', wrapText: true };
            row.getCell('revenue').numFmt    = '#,##0';
            const statusCell = row.getCell('status');
            statusCell.font = { bold: true, color: { argb: r.paymentStatus === 'belum_lunas' ? 'FFDC2626' : 'FF16A34A' } };
            statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
          });
        },
      );

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const safeName = historyLocation.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const a = document.createElement('a');
      a.href = url;
      a.download = `riwayat-konsinyasi-${safeName}-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Riwayat "${historyLocation.name}" berhasil diexport ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExportingHistoryExcel(false);
    }
  };

  // PDF riwayat lokasi — satu dokumen berisi ringkasan + linimasa lengkap (kirim & rekap).
  const exportHistoryPdf = async () => {
    if (!historyLocation) return;
    if (historyTimeline.length === 0) { toast.error('Tidak ada riwayat untuk diexport.'); return; }
    setExportingHistoryPdf(true);
    try {
      const entries = historyTimeline.map(entry => entry.kind === 'kirim'
        ? {
            kind: 'kirim' as const,
            date: formatDate(entry.shipment.createdAt?.seconds),
            description: entry.shipment.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', '),
            amount: entry.shipment.items.reduce((s, it) => s + it.subtotal, 0),
          }
        : {
            kind: 'rekap' as const,
            date: formatDate(entry.recap.createdAt?.seconds),
            description: entry.recap.items.map(it => `${it.productName} (jual ${it.qtySold}${it.qtyRetur > 0 ? `, retur ${it.qtyRetur}` : ''}${it.qtyReject > 0 ? `, reject ${it.qtyReject}` : ''})`).join(', '),
            amount: entry.recap.totalRevenue,
            status: entry.recap.paymentStatus === 'belum_lunas' ? 'BELUM LUNAS' : undefined,
          });

      const blob = await pdf(
        <LocationHistoryPDF
          store={storeHeader}
          data={{
            locationName:    historyLocation.name,
            contactName:     historyLocation.contactName || undefined,
            contactPhone:    historyLocation.contactPhone || undefined,
            address:         historyLocation.address || undefined,
            generatedAt:     new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            currentStockQty: locationStockTotals(historyLocation.id).qty,
            totalKirim:      historyTotalKirim,
            totalRevenue:    historyTotalRevenue,
            totalSold:       historyTotalSold,
            totalRetur:      historyTotalRetur,
            totalReject:     historyTotalReject,
            entries,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const safeName = historyLocation.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const a = document.createElement('a');
      a.href = url;
      a.download = `riwayat-konsinyasi-${safeName}-${toISODate(new Date())}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal membuat PDF riwayat.');
    } finally {
      setExportingHistoryPdf(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={() => { loadLocations(); loadShipments(); loadRecaps(); if (subTab === 'analitik') fetchAnalytics(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={locationsLoading || shipmentsLoading || recapsLoading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="inline-flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all"
              style={subTab === t.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
              <t.Icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {/* ════ LOKASI ═════════════════════════════════════════ */}
        {subTab === 'lokasi' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-4">
            {locations.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {LOCATION_PERIOD_OPTIONS.map(p => (
                  <button key={p.id} onClick={() => setLocationPeriod(p.id)}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
                    style={locationPeriod === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    {p.label}
                  </button>
                ))}
                {locationPeriod === 'custom' && (
                  <div className="flex items-center gap-2">
                    <input type="date" value={locationCustomFrom} onChange={e => setLocationCustomFrom(e.target.value)} className="input" style={{ height: 36 }} />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
                    <input type="date" value={locationCustomTo} onChange={e => setLocationCustomTo(e.target.value)} className="input" style={{ height: 36 }} />
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              {locations.length > 0 && (
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={locationSearch}
                    onChange={e => { setLocationSearch(e.target.value); resetLocationPage(); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari nama lokasi, kontak, telepon, atau alamat…"
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap w-full sm:w-auto">
              {locations.length > 0 && (
                <button
                  onClick={() => { setLocationOnlyInStock(v => !v); resetLocationPage(); }}
                  className="px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0"
                  style={{
                    height: HEADER_BTN_H,
                    background: locationOnlyInStock ? 'linear-gradient(135deg,#E8821A,#C96018)' : 'var(--surface-2)',
                    color: locationOnlyInStock ? 'white' : 'var(--text-muted)',
                  }}
                >
                  <PackageCheck size={14} /> <span className="hidden sm:inline">Ada Stok</span>
                </button>
              )}
              <div className="flex items-center gap-2 justify-end flex-shrink-0">
                <Tooltip label="Unduh Template">
                  <button onClick={downloadLocationTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                    <ExcelIcon size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={importingLocations ? 'Mengimpor…' : 'Upload Excel'}>
                  <button onClick={() => importLocationFileRef.current?.click()} disabled={importingLocations} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                    {importingLocations ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  </button>
                </Tooltip>
                <input ref={importLocationFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) importLocationsFromExcel(f); e.target.value = ''; }} />
                {locations.length > 0 && (
                  <Tooltip label="Export Excel">
                    <button onClick={() => exportLocationsExcel(filteredLocations, 'sesuai filter')} disabled={exportingLocations} aria-label="Export Excel"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingLocations ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                    </button>
                  </Tooltip>
                )}
                {locations.length > 0 && (
                  <Tooltip label="Export PDF">
                    <button onClick={() => exportLocationsPDF(filteredLocations, 'sesuai filter')} disabled={exportingLocationsPdf} aria-label="Export PDF"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingLocationsPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                    </button>
                  </Tooltip>
                )}
                {locations.length > 0 && <ViewToggle mode={locationView} onChange={setLocationView} height={HEADER_BTN_H} />}
                <button onClick={openCreateL} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Lokasi</span>
                </button>
              </div>
              </div>
            </div>

            {locationsLoading && locations.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : locations.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <Store size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada lokasi konsinyasi</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tambahkan lapak/UMKM mitra untuk mulai kirim stok titip</p>
              </div>
            ) : (
              <>
                {paginatedLocations.length > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                    <Checkbox
                      checked={paginatedLocations.every(l => selectedLocations.has(l.id))}
                      indeterminate={paginatedLocations.some(l => selectedLocations.has(l.id)) && !paginatedLocations.every(l => selectedLocations.has(l.id))}
                      onChange={togglePageAllLocations}
                    />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {selectedLocations.size > 0 ? `${selectedLocations.size} dipilih` : `${paginatedLocations.length} lokasi di halaman ini`}
                    </span>
                  </div>
                )}

                {paginatedLocations.length === 0 ? (
                  <div className="card py-12 text-center">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada lokasi yang cocok.</p>
                  </div>
                ) : locationView === 'table' ? (
                  <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                    {paginatedLocations.map((l, i) => {
                      const { qty: totalQty, value: totalValue } = locationStockTotals(l.id);
                      const isSelected = selectedLocations.has(l.id);
                      const num = (safeLocationPage - 1) * locationPageSize + i + 1;
                      return (
                        <div key={l.id}>
                          <div className="flex flex-col gap-3 px-4 py-3" style={{ background: isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                          <div className="flex flex-wrap items-start gap-3">
                          <span className="pt-[5px] w-6 text-xs font-bold text-right flex-shrink-0 tabular" style={{ color: 'var(--text-muted)' }}>{num}</span>
                          <div className="pt-[5px]"><Checkbox checked={isSelected} onChange={() => toggleSelectLocation(l.id)} /></div>
                          <LocationLogo location={l} size={36} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{l.name}</p>
                              {l.code && (
                                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                  {l.code}
                                </span>
                              )}
                              {l.contactName && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {l.contactName}</span>}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              {l.contactPhone && (
                                <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                                  <Phone size={10} /> {l.contactPhone}
                                </span>
                              )}
                              {l.address && (
                                <span className="text-xs flex items-center gap-1 truncate" style={{ color: 'var(--text-muted)' }}>
                                  <MapPin size={10} className="flex-shrink-0" /> {l.address}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 justify-end w-full sm:w-auto sm:ml-auto">
                            <Tooltip label="Kirim Stok">
                              <button onClick={() => openSendForLocation(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Kirim Stok">
                                <Send size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Rekap Harian">
                              <button onClick={() => openRecapForLocation(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Rekap Harian">
                                <ClipboardList size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Riwayat">
                              <button onClick={() => openLocationHistory(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Riwayat">
                                <History size={12} />
                              </button>
                            </Tooltip>
                            <RecordHistoryButton open={auditHistoryId === l.id} onToggle={() => toggleAuditHistory(l.id)} />
                            <Tooltip label="Edit">
                              <button onClick={() => openEditL(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                                <Pencil size={12} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Hapus">
                              <button onClick={() => deleteLocation(l)} disabled={deletingLId === l.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                {deletingLId === l.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </Tooltip>
                          </div>
                          </div>
                          <LocationStatTiles stockQty={totalQty} stockValue={totalValue} stats={locationStatsFor(l.id)} />
                          </div>
                          {auditHistoryId === l.id && <RecordHistoryPanel creds={creds} entity="consignment" entityId={l.id} />}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {paginatedLocations.map((l) => {
                      const { qty: totalQty, value: totalValue } = locationStockTotals(l.id);
                      const isSelected = selectedLocations.has(l.id);
                      return (
                        <div key={l.id}>
                          <div className="card overflow-hidden p-5"
                          style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Checkbox checked={isSelected} onChange={() => toggleSelectLocation(l.id)} />
                              <LocationLogo location={l} size={44} />
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Tooltip label="Kirim Stok">
                                <button onClick={() => openSendForLocation(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Kirim Stok">
                                  <Send size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Rekap Harian">
                                <button onClick={() => openRecapForLocation(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Rekap Harian">
                                  <ClipboardList size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Riwayat">
                                <button onClick={() => openLocationHistory(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Riwayat">
                                  <History size={12} />
                                </button>
                              </Tooltip>
                              <RecordHistoryButton open={auditHistoryId === l.id} onToggle={() => toggleAuditHistory(l.id)} />
                              <Tooltip label="Edit">
                                <button onClick={() => openEditL(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                                  <Pencil size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Hapus">
                                <button onClick={() => deleteLocation(l)} disabled={deletingLId === l.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                  {deletingLId === l.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                </button>
                              </Tooltip>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-bold text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>{l.name}</p>
                            {l.code && (
                              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                {l.code}
                              </span>
                            )}
                          </div>
                          {l.contactName && (
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{l.contactName}</p>
                          )}
                          {l.contactPhone && (
                            <div className="flex items-center gap-1 mt-1">
                              <Phone size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{l.contactPhone}</p>
                            </div>
                          )}
                          {l.address && (
                            <div className="flex items-center gap-1 mt-1">
                              <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{l.address}</p>
                            </div>
                          )}
                          {l.note && (
                            <div className="flex items-start gap-1 mt-1">
                              <StickyNote size={10} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.note}</p>
                            </div>
                          )}
                          <div className="mt-3 pt-3.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                            <LocationStatTiles dense stockQty={totalQty} stockValue={totalValue} stats={locationStatsFor(l.id)} />
                          </div>
                          </div>
                          {auditHistoryId === l.id && <RecordHistoryPanel creds={creds} entity="consignment" entityId={l.id} />}
                        </div>
                      );
                    })}
                  </div>
                )}

                <Pagination total={filteredLocations.length} safePage={safeLocationPage} totalPages={totalLocationPages}
                  pageSize={locationPageSize} onPageSize={n => { setLocationPageSize(n); resetLocationPage(); }}
                  onGoPage={goLocationPage} unit="lokasi" />
              </>
            )}
          </div>
        )}

        {/* ════ KIRIM STOK ═════════════════════════════════════ */}
        {subTab === 'kirim' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {PERIOD_OPTIONS.map(p => (
                <button key={p.id} onClick={() => { setShipmentPeriod(p.id); resetShipmentPage(); }}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
                  style={shipmentPeriod === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  {p.label}
                </button>
              ))}
              {shipmentPeriod === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={shipmentCustomFrom} onChange={e => { setShipmentCustomFrom(e.target.value); resetShipmentPage(); }} className="input" style={{ height: 36 }} />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
                  <input type="date" value={shipmentCustomTo} onChange={e => { setShipmentCustomTo(e.target.value); resetShipmentPage(); }} className="input" style={{ height: 36 }} />
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              {shipments.length > 0 && (
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={shipmentSearch}
                    onChange={e => { setShipmentSearch(e.target.value); resetShipmentPage(); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari lokasi, produk, atau catatan…"
                  />
                </div>
              )}
              <div className="flex items-center gap-2 justify-end flex-shrink-0 w-full sm:w-auto">
                {shipments.length > 0 && (
                  <Tooltip label="Export Excel">
                    <button onClick={() => exportShipmentsExcel(filteredShipments, 'sesuai filter')} disabled={exportingShipments} aria-label="Export Excel"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingShipments ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                    </button>
                  </Tooltip>
                )}
                {shipments.length > 0 && <ViewToggle mode={shipmentView} onChange={setShipmentView} height={HEADER_BTN_H} />}
                <button onClick={openCreateSend} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Kirim</span>
                </button>
              </div>
            </div>

            {shipmentsLoading && shipments.length === 0 ? (
              <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
            ) : shipments.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <Send size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada riwayat pengiriman</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Kirim stok titip ke lokasi mitra untuk mulai konsinyasi</p>
              </div>
            ) : (
              <>
                {paginatedShipments.length > 0 && (
                    <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                      <Checkbox
                        checked={paginatedShipments.every(s => selectedShipments.has(s.id))}
                        indeterminate={paginatedShipments.some(s => selectedShipments.has(s.id)) && !paginatedShipments.every(s => selectedShipments.has(s.id))}
                        onChange={togglePageAllShipments}
                      />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {selectedShipments.size > 0 ? `${selectedShipments.size} dipilih` : `${paginatedShipments.length} pengiriman di halaman ini`}
                      </span>
                    </div>
                  )}

                  {paginatedShipments.length === 0 ? (
                    <div className="card py-12 text-center">
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada riwayat yang cocok.</p>
                    </div>
                  ) : shipmentView === 'table' ? (
                    <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                      {paginatedShipments.map((s, i) => {
                        const isSelected = selectedShipments.has(s.id);
                        const num = (safeShipmentPage - 1) * shipmentPageSize + i + 1;
                        return (
                          <div key={s.id} ref={el => { shipmentRowRefs.current[s.id] = el; }}>
                          <div className="flex items-start gap-3 px-4 py-3"
                            style={{ transition: 'background-color 0.6s ease', background: highlightedShipmentId === s.id ? 'var(--accent-bg)' : isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                            <span className="pt-0.5 w-6 text-xs font-bold text-right flex-shrink-0 tabular" style={{ color: 'var(--text-muted)' }}>{num}</span>
                            <div className="pt-0.5"><Checkbox checked={isSelected} onChange={() => toggleSelectShipment(s.id)} /></div>
                            <LocationLogo location={locations.find(l => l.id === s.locationId) ?? { name: s.locationName }} size={32} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.locationName}</p>
                                  {locations.find(l => l.id === s.locationId)?.code && (
                                    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                                      style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                      {locations.find(l => l.id === s.locationId)?.code}
                                    </span>
                                  )}
                                </div>
                                <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>
                                  {formatRp(s.items.reduce((sum, it) => sum + it.subtotal, 0))}
                                </span>
                              </div>
                              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)} · {s.items.reduce((sum, it) => sum + it.qty, 0)} pcs</p>
                              <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                                {s.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', ')}
                              </p>
                              {s.note && (
                                <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{s.note}&rdquo;</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Tooltip label="Kirim Nota via WhatsApp">
                                <button onClick={() => sendShipmentWhatsApp(s)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Kirim Nota via WhatsApp">
                                  <MessageCircle size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Cetak Nota PDF">
                                <button onClick={() => printShipmentNota(s)} disabled={printingShipmentId === s.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Cetak Nota PDF">
                                  {printingShipmentId === s.id ? <Loader2 size={12} className="animate-spin" /> : <PdfIcon size={12} />}
                                </button>
                              </Tooltip>
                              <RecordHistoryButton open={auditHistoryId === s.id} onToggle={() => toggleAuditHistory(s.id)} />
                              <Tooltip label="Edit">
                                <button onClick={() => openEditSend(s)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                                  <Pencil size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Hapus">
                                <button onClick={() => deleteShipment(s)} disabled={deletingShipmentId === s.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                  {deletingShipmentId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                </button>
                              </Tooltip>
                            </div>
                          </div>
                          {auditHistoryId === s.id && <RecordHistoryPanel creds={creds} entity="consignment" entityId={s.id} />}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {paginatedShipments.map((s) => {
                        const isSelected = selectedShipments.has(s.id);
                        return (
                          <div key={s.id} ref={el => { shipmentRowRefs.current[s.id] = el; }}>
                          <div className="card overflow-hidden p-4"
                            style={{ transition: 'background-color 0.6s ease', background: highlightedShipmentId === s.id ? 'var(--accent-bg)' : undefined, outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                            <div className="flex items-center gap-2 mb-1">
                              <Checkbox checked={isSelected} onChange={() => toggleSelectShipment(s.id)} />
                              <LocationLogo location={locations.find(l => l.id === s.locationId) ?? { name: s.locationName }} size={32} />
                              <p className="text-sm font-bold truncate flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{s.locationName}</p>
                              {locations.find(l => l.id === s.locationId)?.code && (
                                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                                  style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                  {locations.find(l => l.id === s.locationId)?.code}
                                </span>
                              )}
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <Tooltip label="Kirim Nota via WhatsApp">
                                  <button onClick={() => sendShipmentWhatsApp(s)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Kirim Nota via WhatsApp">
                                    <MessageCircle size={12} />
                                  </button>
                                </Tooltip>
                                <Tooltip label="Cetak Nota PDF">
                                  <button onClick={() => printShipmentNota(s)} disabled={printingShipmentId === s.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Cetak Nota PDF">
                                    {printingShipmentId === s.id ? <Loader2 size={12} className="animate-spin" /> : <PdfIcon size={12} />}
                                  </button>
                                </Tooltip>
                                <RecordHistoryButton open={auditHistoryId === s.id} onToggle={() => toggleAuditHistory(s.id)} />
                                <Tooltip label="Edit">
                                  <button onClick={() => openEditSend(s)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                                    <Pencil size={12} />
                                  </button>
                                </Tooltip>
                                <Tooltip label="Hapus">
                                  <button onClick={() => deleteShipment(s)} disabled={deletingShipmentId === s.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                    {deletingShipmentId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                  </button>
                                </Tooltip>
                              </div>
                            </div>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)}</p>
                            <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                              {s.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', ')}
                            </p>
                            {s.note && (
                              <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{s.note}&rdquo;</p>
                            )}
                            <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Total item</span>
                              <span className="text-sm font-bold tabular" style={{ color: 'var(--text-primary)' }}>
                                {s.items.reduce((sum, it) => sum + it.qty, 0)} pcs
                              </span>
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Total nilai titip</span>
                              <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>
                                {formatRp(s.items.reduce((sum, it) => sum + it.subtotal, 0))}
                              </span>
                            </div>
                          </div>
                          {auditHistoryId === s.id && <RecordHistoryPanel creds={creds} entity="consignment" entityId={s.id} />}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <Pagination total={filteredShipments.length} safePage={safeShipmentPage} totalPages={totalShipmentPages}
                    pageSize={shipmentPageSize} onPageSize={n => { setShipmentPageSize(n); resetShipmentPage(); }}
                    onGoPage={goShipmentPage} unit="pengiriman" />
              </>
            )}
          </div>
        )}

        {/* ════ REKAP HARIAN ═══════════════════════════════════ */}
        {subTab === 'rekap' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {PERIOD_OPTIONS.map(p => (
                <button key={p.id} onClick={() => { setRecapPeriod(p.id); resetRecapPage(); }}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
                  style={recapPeriod === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  {p.label}
                </button>
              ))}
              {recapPeriod === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={recapCustomFrom} onChange={e => { setRecapCustomFrom(e.target.value); resetRecapPage(); }} className="input" style={{ height: 36 }} />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
                  <input type="date" value={recapCustomTo} onChange={e => { setRecapCustomTo(e.target.value); resetRecapPage(); }} className="input" style={{ height: 36 }} />
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              {recaps.length > 0 && (
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={recapSearch}
                    onChange={e => { setRecapSearch(e.target.value); resetRecapPage(); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari lokasi, produk, atau catatan…"
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap w-full sm:w-auto">
              {recaps.length > 0 && (
                <button
                  onClick={() => { setRecapOnlyBelumLunas(v => !v); resetRecapPage(); }}
                  className="px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0"
                  style={{
                    height: HEADER_BTN_H,
                    background: recapOnlyBelumLunas ? 'linear-gradient(135deg,#E8821A,#C96018)' : 'var(--surface-2)',
                    color: recapOnlyBelumLunas ? 'white' : 'var(--text-muted)',
                  }}
                >
                  <AlertTriangle size={14} /> <span className="hidden sm:inline">Belum Lunas</span>
                </button>
              )}
              <div className="flex items-center gap-2 justify-end flex-shrink-0">
                {recaps.length > 0 && (
                  <Tooltip label="Export Excel">
                    <button onClick={() => exportRecapsExcel(filteredRecaps, 'sesuai filter')} disabled={exportingRecaps} aria-label="Export Excel"
                      className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingRecaps ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                    </button>
                  </Tooltip>
                )}
                {recaps.length > 0 && <ViewToggle mode={recapView} onChange={setRecapView} height={HEADER_BTN_H} />}
                <button onClick={openCreateRecap} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Rekap</span>
                </button>
              </div>
              </div>
            </div>

            {recapsLoading && recaps.length === 0 ? (
              <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
            ) : recaps.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <ClipboardList size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada riwayat rekap</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Catat qty terjual & retur harian dari lokasi mitra</p>
              </div>
            ) : (
              <>
                {paginatedRecaps.length > 0 && (
                    <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                      <Checkbox
                        checked={paginatedRecaps.every(r => selectedRecaps.has(r.id))}
                        indeterminate={paginatedRecaps.some(r => selectedRecaps.has(r.id)) && !paginatedRecaps.every(r => selectedRecaps.has(r.id))}
                        onChange={togglePageAllRecaps}
                      />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {selectedRecaps.size > 0 ? `${selectedRecaps.size} dipilih` : `${paginatedRecaps.length} rekap di halaman ini`}
                      </span>
                    </div>
                  )}

                  {paginatedRecaps.length === 0 ? (
                    <div className="card py-12 text-center">
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada riwayat yang cocok.</p>
                    </div>
                  ) : recapView === 'table' ? (
                    <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                      {paginatedRecaps.map((r, i) => {
                        const isSelected = selectedRecaps.has(r.id);
                        const num = (safeRecapPage - 1) * recapPageSize + i + 1;
                        return (
                          <div key={r.id} ref={el => { recapRowRefs.current[r.id] = el; }}>
                          <div className="flex items-start gap-3 px-4 py-3"
                            style={{ transition: 'background-color 0.6s ease', background: highlightedRecapId === r.id ? 'var(--accent-bg)' : isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                            <span className="pt-0.5 w-6 text-xs font-bold text-right flex-shrink-0 tabular" style={{ color: 'var(--text-muted)' }}>{num}</span>
                            <div className="pt-0.5"><Checkbox checked={isSelected} onChange={() => toggleSelectRecap(r.id)} /></div>
                            <LocationLogo location={locations.find(l => l.id === r.locationId) ?? { name: r.locationName }} size={32} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.locationName}</p>
                                  {locations.find(l => l.id === r.locationId)?.code && (
                                    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                                      style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                      {locations.find(l => l.id === r.locationId)?.code}
                                    </span>
                                  )}
                                  {r.paymentStatus === 'belum_lunas' && <span className="badge badge-amber">Belum Lunas</span>}
                                  {r.totalReject > 0 && <span className="badge badge-red" style={{ gap: 4 }}><Ban size={9} /> {r.totalReject} pcs reject</span>}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(r.totalRevenue)}</span>
                                  {r.paymentStatus === 'belum_lunas' && (
                                    <button onClick={() => { setMarkLunasRecap(r); setMarkLunasRecapWalletId(r.walletId ?? ''); }} disabled={markingRecapId === r.id}
                                      className="btn-ghost px-2.5 py-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                                      {markingRecapId === r.id ? <Loader2 size={12} className="animate-spin" /> : 'Tandai Lunas'}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                {formatDate(r.createdAt?.seconds)} · {r.totalSold} pcs terjual{r.totalRetur > 0 ? ` · ${r.totalRetur} pcs retur` : ''}{r.totalReject > 0 ? ` · ${r.totalReject} pcs reject` : ''}
                                {r.warehouseName ? ` · ke ${r.warehouseName}` : ''}
                              </p>
                              <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                                {r.items.map(it => `${it.productName} (jual ${it.qtySold}${it.qtyRetur > 0 ? `, retur ${it.qtyRetur}` : ''}${it.qtyReject > 0 ? `, reject ${it.qtyReject}` : ''})`).join(', ')}
                              </p>
                              {r.note && (
                                <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{r.note}&rdquo;</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Tooltip label="Cetak Rekap PDF">
                                <button onClick={() => printRecapNota(r)} disabled={printingRecapId === r.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Cetak Rekap PDF">
                                  {printingRecapId === r.id ? <Loader2 size={12} className="animate-spin" /> : <PdfIcon size={12} />}
                                </button>
                              </Tooltip>
                              {r.paymentStatus === 'belum_lunas' && (
                                <Tooltip label="Kirim Reminder via WhatsApp">
                                  <button onClick={() => sendRecapWhatsApp(r)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Kirim Reminder via WhatsApp">
                                    <MessageCircle size={12} />
                                  </button>
                                </Tooltip>
                              )}
                              <RecordHistoryButton open={auditHistoryId === r.id} onToggle={() => toggleAuditHistory(r.id)} />
                              <Tooltip label="Edit">
                                <button onClick={() => openEditRecap(r)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                                  <Pencil size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Hapus">
                                <button onClick={() => deleteRecap(r)} disabled={deletingRecapId === r.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                  {deletingRecapId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                </button>
                              </Tooltip>
                            </div>
                          </div>
                          {auditHistoryId === r.id && <RecordHistoryPanel creds={creds} entity="consignment" entityId={r.id} />}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {paginatedRecaps.map((r) => {
                        const isSelected = selectedRecaps.has(r.id);
                        return (
                          <div key={r.id} ref={el => { recapRowRefs.current[r.id] = el; }}>
                          <div className="card overflow-hidden p-4"
                            style={{ transition: 'background-color 0.6s ease', background: highlightedRecapId === r.id ? 'var(--accent-bg)' : undefined, outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                            <div className="flex items-center gap-2 mb-1">
                              <Checkbox checked={isSelected} onChange={() => toggleSelectRecap(r.id)} />
                              <LocationLogo location={locations.find(l => l.id === r.locationId) ?? { name: r.locationName }} size={32} />
                              <p className="text-sm font-bold truncate flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{r.locationName}</p>
                              {locations.find(l => l.id === r.locationId)?.code && (
                                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                                  style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                  {locations.find(l => l.id === r.locationId)?.code}
                                </span>
                              )}
                              {r.paymentStatus === 'belum_lunas' && <span className="badge badge-amber flex-shrink-0">Belum Lunas</span>}
                              {r.totalReject > 0 && <span className="badge badge-red flex-shrink-0" style={{ gap: 4 }}><Ban size={9} /> {r.totalReject} pcs reject</span>}
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <Tooltip label="Cetak Rekap PDF">
                                  <button onClick={() => printRecapNota(r)} disabled={printingRecapId === r.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Cetak Rekap PDF">
                                    {printingRecapId === r.id ? <Loader2 size={12} className="animate-spin" /> : <PdfIcon size={12} />}
                                  </button>
                                </Tooltip>
                                {r.paymentStatus === 'belum_lunas' && (
                                  <Tooltip label="Kirim Reminder via WhatsApp">
                                    <button onClick={() => sendRecapWhatsApp(r)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Kirim Reminder via WhatsApp">
                                      <MessageCircle size={12} />
                                    </button>
                                  </Tooltip>
                                )}
                                <RecordHistoryButton open={auditHistoryId === r.id} onToggle={() => toggleAuditHistory(r.id)} />
                                <Tooltip label="Edit">
                                  <button onClick={() => openEditRecap(r)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                                    <Pencil size={12} />
                                  </button>
                                </Tooltip>
                                <Tooltip label="Hapus">
                                  <button onClick={() => deleteRecap(r)} disabled={deletingRecapId === r.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                                    {deletingRecapId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                  </button>
                                </Tooltip>
                              </div>
                            </div>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {formatDate(r.createdAt?.seconds)} · {r.totalSold} pcs terjual{r.totalRetur > 0 ? ` · ${r.totalRetur} pcs retur` : ''}{r.totalReject > 0 ? ` · ${r.totalReject} pcs reject` : ''}
                              {r.warehouseName ? ` · ke ${r.warehouseName}` : ''}
                            </p>
                            <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                              {r.items.map(it => `${it.productName} (jual ${it.qtySold}${it.qtyRetur > 0 ? `, retur ${it.qtyRetur}` : ''}${it.qtyReject > 0 ? `, reject ${it.qtyReject}` : ''})`).join(', ')}
                            </p>
                            <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                              <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(r.totalRevenue)}</span>
                              {r.paymentStatus === 'belum_lunas' && (
                                <button onClick={() => { setMarkLunasRecap(r); setMarkLunasRecapWalletId(r.walletId ?? ''); }} disabled={markingRecapId === r.id}
                                  className="btn-ghost px-2.5 py-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                                  {markingRecapId === r.id ? <Loader2 size={12} className="animate-spin" /> : 'Tandai Lunas'}
                                </button>
                              )}
                            </div>
                          </div>
                          {auditHistoryId === r.id && <RecordHistoryPanel creds={creds} entity="consignment" entityId={r.id} />}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <Pagination total={filteredRecaps.length} safePage={safeRecapPage} totalPages={totalRecapPages}
                    pageSize={recapPageSize} onPageSize={n => { setRecapPageSize(n); resetRecapPage(); }}
                    onGoPage={goRecapPage} unit="rekap" />
              </>
            )}
          </div>
        )}
      </div>

      {showLForm && (
        <div className="modal-overlay" onClick={() => !savingL && setShowLForm(false)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Store size={17} /></div>
                <div>
                  <p className="modal-title">{editingL ? 'Edit Lokasi' : 'Tambah Lokasi Baru'}</p>
                  <p className="modal-subtitle">{editingL ? 'Perbarui informasi lokasi' : 'Isi detail lapak/UMKM mitra'}</p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={() => setShowLForm(false)} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="flex items-center gap-3">
                  <ImageUploadBox
                    src={lForm.logoUrl}
                    alt={lForm.name || 'Logo mitra'}
                    uploading={logoUploading}
                    onSelect={f => uploadLocationLogo(f)}
                    onRemove={() => setLForm({ ...lForm, logoUrl: '' })}
                    icon={<Store size={18} />}
                    fit="contain"
                    size={56}
                    emptyText="Logo"
                  />
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Nama Lokasi <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="text" value={lForm.name} onChange={e => setLForm({ ...lForm, name: e.target.value })}
                      placeholder="cth: Warung Bu Yanti" autoFocus className="input" />
                  </div>
                </div>
                <div style={{ width: 110, flexShrink: 0 }}>
                  <label className="field-label">Kode {editingL ? '(opsional)' : '(otomatis)'}</label>
                  <input type="text" value={lForm.code} onChange={e => setLForm({ ...lForm, code: e.target.value })}
                    placeholder="MTR001" className="input" readOnly={!editingL}
                    style={!editingL ? { background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'not-allowed' } : undefined} />
                </div>
                <div>
                  <label className="field-label">Nama Kontak</label>
                  <input type="text" value={lForm.contactName} onChange={e => setLForm({ ...lForm, contactName: e.target.value })}
                    placeholder="cth: Bu Yanti" className="input" />
                </div>
                <div>
                  <label className="field-label">Telepon</label>
                  <input type="tel" value={lForm.contactPhone} onChange={e => setLForm({ ...lForm, contactPhone: e.target.value })}
                    placeholder="cth: 08123456789" className="input" />
                </div>
                <div>
                  <label className="field-label">Alamat</label>
                  <input type="text" value={lForm.address} onChange={e => setLForm({ ...lForm, address: e.target.value })}
                    placeholder="cth: Jl. Melati No. 3" className="input" />
                </div>
                <div>
                  <label className="field-label">Catatan</label>
                  <textarea rows={3} value={lForm.note} onChange={e => setLForm({ ...lForm, note: e.target.value })}
                    placeholder="Catatan tambahan (opsional)" className="input resize-none" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowLForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={saveLocation} disabled={savingL || !lForm.name.trim()} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingL ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {savingL ? 'Menyimpan…' : editingL ? 'Simpan Perubahan' : 'Tambah Lokasi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSendForm && (
        <div className="modal-overlay" onClick={() => !sending && setShowSendForm(false)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Send size={17} /></div>
                <div>
                  <p className="modal-title">{editingShipment ? 'Edit Kirim Stok' : 'Kirim Stok Konsinyasi'}</p>
                  <p className="modal-subtitle">Stok gudang & stok toko berkurang, stok titip di lokasi bertambah</p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={() => setShowSendForm(false)} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Lokasi Tujuan <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <SearchSelect value={sendLocationId} onChange={setSendLocationId} options={locationOptions}
                      placeholder="– Pilih Lokasi –" searchPlaceholder="Cari lokasi…" />
                  </div>
                  <div>
                    <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Warehouse size={11} /> Gudang Asal <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <SearchSelect value={sendWarehouseId} onChange={setSendWarehouseId}
                      options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                      placeholder="– Pilih Gudang –" searchPlaceholder="Cari gudang…" />
                  </div>
                  <div>
                    <label className="field-label">Tanggal &amp; Jam Kirim</label>
                    <input type="datetime-local" value={sendDate} onChange={e => setSendDate(e.target.value)} className="input" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="field-label" style={{ marginBottom: 0 }}>Produk Dikirim</label>
                    <button onClick={() => setShowSendScanner(true)} type="button"
                      className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--accent)' }}>
                      <ScanLine size={13} /> Scan Produk
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                    {sendRows.map((row, i) => {
                      const qty = parseFloat(row.qty) || 0;
                      const harga = parseFloat(row.hargaTitip) || 0;
                      return (
                        <div key={i} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center gap-2 mb-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={row.productId} onChange={id => updateSendRow(i, { productId: id })}
                                options={productOptions} placeholder="– Produk –" searchPlaceholder="Cari produk…" />
                            </div>
                            <Tooltip label="Hapus baris">
                              <button onClick={() => removeSendRow(i)} disabled={sendRows.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }} title="Hapus baris">
                                <X size={14} />
                              </button>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label style={fieldLabel}>Qty (pcs)</label>
                              <input type="number" min="0" value={row.qty} onChange={e => updateSendRow(i, { qty: e.target.value })}
                                placeholder="0" className="input" />
                            </div>
                            <div>
                              <label style={fieldLabel}>Harga Titip</label>
                              <NumberInput value={row.hargaTitip} onChange={raw => updateSendRow(i, { hargaTitip: raw })}
                                placeholder="0" />
                            </div>
                          </div>
                          {qty > 0 && harga > 0 && (
                            <p className="text-xs tabular mt-2" style={{ color: 'var(--text-muted)' }}>Subtotal: {formatRp(qty * harga)}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={addSendRow} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Produk
                  </button>
                </div>

                <div>
                  <label className="field-label">Catatan</label>
                  <input type="text" value={sendNote} onChange={e => setSendNote(e.target.value)} placeholder="Catatan tambahan (opsional)" className="input" />
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{sendTotalQty} pcs</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Nilai Titip</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(sendTotal)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowSendForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={submitSend} disabled={sending || !canSubmitSend} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? 'Menyimpan…' : editingShipment ? 'Simpan Perubahan' : 'Kirim Stok'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSendScanner && (
        <BarcodeScannerModal
          title="Scan Produk Kirim"
          subtitle="Setiap QR yang terbaca menambah qty 1 pcs"
          onDetect={handleSendScan}
          onClose={() => setShowSendScanner(false)}
        />
      )}

      {markLunasRecap && (
        <div className="modal-overlay" onClick={() => setMarkLunasRecap(null)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><PackageCheck size={17} /></div>
                <div>
                  <p className="modal-title">Tandai Lunas</p>
                  <p className="modal-subtitle">Rekap {markLunasRecap.locationName}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setMarkLunasRecap(null)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <label className="field-label">Uang masuk ke dompet mana? <span style={{ color: 'var(--danger)' }}>*</span></label>
              <SearchSelect value={markLunasRecapWalletId} onChange={setMarkLunasRecapWalletId}
                options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
              {markLunasRecapWalletId && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  Saldo saat ini: {formatRp(walletBalances[markLunasRecapWalletId] ?? 0)}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setMarkLunasRecap(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={confirmMarkRecapLunas} disabled={!markLunasRecapWalletId || markingRecapId === markLunasRecap.id}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {markingRecapId === markLunasRecap.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Tandai Lunas
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkMarkLunasRecaps && (
        <div className="modal-overlay" onClick={() => !bulkMarkingLunasRecaps && setShowBulkMarkLunasRecaps(false)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><PackageCheck size={17} /></div>
                <div>
                  <p className="modal-title">Tandai Lunas</p>
                  <p className="modal-subtitle">{belumLunasSelectedRecaps.length} rekap terpilih</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowBulkMarkLunasRecaps(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <label className="field-label">Uang masuk ke dompet mana? <span style={{ color: 'var(--danger)' }}>*</span></label>
              <SearchSelect value={bulkMarkLunasWalletId} onChange={setBulkMarkLunasWalletId}
                options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
              {bulkMarkLunasWalletId && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  Saldo saat ini: {formatRp(walletBalances[bulkMarkLunasWalletId] ?? 0)}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowBulkMarkLunasRecaps(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={confirmBulkMarkRecapsLunas} disabled={!bulkMarkLunasWalletId || bulkMarkingLunasRecaps}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {bulkMarkingLunasRecaps ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Tandai Lunas ({belumLunasSelectedRecaps.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecapForm && (
        <div className="modal-overlay" onClick={() => !submittingRecap && setShowRecapForm(false)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ClipboardList size={17} /></div>
                <div>
                  <p className="modal-title">{editingRecap ? 'Edit Rekap Harian' : 'Rekap Harian'}</p>
                  <p className="modal-subtitle">Catat qty terjual & retur — sisanya tetap tertahan di lokasi</p>
                </div>
              </div>
              <Tooltip label="Tutup">
                <button onClick={() => setShowRecapForm(false)} className="modal-close"><X size={14} /></button>
              </Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Lokasi <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <SearchSelect value={recapLocationId} disabled={!!editingRecap}
                      onChange={id => { setRecapLocationId(id); loadRecapStock(id); }}
                      options={locationOptions} placeholder="– Pilih Lokasi –" searchPlaceholder="Cari lokasi…" />
                  </div>
                  <div>
                    <label className="field-label">Tanggal &amp; Jam</label>
                    <input type="datetime-local" value={recapDate} onChange={e => setRecapDate(e.target.value)} className="input" />
                  </div>
                </div>

                {recapLocationId && (
                  recapStockLoading ? (
                    <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
                  ) : recapStock.length === 0 ? (
                    <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Tidak ada stok titip di lokasi ini.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--surface-2)' }}>
                          {(['sold', 'retur', 'reject'] as const).map(mode => (
                            <button key={mode} type="button" onClick={() => setRecapScanMode(mode)}
                              className="text-[11px] font-bold px-2 py-1 rounded-md" style={{
                                background: recapScanMode === mode ? 'var(--accent)' : 'transparent',
                                color: recapScanMode === mode ? '#fff' : 'var(--text-muted)',
                              }}>
                              {recapScanModeLabel[mode]}
                            </button>
                          ))}
                        </div>
                        <button onClick={() => setShowRecapScanner(true)} type="button"
                          className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--accent)' }}>
                          <ScanLine size={13} /> Scan Produk
                        </button>
                      </div>
                      {recapRows.map(({ item, sold, sisa, exceeds }) => (
                        <div key={item.productId} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-sm font-bold flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>{item.productName}</p>
                            <span className="text-xs tabular flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                              Stok di lokasi: {item.stockQty} pcs · {formatRp(item.hargaTitip)}/pcs
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label style={fieldLabel}>Qty Terjual</label>
                              <input type="number" min="0" value={recapInputs[item.productId]?.sold ?? ''}
                                onChange={e => setRecapInputs(prev => ({ ...prev, [item.productId]: { sold: e.target.value, retur: prev[item.productId]?.retur ?? '', reject: prev[item.productId]?.reject ?? '' } }))}
                                placeholder="0" className="input" />
                            </div>
                            <div>
                              <label style={fieldLabel}>Qty Retur</label>
                              <input type="number" min="0" value={recapInputs[item.productId]?.retur ?? ''}
                                onChange={e => setRecapInputs(prev => ({ ...prev, [item.productId]: { sold: prev[item.productId]?.sold ?? '', retur: e.target.value, reject: prev[item.productId]?.reject ?? '' } }))}
                                placeholder="0" className="input" />
                            </div>
                            <div>
                              <label style={fieldLabel}>Qty Reject</label>
                              <input type="number" min="0" value={recapInputs[item.productId]?.reject ?? ''}
                                onChange={e => setRecapInputs(prev => ({ ...prev, [item.productId]: { sold: prev[item.productId]?.sold ?? '', retur: prev[item.productId]?.retur ?? '', reject: e.target.value } }))}
                                placeholder="0" className="input" />
                            </div>
                          </div>
                          <p className="text-xs mt-2 tabular" style={{ color: exceeds ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {exceeds
                              ? `Melebihi stok di lokasi (tersedia ${item.stockQty} pcs)`
                              : `Sisa tetap di lokasi: ${sisa} pcs${sold > 0 ? ` · Pendapatan: ${formatRp(sold * item.hargaTitip)}` : ''}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )
                )}

                {recapNeedsWarehouse && (
                  <div>
                    <label style={{ ...fieldLabel, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Warehouse size={11} /> Gudang Tujuan Retur/Reject <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <SearchSelect value={recapWarehouseId} onChange={setRecapWarehouseId}
                      options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                      placeholder="– Pilih Gudang –" searchPlaceholder="Cari gudang…" />
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Retur (kondisi baik) menambah stok jual di gudang ini. Reject (rusak/tidak layak jual) hanya tercatat sebagai kerugian, tidak menambah stok jual.
                    </p>
                  </div>
                )}

                <div>
                  <label className="field-label">Catatan</label>
                  <input type="text" value={recapNote} onChange={e => setRecapNote(e.target.value)} placeholder="cth: kemasan penyok, expired, komplain pelanggan…" className="input" />
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    Dipakai juga sebagai keterangan retur/reject di riwayat &amp; catatan gudang.
                  </p>
                </div>

                <div>
                  <label className="field-label">Status Pembayaran</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['lunas', 'belum_lunas'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setRecapPaymentStatus(s)}
                        className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                        style={recapPaymentStatus === s ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {s === 'lunas' ? 'Lunas' : 'Belum Lunas'}
                      </button>
                    ))}
                  </div>
                  {recapPaymentStatus === 'belum_lunas' && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Belum ikut dihitung sebagai pendapatan di Laporan Keuangan sampai ditandai Lunas (mitra sudah setor).
                    </p>
                  )}
                </div>

                {recapPaymentStatus === 'lunas' && (
                  <div>
                    <label className="field-label">Dompet <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <SearchSelect value={recapWalletId} onChange={setRecapWalletId}
                      options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                    {recapWalletId && (
                      <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                        Saldo saat ini: {formatRp(walletBalances[recapWalletId] ?? 0)}
                      </p>
                    )}
                  </div>
                )}

                {recapTotalRevenue > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--success-bg)' }}>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Pendapatan</span>
                    <span className="text-lg font-extrabold tabular" style={{ color: 'var(--success)' }}>{formatRp(recapTotalRevenue)}</span>
                  </div>
                )}

                {recapHasExceeds && (
                  <p className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    <AlertTriangle size={12} /> Ada qty yang melebihi stok di lokasi — periksa kembali sebelum simpan.
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowRecapForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={submitRecap} disabled={submittingRecap || !canSubmitRecap} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {submittingRecap ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />}
                {submittingRecap ? 'Menyimpan…' : editingRecap ? 'Simpan Perubahan' : 'Simpan Rekap'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecapScanner && (
        <BarcodeScannerModal
          title="Scan Produk Rekap"
          subtitle={`Setiap QR yang terbaca menambah qty ${recapScanModeLabel[recapScanMode]} +1`}
          onDetect={handleRecapScan}
          onClose={() => setShowRecapScanner(false)}
          headerExtra={
            <div className="flex items-center justify-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--surface-2)' }}>
              {(['sold', 'retur', 'reject'] as const).map(mode => (
                <button key={mode} type="button" onClick={() => setRecapScanMode(mode)}
                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-md" style={{
                    background: recapScanMode === mode ? 'var(--accent)' : 'transparent',
                    color: recapScanMode === mode ? '#fff' : 'var(--text-muted)',
                  }}>
                  {recapScanModeLabel[mode]}
                </button>
              ))}
            </div>
          }
        />
      )}

      {/* ════ ANALITIK ═══════════════════════════════════════ */}
      {subTab === 'analitik' && (
        <div className="p-4 lg:p-6 animate-fade-up">
          <ConsignmentAnalyticsSection
            data={analyticsData}
            loading={analyticsLoading}
            period={analyticsPeriod}
            customFrom={analyticsCustomFrom}
            customTo={analyticsCustomTo}
            onPeriodChange={setAnalyticsPeriod}
            onCustomFromChange={setAnalyticsCustomFrom}
            onCustomToChange={setAnalyticsCustomTo}
            onNavigateLocation={() => setSubTab('lokasi')}
          />
        </div>
      )}

      {historyLocation && (
        <div className="modal-overlay" onClick={closeLocationHistory}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><History size={17} /></div>
                <div>
                  <p className="modal-title">Riwayat {historyLocation.name}</p>
                  <p className="modal-subtitle">
                    {[historyLocation.contactName, historyLocation.contactPhone].filter(Boolean).join(' · ') || 'Riwayat kirim & rekap lokasi ini'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Tooltip label="Export Excel">
                  <button onClick={exportHistoryExcel} disabled={exportingHistoryExcel || historyLoading} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                    {exportingHistoryExcel ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                  </button>
                </Tooltip>
                <Tooltip label="Export PDF">
                  <button onClick={exportHistoryPdf} disabled={exportingHistoryPdf || historyLoading} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                    {exportingHistoryPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                  </button>
                </Tooltip>
                <Tooltip label="Tutup">
                  <button onClick={closeLocationHistory} className="modal-close"><X size={14} /></button>
                </Tooltip>
              </div>
            </div>
            <div className="modal-body">
              {historyLoading ? (
                <div className="flex items-center justify-center py-14"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                      <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Stok Saat Ini</p>
                      <p className="text-sm font-bold tabular mt-0.5" style={{ color: 'var(--accent)' }}>
                        {locationStockTotals(historyLocation.id).qty} pcs
                      </p>
                    </div>
                    <div className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                      <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Total Dikirim</p>
                      <p className="text-sm font-bold tabular mt-0.5" style={{ color: 'var(--text-primary)' }}>{formatRp(historyTotalKirim)}</p>
                    </div>
                    <div className="p-3 rounded-xl" style={{ background: 'var(--success-bg)' }}>
                      <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Total Pendapatan</p>
                      <p className="text-sm font-bold tabular mt-0.5" style={{ color: 'var(--success)' }}>{formatRp(historyTotalRevenue)}</p>
                    </div>
                    <div className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                      <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Jual / Retur / Reject</p>
                      <p className="text-sm font-bold tabular mt-0.5" style={{ color: 'var(--text-primary)' }}>
                        {historyTotalSold} / {historyTotalRetur} / {historyTotalReject}
                      </p>
                    </div>
                  </div>

                  {historyBelumLunas > 0 && (
                    <p className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                      <AlertTriangle size={12} /> {historyBelumLunas} rekap belum lunas di lokasi ini.
                    </p>
                  )}

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                      <Clock size={11} /> Linimasa ({historyTimeline.length})
                    </p>
                    {historyTimeline.length === 0 ? (
                      <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat untuk lokasi ini.</p>
                    ) : (
                      <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                        {historyTimeline.map(entry => entry.kind === 'kirim' ? (
                          <div key={`s-${entry.shipment.id}`} className="px-4 py-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="badge badge-blue" style={{ gap: 4 }}><Send size={10} /> Kirim</span>
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(entry.shipment.createdAt?.seconds)}</p>
                              <span className="text-sm font-bold tabular ml-auto" style={{ color: 'var(--accent)' }}>
                                {formatRp(entry.shipment.items.reduce((s, it) => s + it.subtotal, 0))}
                              </span>
                            </div>
                            <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                              {entry.shipment.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', ')}
                            </p>
                          </div>
                        ) : (
                          <div key={`r-${entry.recap.id}`} className="px-4 py-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="badge badge-green" style={{ gap: 4 }}><ClipboardList size={10} /> Rekap</span>
                              {entry.recap.paymentStatus === 'belum_lunas' && <span className="badge badge-amber">Belum Lunas</span>}
                              {entry.recap.totalReject > 0 && <span className="badge badge-red" style={{ gap: 4 }}><Ban size={9} /> {entry.recap.totalReject} pcs reject</span>}
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(entry.recap.createdAt?.seconds)}</p>
                              <span className="text-sm font-bold tabular ml-auto" style={{ color: 'var(--success)' }}>
                                {formatRp(entry.recap.totalRevenue)}
                              </span>
                            </div>
                            <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                              {entry.recap.items.map(it => `${it.productName} (jual ${it.qtySold}${it.qtyRetur > 0 ? `, retur ${it.qtyRetur}` : ''}${it.qtyReject > 0 ? `, reject ${it.qtyReject}` : ''})`).join(', ')}
                            </p>
                            {entry.recap.warehouseName && (
                              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Retur/reject ke gudang: {entry.recap.warehouseName}</p>
                            )}
                            {entry.recap.note && (
                              <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{entry.recap.note}&rdquo;</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={closeLocationHistory} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk action bar — Lokasi */}
      {subTab === 'lokasi' && selectedLocations.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedLocations.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportLocationsExcel(locations.filter(l => selectedLocations.has(l.id)), 'terpilih')} disabled={exportingLocations}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingLocations ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Excel
            </button>
            <button onClick={() => exportLocationsPDF(locations.filter(l => selectedLocations.has(l.id)), 'terpilih')} disabled={exportingLocationsPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingLocationsPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              PDF
            </button>
            <button onClick={bulkDeleteLocations} disabled={bulkDeletingLocations}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkDeletingLocations ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setSelectedLocations(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Bulk action bar — Riwayat Kirim */}
      {subTab === 'kirim' && selectedShipments.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedShipments.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportShipmentsExcel(shipments.filter(s => selectedShipments.has(s.id)), 'terpilih')} disabled={exportingShipments}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingShipments ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Export
            </button>
            <button onClick={() => printShipmentsBulk(shipments.filter(s => selectedShipments.has(s.id)))} disabled={printingShipmentsBulk}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {printingShipmentsBulk ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              Cetak PDF
            </button>
            <button onClick={bulkDeleteShipments} disabled={bulkDeletingShipments}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkDeletingShipments ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setSelectedShipments(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Bulk action bar — Riwayat Rekap */}
      {subTab === 'rekap' && selectedRecaps.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedRecaps.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportRecapsExcel(recaps.filter(r => selectedRecaps.has(r.id)), 'terpilih')} disabled={exportingRecaps}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingRecaps ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
              Excel
            </button>
            <button onClick={() => printRecapsBulk(recaps.filter(r => selectedRecaps.has(r.id)))} disabled={printingRecapsBulk}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {printingRecapsBulk ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              Cetak PDF
            </button>
            {belumLunasSelectedRecaps.length > 0 && (
              <button onClick={() => sendRecapsWhatsAppBulk(recaps.filter(r => selectedRecaps.has(r.id)))}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                <MessageCircle size={13} />
                Kirim WA {belumLunasSelectedRecaps.length < selectedRecaps.size ? `(${belumLunasSelectedRecaps.length})` : ''}
              </button>
            )}
            {belumLunasSelectedRecaps.length > 0 && (
              <button onClick={() => { setBulkMarkLunasWalletId(''); setShowBulkMarkLunasRecaps(true); }}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                style={{ background: 'var(--success)', color: '#fff' }}>
                <Check size={13} />
                Tandai Lunas {belumLunasSelectedRecaps.length < selectedRecaps.size ? `(${belumLunasSelectedRecaps.length})` : ''}
              </button>
            )}
            <button onClick={bulkDeleteRecaps} disabled={bulkDeletingRecaps}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkDeletingRecaps ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setSelectedRecaps(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
