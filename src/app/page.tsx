'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  RefreshCw, TrendingUp, Receipt, Package, Users,
  Loader2,
  Eye, EyeOff, Smartphone, Monitor, BarChart2, Globe, Award,
  MousePointerClick, Tag, ShoppingCart, Download, Share, AlertTriangle,
  LayoutDashboard, PieChart, Store, KeyRound,
} from 'lucide-react';
import AppShell, { TabId } from '@/components/AppShell';
import LoginApprovalScreen from '@/components/LoginApprovalScreen';
import ForceLogoutOverlay from '@/components/ForceLogoutOverlay';
import type { NotificationDoc } from '@/components/NotificationBell';
import { usePwaInstall } from '@/lib/usePwaInstall';
import TopbarPortal from '@/components/TopbarPortal';
import { BRAND_NAME } from '@/lib/branding';
import Tooltip from '@/components/Tooltip';
import ProductsTab, { isLowStock as isProductLowStock } from '@/components/tabs/ProductsTab';
import CategoriesTab from '@/components/tabs/CategoriesTab';
import OrdersTab    from '@/components/tabs/OrdersTab';
import ResellersTab from '@/components/tabs/ResellersTab';
import CustomersTab from '@/components/tabs/CustomersTab';
import StorefrontCustomersTab from '@/components/tabs/StorefrontCustomersTab';
import ReviewsTab from '@/components/tabs/ReviewsTab';
import StockTab     from '@/components/tabs/StockTab';
import StockReportTab from '@/components/tabs/StockReportTab';
import SuppliersTab  from '@/components/tabs/SuppliersTab';
import MaterialsTab, { isLowStock as isMaterialLowStock } from '@/components/tabs/MaterialsTab';
import ProductionTab from '@/components/tabs/ProductionTab';
import ConsignmentTab from '@/components/tabs/ConsignmentTab';
import IncomeTab      from '@/components/tabs/IncomeTab';
import ExpensesTab   from '@/components/tabs/ExpensesTab';
import FinanceReportTab from '@/components/tabs/FinanceReportTab';
import ProductReportTab from '@/components/tabs/ProductReportTab';
import CapitalTab from '@/components/tabs/CapitalTab';
import WalletsTab from '@/components/tabs/WalletsTab';
import SettingsTab  from '@/components/tabs/SettingsTab';
import PosTab from '@/components/tabs/PosTab';
import UsersTab from '@/components/tabs/UsersTab';
import RolesTab from '@/components/tabs/RolesTab';
import ModulesTab from '@/components/tabs/ModulesTab';
import MenusTab from '@/components/tabs/MenusTab';
import RolePermissionsTab from '@/components/tabs/RolePermissionsTab';
import HistoryTab from '@/components/tabs/HistoryTab';
import AdminFeeTab from '@/components/tabs/AdminFeeTab';
import AdminFeeBillingTab from '@/components/tabs/AdminFeeBillingTab';
import NotificationsTab from '@/components/tabs/NotificationsTab';
import type { PosProduct, PosCategory_Entry, PosReseller, PosBank, PosCustomer } from '@/lib/pos-types';
import type { ModuleDoc, MenuDoc, Action } from '@/types/rbac';
import TopListChart from '@/components/dashboard/TopListChart';
import BusinessAnalyticsSection, { type BusinessAnalyticsData } from '@/components/dashboard/BusinessAnalyticsSection';
import ConsignmentAnalyticsSection, { type ConsignmentAnalyticsData } from '@/components/dashboard/ConsignmentAnalyticsSection';
import { type PeriodKey, periodRange } from '@/lib/period';

// ─── Types & helpers ──────────────────────────────────────────────────────────
interface DashOrder { customerName: string; total: number; date: string; }
interface TopProduct { name: string; emoji: string; bgColor: string; stock: string; count: number; }
interface WebStats {
  visitors: number; pageViews: number;
  mobile: number; desktop: number;
  daily: { date: string; views: number; visitors: number }[];
  topPages: { path: string; visitors: number }[];
  topMenu: { path: string; count: number }[];
  topCategories: { id: string; name: string; emoji: string; count: number }[];
  topProducts: { id: string; name: string; emoji: string; bgColor: string; clicks: number; addToCart: number }[];
}
interface DashMaterial { id: string; name: string; unit: string; stockQty: number; minStock?: number }
interface LowStockItem { id: string; kind: 'product' | 'material'; name: string; unit: string; stockQty: number; minStock: number }
interface DashData {
  orderCount: number; revenue: number;
  productCount: number; resellerCount: number;
  recentOrders: DashOrder[];
  revenueTrend: { date: string; revenue: number; count: number }[];
  topProducts: TopProduct[];
  lowStockItems: LowStockItem[];
  webStats: WebStats | null;
  webStatsErr: string;
}

const PAGE_LABELS: Record<string, string> = {
  '/': 'Beranda', '/products': 'Produk', '/reseller': 'Reseller',
  '/panduan': 'Panduan', '/kontak': 'Kontak', '/checkout': 'Checkout',
};
const pageLabel = (p: string) => PAGE_LABELS[p] ?? p;

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const formatQty = (n: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

// Tanggal kalender WIB (Asia/Jakarta) dalam format yyyy-mm-dd — dipakai untuk menyamakan
// pengelompokan "hari ini" di dashboard dengan konvensi wibDayStart/wibDayEnd di API orders,
// supaya tidak selisih beberapa jam di sekitar tengah malam akibat timezone browser.
const wibDateKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

function parseWebStats(ws: Record<string, unknown>): WebStats {
  const devArr = (ws.devices as { type: string; count: number }[]) ?? [];
  return {
    visitors:  ((ws.stats as Record<string, number>)?.visitors  ?? 0),
    pageViews: ((ws.stats as Record<string, number>)?.pageViews ?? 0),
    mobile:    devArr.find(d => d.type === 'mobile')?.count  ?? 0,
    desktop:   devArr.find(d => d.type === 'desktop')?.count ?? 0,
    daily:     (ws.daily    as WebStats['daily'])    ?? [],
    topPages:  (ws.paths    as WebStats['topPages']) ?? [],
    topMenu:       (ws.topMenu       as WebStats['topMenu'])       ?? [],
    topCategories: (ws.topCategories as WebStats['topCategories']) ?? [],
    topProducts:   (ws.topProducts   as WebStats['topProducts'])   ?? [],
  };
}

function webStatsErrMsg(res: Response | null): string {
  if (!res) return 'Tidak dapat terhubung ke server.';
  if (res.status === 401) return 'Sesi admin tidak valid, silakan login ulang.';
  return `Gagal memuat data pengunjung (status ${res.status}).`;
}

// ─── Revenue Chart — smooth bezier line + hover tooltip ──────────────────────
function RevenueChart({ data }: { data: { date: string; revenue: number; count: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = data.length;
  if (n === 0) return null;

  const VW = 560, VH = 128;
  const PAD = { l: 6, r: 6, t: 22, b: 28 };
  const iW = VW - PAD.l - PAD.r;
  const iH = VH - PAD.t - PAD.b;
  const maxVal = Math.max(...data.map(d => d.revenue), 1);

  const pts = data.map((d, i) => ({
    x: PAD.l + (n === 1 ? iW / 2 : (i / (n - 1)) * iW),
    y: PAD.t + (1 - d.revenue / maxVal) * iH,
    revenue: d.revenue, date: d.date, count: d.count,
  }));

  const linePath = n < 2 ? '' : pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x},${pt.y}`;
    const prev = pts[i - 1];
    return `${acc} C ${prev.x + (pt.x - prev.x) * 0.45},${prev.y} ${prev.x + (pt.x - prev.x) * 0.55},${pt.y} ${pt.x},${pt.y}`;
  }, '');

  const fillPath = linePath
    ? `${linePath} L ${pts[n-1].x},${PAD.t + iH} L ${pts[0].x},${PAD.t + iH} Z`
    : '';

  const lastPt = pts[n - 1];
  const hPt = hoverIdx !== null ? pts[hoverIdx] : null;
  const step = n > 14 ? 3 : n > 7 ? 2 : 1;

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * VW;
          let ci = 0, md = Infinity;
          pts.forEach((pt, i) => { const d = Math.abs(pt.x - relX); if (d < md) { md = d; ci = i; } });
          setHoverIdx(ci);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {fillPath && <path d={fillPath} fill="url(#rev-fill)" />}
        {linePath && <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

        {/* Single point */}
        {n === 1 && <circle cx={lastPt.x} cy={lastPt.y} r="5" fill="var(--accent)" stroke="white" strokeWidth="2" />}

        {/* Hover dashed vertical */}
        {hPt && (
          <line x1={hPt.x} y1={PAD.t} x2={hPt.x} y2={PAD.t + iH}
            stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4,3" />
        )}

        {/* Hover dot */}
        {hPt && <circle cx={hPt.x} cy={hPt.y} r="5" fill="var(--accent)" stroke="white" strokeWidth="2.5" />}

        {/* Endpoint pulse (hari ini) */}
        {n > 1 && hoverIdx !== n - 1 && (
          <>
            <circle cx={lastPt.x} cy={lastPt.y} r="10" fill="var(--accent)" opacity="0.10" />
            <circle cx={lastPt.x} cy={lastPt.y} r="4.5" fill="var(--accent)" stroke="white" strokeWidth="2" />
          </>
        )}

        {/* X-axis labels */}
        {pts.map((pt, i) => {
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text key={i} x={pt.x} y={VH - 4} textAnchor="middle" fontSize="9" fill="#A08468">
              {shortDate(pt.date)}
            </text>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hPt && hPt.revenue > 0 && (
        <div style={{
          position: 'absolute',
          left: `${(hPt.x / VW) * 100}%`,
          top: `${(hPt.y / VH) * 100}%`,
          transform: 'translate(-50%, calc(-100% - 10px))',
          background: 'var(--text-primary)',
          color: 'white',
          padding: '5px 10px',
          borderRadius: 8,
          fontSize: 11, fontWeight: 700,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          zIndex: 10,
        }}>
          {formatRp(hPt.revenue)}
          {hPt.count > 0 && <span style={{ opacity: 0.6, marginLeft: 5, fontSize: 10 }}>{hPt.count}x</span>}
        </div>
      )}
    </div>
  );
}

// ─── Pageview Chart ───────────────────────────────────────────────────────────
function shortDate(raw: string) {
  try {
    const dt = new Date(raw);
    if (!isNaN(dt.getTime()))
      return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  } catch {}
  const p = raw.split(/[\s-]/);
  return p.length >= 2 ? `${p[p.length - 1]} ${p[1]?.slice(0, 3) ?? ''}`.trim() : raw.slice(0, 5);
}

function PageviewChart({ data }: { data: { date: string; views: number; visitors: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = data.length;
  if (n === 0) return null;

  const VW = 720, VH = 190;
  const PAD = { l: 4, r: 4, t: 22, b: 24 };
  const iW = VW - PAD.l - PAD.r;
  const iH = VH - PAD.t - PAD.b;
  const maxViews = Math.max(...data.map(d => d.views), 1);
  const maxVisitors = Math.max(...data.map(d => d.visitors), 1);
  const avgViews = data.reduce((s, d) => s + d.views, 0) / n;

  const gap = n > 20 ? 3 : n > 10 ? 6 : 10;
  const barW = Math.max((iW - gap * (n - 1)) / n, 3);
  const avgY = PAD.t + (1 - avgViews / maxViews) * iH;

  // Evenly-spaced label indices (always includes first & last) instead of a modulo step —
  // a step can leave the forced last label sitting right next to its neighbour and overlapping it.
  const labelCount = Math.min(n, 8);
  const labelIdxs = new Set(
    Array.from({ length: labelCount }, (_, k) => Math.round(k * (n - 1) / Math.max(labelCount - 1, 1)))
  );

  const linePts = data.map((d, i) => ({
    x: PAD.l + i * (barW + gap) + barW / 2,
    y: PAD.t + (1 - d.visitors / maxVisitors) * iH,
  }));
  const linePath = n < 2 ? '' : linePts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x},${pt.y}`;
    const prev = linePts[i - 1];
    return `${acc} C ${prev.x + (pt.x - prev.x) * 0.45},${prev.y} ${prev.x + (pt.x - prev.x) * 0.55},${pt.y} ${pt.x},${pt.y}`;
  }, '');

  const hover = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible', cursor: 'crosshair' }}
        onMouseLeave={() => setHoverIdx(null)}>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={PAD.l} x2={VW - PAD.r} y1={PAD.t + (1 - f) * iH} y2={PAD.t + (1 - f) * iH}
            stroke="var(--border-2)" strokeWidth="1" />
        ))}

        {avgViews > 0 && (
          <line x1={PAD.l} x2={VW - PAD.r} y1={avgY} y2={avgY}
            stroke="#0284C7" strokeOpacity="0.45" strokeWidth="1.25" strokeDasharray="5,4" />
        )}

        {data.map((d, i) => {
          const x = PAD.l + i * (barW + gap);
          const barH = Math.max((d.views / maxViews) * iH, d.views > 0 ? 3 : 1.5);
          const y = PAD.t + iH - barH;
          const isToday = i === n - 1;
          const isHover = hoverIdx === i;
          const showLabel = labelIdxs.has(i);
          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: 'pointer' }}>
              <rect x={x - gap / 2} y={PAD.t} width={barW + gap} height={iH} fill="transparent" />
              <rect x={x} y={y} width={barW} height={barH} rx={Math.min(4, barW / 2)}
                fill={isHover || isToday ? '#0284C7' : '#0284C730'}
                style={{ transition: 'fill 0.12s' }} />
              {showLabel && (
                <text x={x + barW / 2} y={VH - 6} textAnchor="middle" fontSize="9" fill="#9E8E72">
                  {shortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}

        {linePath && <path d={linePath} fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />}
        {linePts.map((pt, i) => (hoverIdx === i || i === n - 1) && (
          <circle key={i} cx={pt.x} cy={pt.y} r="3.5" fill="#7C3AED" stroke="white" strokeWidth="1.5" />
        ))}
      </svg>

      {hover && (() => {
        const x = PAD.l + hoverIdx! * (barW + gap) + barW / 2;
        const barH = Math.max((hover.views / maxViews) * iH, hover.views > 0 ? 3 : 1.5);
        const y = PAD.t + iH - barH;
        const dt = new Date(hover.date);
        const label = !isNaN(dt.getTime())
          ? dt.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })
          : hover.date;
        return (
          <div style={{
            position: 'absolute',
            left: `${(x / VW) * 100}%`,
            top: `${(y / VH) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 8px))',
            background: 'var(--text-primary)', color: 'white',
            padding: '6px 10px', borderRadius: 8,
            fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
            pointerEvents: 'none', boxShadow: '0 4px 14px rgba(0,0,0,0.25)', zIndex: 10,
          }}>
            <div>{label}</div>
            <div style={{ fontWeight: 500, fontSize: 10, marginTop: 2, display: 'flex', gap: 8 }}>
              <span>🔵 {hover.views} pageview</span>
              <span>🟣 {hover.visitors} pengunjung</span>
            </div>
          </div>
        );
      })()}

      <div className="flex items-center gap-4 mt-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: '#0284C7' }} /> Pageview
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#7C3AED' }} /> Pengunjung unik
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2.5 h-[2px] inline-block" style={{ background: '#0284C7', opacity: 0.45 }} /> Rata-rata
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminPage() {

  // ── Auth ─────────────────────────────────────────────────
  const [authed,   setAuthed]   = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [creds,    setCreds]    = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [showPassword, setShowPassword] = useState(false);
  // Set right after login when the server reports mustChangePassword=true (Firebase Auth
  // account still on its temporary password) — gates the dashboard behind a forced password
  // change instead of calling applySession immediately.
  const [pendingChange, setPendingChange] = useState<{ token: string; tempPassword: string } | null>(null);
  const [newPass, setNewPass] = useState('');
  const [newPassConfirm, setNewPassConfirm] = useState('');
  const [changeErr, setChangeErr] = useState('');
  const [changing, setChanging] = useState(false);
  // Set right after login when /api/login reports pending=true (akun sudah online di sesi lain
  // — lihat LoginApprovalScreen.tsx) — menggantikan form login sampai sesi tersebut merespons.
  const [pendingApproval, setPendingApproval] = useState<{ requestId: string; deviceLabel: string; tempPassword: string } | null>(null);
  // Diisi lewat onForceLogout — kick manual oleh admin, atau role/password berubah/akun dihapus
  // (bukan lagi dipicu oleh approve login konkuren; itu sekarang tidak me-revoke sesi ini, lihat
  // LoginRequestWatcher.tsx). Lihat ForceLogoutOverlay.tsx. Beda dari loginErr: ini muncul SETELAH
  // sempat authed, bukan saat mengisi form login.
  const [forceLogoutReason, setForceLogoutReason] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<{ username: string; role: string; email: string | null; avatar: string | null } | null>(null);
  const [permissions, setPermissions] = useState<Record<string, Partial<Record<Action, boolean>>>>({});
  const [superAdmin, setSuperAdmin] = useState(false);

  // Logo toko untuk layar login (sebelum ada sesi, jadi tidak bisa lewat /api/settings yang
  // butuh x-admin-auth) — lihat api/public-branding/route.ts. Fallback ke /icon-192.png statis
  // kalau belum pernah diisi di Settings > Info Toko.
  const [loginLogo, setLoginLogo] = useState<string | undefined>(undefined);
  useEffect(() => {
    fetch('/api/public-branding')
      .then(r => r.ok ? r.json() : null)
      .then((data: { logo?: string | null } | null) => { if (data?.logo) setLoginLogo(data.logo); })
      .catch(() => {});
  }, []);
  const [modules, setModules] = useState<ModuleDoc[]>([]);
  const [menus, setMenus] = useState<MenuDoc[]>([]);
  const { canInstall, installed, isIOS, promptInstall } = usePwaInstall();

  // ── Tab ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [highlightInvoice, setHighlightInvoice] = useState<string | null>(null);
  const [highlightOrderId, setHighlightOrderId] = useState<string | null>(null);
  const [highlightMaterialId, setHighlightMaterialId] = useState<string | null>(null);
  const [highlightShipmentId, setHighlightShipmentId] = useState<string | null>(null);
  const [highlightRecapId, setHighlightRecapId] = useState<string | null>(null);

  // Klik "Lihat" di modal detail notifikasi (NotificationBell) — pindah tab & sorot item terkait.
  // pos_shift_open sengaja tidak punya highlight: tab POS belum punya list riwayat shift untuk disorot.
  const handleOpenNotification = (n: NotificationDoc) => {
    switch (n.type) {
      case 'order_new':
      case 'payment_proof': setHighlightOrderId(n.entityId); break;
      case 'stock_low': setHighlightMaterialId(n.entityId); break;
      case 'consignment_overdue':
      case 'consignment_recap': setHighlightRecapId(n.entityId); break;
      case 'consignment_send': setHighlightShipmentId(n.entityId); break;
    }
    if (n.link) setActiveTab(n.link as TabId);
  };

  // ── Analytics ────────────────────────────────────────────
  // Sub-view di dalam tab Analitik — dipisah supaya tidak jadi satu halaman yang kepanjangan ke
  // bawah (pola sama seperti subView di FinanceReportTab / stokView di StockTab).
  const [dashSubView, setDashSubView] = useState<'ringkasan' | 'analitik-bisnis' | 'analitik-mitra' | 'analitik-web'>('ringkasan');
  const [dashData, setDashData] = useState<DashData | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [webRange, setWebRange] = useState<7 | 30>(30);
  const [webLoading, setWebLoading] = useState(false);

  // ── Analitik Bisnis (channel, laba rugi, bahan baku) — agregasi server-side ──
  const [bizPeriod, setBizPeriod] = useState<PeriodKey>('30d');
  const [bizCustomFrom, setBizCustomFrom] = useState('');
  const [bizCustomTo, setBizCustomTo] = useState('');
  const [bizData, setBizData] = useState<BusinessAnalyticsData | null>(null);
  const [bizLoading, setBizLoading] = useState(false);

  // ── Analitik Mitra (kirim/pendapatan/pelunasan per lokasi konsinyasi) — agregasi server-side ──
  const [mitraPeriod, setMitraPeriod] = useState<PeriodKey>('30d');
  const [mitraCustomFrom, setMitraCustomFrom] = useState('');
  const [mitraCustomTo, setMitraCustomTo] = useState('');
  const [mitraData, setMitraData] = useState<ConsignmentAnalyticsData | null>(null);
  const [mitraLoading, setMitraLoading] = useState(false);

  // ── POS (shared data — PosTab owns cart/checkout state itself) ─────
  const [posProducts,    setPosProducts]    = useState<PosProduct[]>([]);
  const [posCategories,  setPosCategories]  = useState<PosCategory_Entry[]>([]);
  const [bankOptions,    setBankOptions]    = useState<PosBank[]>([]);
  const [resellerList,   setResellerList]   = useState<PosReseller[]>([]);
  const [customerList,   setCustomerList]   = useState<PosCustomer[]>([]);
  const [posCartCount,   setPosCartCount]   = useState(0);

  // ── Analytics fetch — Firestore + main app web stats ────────
  const fetchDash = useCallback(async (authHeader?: string) => {
    setLoading(true);
    const token = authHeader ?? creds;
    const h = { 'x-admin-auth': token };
    try {
      // Rentang 7 hari (WIB) eksplisit — bukan cuma limit=50 default API, supaya "Omzet Hari Ini"
      // dan tren 7 hari tetap akurat walau ada >50 transaksi dalam rentang ini.
      const todayKey = wibDateKey(new Date());
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
      const fromKey = wibDateKey(weekAgo);
      const [oRes, pRes, rRes, cRes, bRes, custRes, matRes, webRes] = await Promise.all([
        fetch(`/api/orders?from=${fromKey}&to=${todayKey}`, { headers: h }),
        fetch('/api/products',     { headers: h }),
        fetch('/api/resellers',    { headers: h }),
        fetch('/api/categories',   { headers: h }),
        fetch('/api/master-banks', { headers: h }),
        fetch('/api/customers',    { headers: h }),
        fetch('/api/materials',    { headers: h }),
        fetch(`/api/web-stats?days=${webRange}`, { headers: h }).catch(() => null),
      ]);

      // ── Firestore data ────────────────────────────────────
      const orders: { customerName: string; total: number; createdAt?: { seconds: number }; date?: string; items?: { name: string; qty: number; subtotal: number }[] }[] =
        oRes.ok ? (await oRes.json()).orders : [];
      const fetchedProducts: PosProduct[] = pRes.ok ? (await pRes.json() as { products: PosProduct[] }).products : [];
      const resellers: (PosReseller & Record<string, unknown>)[] = rRes.ok ? (await rRes.json()).resellers : [];
      const fetchedCats: { id: string; name: string; emoji: string }[] =
        cRes.ok ? (await cRes.json() as { categories: { id: string; name: string; emoji: string }[] }).categories : [];
      const fetchedBanks: PosBank[] = bRes.ok ? (await bRes.json() as { banks: PosBank[] }).banks : [];
      const fetchedCustomers: PosCustomer[] = custRes.ok ? (await custRes.json() as { customers: PosCustomer[] }).customers : [];
      const fetchedMaterials: DashMaterial[] =
        matRes.ok ? (await matRes.json() as { materials: DashMaterial[] }).materials : [];
      setPosProducts(fetchedProducts);
      setPosCategories(fetchedCats.map(c => ({ id: c.id, label: c.name, emoji: c.emoji })));
      setResellerList(resellers.filter(r => r.status === 'approved'));
      setBankOptions(fetchedBanks);
      setCustomerList(fetchedCustomers);

      const revenue = orders.reduce((s, o) => s + (o.total ?? 0), 0);
      const recentOrders: DashOrder[] = orders.slice(0, 5).map(o => ({
        customerName: o.customerName,
        total: o.total,
        date: o.createdAt?.seconds
          ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
          : (o.date ?? '–'),
      }));
      const now = new Date();
      const revenueTrend = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (6 - i));
        const key = wibDateKey(d);
        const label = `${parseInt(key.slice(8, 10), 10)}/${parseInt(key.slice(5, 7), 10)}`;
        const dayOrders = orders.filter(o =>
          o.createdAt?.seconds ? wibDateKey(new Date(o.createdAt.seconds * 1000)) === key : false
        );
        return { date: label, revenue: dayOrders.reduce((s, o) => s + o.total, 0), count: dayOrders.length };
      });

      // ── Web analytics (Firestore, same project) ───────────
      let webStats: WebStats | null = null;
      let webStatsErr = '';
      if (webRes?.ok) {
        webStats = parseWebStats(await webRes.json() as Record<string, unknown>);
      } else {
        webStatsErr = webStatsErrMsg(webRes);
      }

      const salesMap: Record<string, number> = {};
      orders.forEach(o => o.items?.forEach(it => { salesMap[it.name] = (salesMap[it.name] ?? 0) + it.qty; }));
      const topProducts: TopProduct[] = Object.entries(salesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => {
          const p = fetchedProducts.find(fp => fp.name === name);
          return { name, emoji: p?.emoji ?? '📦', bgColor: p?.bgColor ?? '#F5F0E9', stock: p?.stock ?? 'Ada', count };
        });

      const lowStockItems: LowStockItem[] = [
        ...fetchedProducts.filter(isProductLowStock).map(p => ({
          id: p.id, kind: 'product' as const, name: p.name, unit: 'pcs', stockQty: p.stockQty ?? 0, minStock: p.minStock ?? 0,
        })),
        ...fetchedMaterials.filter(isMaterialLowStock).map(m => ({
          id: m.id, kind: 'material' as const, name: m.name, unit: m.unit, stockQty: m.stockQty, minStock: m.minStock ?? 0,
        })),
      ].sort((a, b) => (a.stockQty / Math.max(a.minStock, 1)) - (b.stockQty / Math.max(b.minStock, 1)));

      setDashData({ orderCount: orders.length, revenue, productCount: fetchedProducts.length, resellerCount: resellers.length, recentOrders, revenueTrend, topProducts, lowStockItems, webStats, webStatsErr });
    } catch {}
    setLoading(false);
  }, [creds, webRange]);

  // ── POS stock refresh — lightweight, products-only (no analytics/resellers/
  // customers) so opening the Kasir tab or starting a new sale doesn't drag in
  // the full dashboard fetch (which duplicates products/categories reads inside
  // web-stats and was a meaningful chunk of daily Firestore reads on busy days) ──
  const refreshPosStock = useCallback(async () => {
    try {
      const res = await fetch('/api/products', { headers: { 'x-admin-auth': creds } });
      if (res.ok) setPosProducts((await res.json() as { products: PosProduct[] }).products);
    } catch {}
  }, [creds]);

  // ── Web stats range toggle — refetch only the analytics section ──
  const changeWebRange = useCallback(async (range: 7 | 30) => {
    setWebRange(range);
    setWebLoading(true);
    try {
      const res = await fetch(`/api/web-stats?days=${range}`, { headers: { 'x-admin-auth': creds } });
      if (res.ok) {
        const webStats = parseWebStats(await res.json() as Record<string, unknown>);
        setDashData(d => d ? { ...d, webStats, webStatsErr: '' } : d);
      } else {
        setDashData(d => d ? { ...d, webStats: null, webStatsErr: webStatsErrMsg(res) } : d);
      }
    } catch {
      setDashData(d => d ? { ...d, webStats: null, webStatsErr: webStatsErrMsg(null) } : d);
    }
    setWebLoading(false);
  }, [creds]);

  // ── Analitik Bisnis — agregasi channel/laba-rugi/bahan-baku dari endpoint server-side,
  // supaya angkanya identik dengan tab Laporan Keuangan untuk periode yang sama ──
  const fetchBusinessAnalytics = useCallback(async (authHeader?: string) => {
    const token = authHeader ?? creds;
    if (!token) return;
    setBizLoading(true);
    try {
      const { from, to } = periodRange(bizPeriod, bizCustomFrom, bizCustomTo);
      const res = await fetch(`/api/analytics/overview?from=${from}&to=${to}`, { headers: { 'x-admin-auth': token } });
      if (res.ok) setBizData(await res.json() as BusinessAnalyticsData);
    } catch {}
    setBizLoading(false);
  }, [creds, bizPeriod, bizCustomFrom, bizCustomTo]);

  // Refetch tiap kali periode (atau rentang custom) diubah dari toggle di dashboard.
  useEffect(() => {
    if (!authed) return;
    fetchBusinessAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizPeriod, bizCustomFrom, bizCustomTo]);

  // ── Analitik Mitra — agregasi kirim/rekap per lokasi konsinyasi dari endpoint server-side ──
  const fetchConsignmentAnalytics = useCallback(async (authHeader?: string) => {
    const token = authHeader ?? creds;
    if (!token) return;
    setMitraLoading(true);
    try {
      const { from, to } = periodRange(mitraPeriod, mitraCustomFrom, mitraCustomTo);
      const res = await fetch(`/api/analytics/consignment?from=${from}&to=${to}`, { headers: { 'x-admin-auth': token } });
      if (res.ok) setMitraData(await res.json() as ConsignmentAnalyticsData);
    } catch {}
    setMitraLoading(false);
  }, [creds, mitraPeriod, mitraCustomFrom, mitraCustomTo]);

  useEffect(() => {
    if (!authed) return;
    fetchConsignmentAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitraPeriod, mitraCustomFrom, mitraCustomTo]);

  // ── Dynamic sidebar data — Struktur Menu / Modul drive the real nav ──
  const fetchNav = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/menus', { headers: { 'x-admin-auth': token } });
      if (res.ok) {
        const { modules, menus } = await res.json() as { modules: ModuleDoc[]; menus: MenuDoc[] };
        setModules(modules); setMenus(menus);
      }
    } catch {}
  }, []);

  // ── Badge notifikasi "Pesanan" — pesanan yang belum ditandai selesai (Website, atau
  // Kasir yang berisi item "Buka PO"). Dipakai supaya badge di sidebar sudah muncul sebelum
  // tab Pesanan pernah dibuka; begitu tab Pesanan dibuka, OrdersTab yang mengambil alih
  // hitungan lewat state-nya sendiri.
  const fetchNewOrdersCount = useCallback(async (authHeader?: string) => {
    const token = authHeader ?? creds;
    try {
      const res = await fetch('/api/orders', { headers: { 'x-admin-auth': token } });
      if (res.ok) {
        const { orders } = await res.json() as { orders: { source?: string; status?: string }[] };
        setNewOrdersCount(orders.filter(o => o.status === 'baru').length);
      }
    } catch {}
  }, [creds]);

  // Resolves the caller's permission map from /api/me and hydrates auth
  // state + kicks off the dashboard/nav fetches. Shared by session-restore
  // and login so both end up with the exact same state shape.
  const applySession = useCallback(async (token: string): Promise<boolean> => {
    // Data fetches ditembak paralel dengan /api/me (bukan menunggu /api/me selesai dulu) — tiap
    // endpoint sudah verifikasi token sendiri lewat requirePermission, jadi tidak perlu menunggu
    // hasil /api/me. Ini menghilangkan satu round-trip berurutan dari waktu sampai data pertama
    // tampil (mis. tab Analitik Mitra) saat login/refresh halaman.
    fetchDash(token); fetchNav(token); fetchNewOrdersCount(token); fetchBusinessAnalytics(token); fetchConsignmentAnalytics(token);
    const res = await fetch('/api/me', { headers: { 'x-admin-auth': token } });
    if (!res.ok) return false;
    const { user, permissions, superAdmin } = await res.json() as {
      user: { username: string; role: string; email: string | null; avatar: string | null };
      permissions: Record<string, Partial<Record<Action, boolean>>>;
      superAdmin: boolean;
    };
    setCreds(token); setAuthUser(user); setPermissions(permissions); setSuperAdmin(superAdmin); setAuthed(true);
    return true;
  }, [fetchDash, fetchNav, fetchNewOrdersCount, fetchBusinessAnalytics, fetchConsignmentAnalytics]);

  // ── Session restore ──────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('admin_creds');
    if (!saved) { setChecking(false); return; }
    applySession(saved).then(ok => {
      if (!ok) localStorage.removeItem('admin_creds');
      setChecking(false);
    }).catch(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jika tab aktif tidak (lagi) ada di daftar menu yang terlihat untuk role
  // ini — baik saat load awal (mis. Kasir tidak punya akses Analitik) atau
  // karena hak akses/struktur menu diubah di tengah sesi — pindah ke tab
  // pertama yang memang terlihat, daripada membiarkan halaman kosong.
  useEffect(() => {
    if (!authed || menus.length === 0) return;
    // 'admin-fee'/'tagihan-admin-fee' are deliberately not MenuDocs (see AppShell's TabId
    // comment) — exempt them here so opening either doesn't immediately bounce back to the
    // first visible menu item.
    if (activeTab === 'admin-fee' || activeTab === 'tagihan-admin-fee') return;
    const visible = new Set(menus.map(m => m.featureKey));
    if (!visible.has(activeTab)) {
      // Folder menus (featureKey null — pure grouping) aren't a real screen to land on,
      // so they're excluded here; otherwise a folder sorted first would make this silently
      // fail to redirect at all (setActiveTab(null) is a no-op, guarded below anyway).
      const firstVisible = menus
        .filter(m => m.featureKey)
        .slice()
        .sort((a, b) => a.order - b.order)[0]?.featureKey as TabId | undefined;
      if (firstVisible) setActiveTab(firstVisible);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menus, authed]);

  const login = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setLoginErr('');

    const errs: { username?: string; password?: string } = {};
    if (!username.trim()) errs.username = 'Username atau email wajib diisi.';
    if (!password)        errs.password = 'Password wajib diisi.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setFieldErrors({});

    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const data = await res.json() as { token?: string; mustChangePassword?: boolean; pending?: boolean; requestId?: string; deviceLabel?: string };
      if (data.pending && data.requestId) {
        // Akun ini sedang online di sesi lain — tunggu sesi itu menerima/menolak (lihat
        // LoginApprovalScreen.tsx) sebelum token benar-benar diterbitkan.
        setPendingApproval({ requestId: data.requestId, deviceLabel: data.deviceLabel ?? 'perangkat lain', tempPassword: password });
        return;
      }
      if (data.mustChangePassword) {
        // Password sementara — jangan buka dashboard dulu, minta ganti password dulu.
        setPendingChange({ token: data.token!, tempPassword: password });
        return;
      }
      localStorage.setItem('admin_creds', data.token!);
      await applySession(data.token!);
    } else {
      setFieldErrors({ username: ' ', password: ' ' });
      setLoginErr('Username/email atau password salah.');
    }
  };

  // Sesi lain menyetujui permintaan login ini (lihat LoginApprovalScreen.tsx) — lanjutkan
  // persis seperti login normal yang berhasil, termasuk kemungkinan masih harus ganti password
  // sementara.
  const handleApprovalApproved = async (result: { token: string; mustChangePassword?: boolean }) => {
    const tempPassword = pendingApproval?.tempPassword ?? password;
    setPendingApproval(null);
    if (result.mustChangePassword) {
      setPendingChange({ token: result.token, tempPassword });
      return;
    }
    localStorage.setItem('admin_creds', result.token);
    await applySession(result.token);
  };

  const handleApprovalRejected = (reason: string) => {
    setPendingApproval(null);
    setFieldErrors({ username: ' ', password: ' ' });
    setLoginErr(reason);
  };

  const handleApprovalExpired = () => {
    setPendingApproval(null);
    setLoginErr('Permintaan login kedaluwarsa — silakan coba lagi.');
  };

  const submitPasswordChange = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pendingChange) return;
    setChangeErr('');
    if (newPass.length < 6) { setChangeErr('Password baru minimal 6 karakter.'); return; }
    if (newPass !== newPassConfirm) { setChangeErr('Konfirmasi password tidak cocok.'); return; }

    setChanging(true);
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'x-admin-auth': pendingChange.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pendingChange.tempPassword, newPassword: newPass }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: undefined })) as { error?: string };
        setChangeErr(d.error ?? 'Gagal mengubah password.');
        return;
      }
      // Server mengeluarkan token baru dengan mustChangePassword=false — token lama tetap
      // ditolak oleh route yang terproteksi walau passwordnya sudah diganti.
      const { token: newToken } = await res.json().catch(() => ({ token: undefined })) as { token?: string };
      const token = newToken ?? pendingChange.token;
      setPendingChange(null); setNewPass(''); setNewPassConfirm('');
      localStorage.setItem('admin_creds', token);
      await applySession(token);
    } finally {
      setChanging(false);
    }
  };

  const logout = () => {
    // Best-effort — kalau gagal (offline dll), presence-nya baru hilang setelah window last_seen
    // habis sendiri (lihat lib/chat.ts), tapi itu tidak boleh menunda/menggagalkan logout lokal.
    fetch('/api/logout', { method: 'POST', headers: { 'x-admin-auth': creds } }).catch(() => {});
    localStorage.removeItem('admin_creds');
    setAuthed(false); setDashData(null); setCreds('');
    setPermissions({}); setSuperAdmin(false); setModules([]); setMenus([]); setNewOrdersCount(0);
  };

  // ─── Screens: Loading & Login ────────────────────────────
  if (checking) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ground)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-[3px] rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Memuat dashboard…</p>
      </div>
    </div>
  );

  if (pendingChange) return (
    <div className="min-h-screen flex items-center justify-center p-4 lg:p-8 relative overflow-hidden" style={{ background: 'var(--ground)' }}>
      <div className="relative w-full rounded-[28px] overflow-hidden p-8 lg:p-10"
        style={{ maxWidth: 420, background: 'var(--surface)', boxShadow: '0 24px 70px -20px rgba(30,16,8,0.35), 0 4px 18px rgba(30,16,8,0.08)' }}>
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex items-center justify-center rounded-2xl mb-4" style={{ width: 52, height: 52, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            <KeyRound size={22} />
          </div>
          <h1 className="text-xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Set Password Baru</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Ini login pertama Anda dengan password sementara — buat password baru sebelum melanjutkan.
          </p>
        </div>

        <form onSubmit={submitPasswordChange} className="space-y-4" noValidate>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Password Baru</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={newPass}
                onChange={e => { setNewPass(e.target.value); setChangeErr(''); }}
                className="input" style={{ paddingRight: 40 }}
                placeholder="Minimal 6 karakter" autoComplete="new-password" autoFocus />
              <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Konfirmasi Password Baru</label>
            <input type={showPassword ? 'text' : 'password'} value={newPassConfirm}
              onChange={e => { setNewPassConfirm(e.target.value); setChangeErr(''); }}
              className="input" placeholder="Ulangi password baru" autoComplete="new-password" />
          </div>
          {changeErr && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium animate-scale-in"
              style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {changeErr}
            </div>
          )}
          <button type="submit" disabled={changing} className="btn-primary w-full justify-center py-3 text-sm">
            {changing ? <Loader2 size={16} className="animate-spin" /> : 'Simpan & Lanjutkan'}
          </button>
        </form>
      </div>
    </div>
  );

  if (pendingApproval) return (
    <LoginApprovalScreen
      requestId={pendingApproval.requestId}
      deviceLabel={pendingApproval.deviceLabel}
      onApproved={handleApprovalApproved}
      onRejected={handleApprovalRejected}
      onExpired={handleApprovalExpired}
    />
  );

  if (!authed) return (
    <div className="min-h-screen flex items-center justify-center p-4 lg:p-8" style={{ background: 'var(--ground)' }}>

      {/* Card */}
      <div className="relative w-full grid lg:grid-cols-2 rounded-[28px] overflow-hidden"
        style={{ maxWidth: 920, background: 'var(--surface)', boxShadow: '0 24px 70px -20px rgba(0,0,0,0.35), 0 4px 18px rgba(0,0,0,0.08)' }}>

        {/* Left panel — brand */}
        <div className="hidden lg:flex flex-col justify-between p-12 relative" style={{ background: 'var(--sidebar)' }}>
          <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: 'var(--accent)' }} />

          <div className="flex items-center gap-3 relative z-10">
            <Image src={loginLogo || '/icon-192.png'} alt="logo" width={40} height={40} className="rounded-xl" />
            <span className="text-white font-bold text-[15px]">{BRAND_NAME}</span>
          </div>

          <div className="relative z-10">
            <p className="text-4xl font-extrabold text-white leading-tight mb-3">
              Kendalikan<br />bisnis tepung<br />aci Anda.
            </p>
            <p className="text-sm" style={{ color: 'var(--sidebar-text)' }}>
              Dashboard admin untuk mengelola produk,<br />pesanan, stok, dan analitik toko.
            </p>
          </div>

          <p className="text-xs relative z-10" style={{ color: 'var(--sidebar-muted)' }}>
            © 2026 {BRAND_NAME}
          </p>
        </div>

        {/* Right panel — form */}
        <div className="flex flex-col items-center justify-center px-6 py-10 lg:p-12">
          <div className="w-full max-w-sm">
            <div className="flex flex-col items-center mb-8 lg:hidden">
              <Image src={loginLogo || '/icon-192.png'} alt="logo" width={56} height={56} className="rounded-2xl shadow mb-3" />
            </div>
            <h1 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Masuk</h1>
            <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Dashboard Admin {BRAND_NAME}</p>

            <form onSubmit={login} className="space-y-4" noValidate>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Username atau Email</label>
                <input type="text" value={username}
                  onChange={e => { setUsername(e.target.value); setFieldErrors(f => ({ ...f, username: undefined })); setLoginErr(''); }}
                  className={`input ${fieldErrors.username ? 'input-error' : ''}`}
                  placeholder="Masukkan username atau email" autoComplete="username" />
                {fieldErrors.username?.trim() && (
                  <p className="text-xs font-medium mt-1.5" style={{ color: 'var(--danger)' }}>{fieldErrors.username}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Password</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password}
                    onChange={e => { setPassword(e.target.value); setFieldErrors(f => ({ ...f, password: undefined })); setLoginErr(''); }}
                    className={`input ${fieldErrors.password ? 'input-error' : ''}`}
                    style={{ paddingRight: 40 }}
                    placeholder="Masukkan password" autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {fieldErrors.password?.trim() && (
                  <p className="text-xs font-medium mt-1.5" style={{ color: 'var(--danger)' }}>{fieldErrors.password}</p>
                )}
              </div>
              {loginErr && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
                  style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                  {loginErr}
                </div>
              )}
              <button type="submit" className="btn-primary w-full justify-center py-3 text-sm">
                Masuk ke Dashboard
              </button>
            </form>

            {canInstall && !installed && (
              <button
                type="button"
                onClick={promptInstall}
                className="btn-ghost w-full justify-center py-3 text-sm mt-3 flex items-center gap-2"
                style={{ border: '1px solid var(--border-2)' }}
              >
                <Download size={15} />
                Install Aplikasi Admin
              </button>
            )}

            {isIOS && !installed && (
              <div
                className="w-full mt-3 flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
                style={{ border: '1px solid var(--border-2)', color: 'var(--text-secondary)' }}
              >
                <Share size={14} style={{ flexShrink: 0 }} />
                <span>
                  Untuk install, ketuk ikon <strong>Share</strong> di Safari lalu pilih{' '}
                  <strong>&quot;Add to Home Screen&quot;</strong>
                </span>
              </div>
            )}

            <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
              Dikembangkan oleh PT. Eleven Digital Indonesia
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Dashboard (Analytics) content ───────────────────────
  const dashboardContent = (
    <div className="p-4 lg:p-6 space-y-5">

      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={() => { fetchDash(); fetchNewOrdersCount(); fetchBusinessAnalytics(); fetchConsignmentAnalytics(); }} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      {/* Sub-view — Ringkasan (harian) vs Analitik Bisnis (channel/keuangan/bahan baku) vs Analitik Web (pengunjung situs) */}
      <div className="inline-flex rounded-xl overflow-hidden border flex-wrap" style={{ borderColor: 'var(--border)' }}>
        {([
          { id: 'ringkasan' as const, label: 'Ringkasan', Icon: LayoutDashboard },
          { id: 'analitik-bisnis' as const, label: 'Analitik Bisnis', Icon: PieChart },
          { id: 'analitik-mitra' as const, label: 'Analitik Mitra', Icon: Store },
          { id: 'analitik-web' as const, label: 'Analitik Web', Icon: Globe },
        ]).map(t => (
          <button key={t.id} onClick={() => setDashSubView(t.id)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all"
            style={dashSubView === t.id ? { background: 'var(--accent)', color: 'white' } : { color: 'var(--text-muted)' }}>
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {dashSubView === 'ringkasan' && (
      <div className="space-y-5">
      {/* Loading */}
      {loading && !dashData && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      )}

      {dashData && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: <Receipt    size={16}/>, label: 'Pesanan Hari Ini', val: (dashData.revenueTrend[dashData.revenueTrend.length - 1]?.count ?? 0).toString(),   color: 'var(--accent)',  iconBg: 'var(--accent-bg)',  bar: 'var(--accent),#15803D' },
              { icon: <TrendingUp size={16}/>, label: 'Omzet Hari Ini',  val: formatRp(dashData.revenueTrend[dashData.revenueTrend.length - 1]?.revenue ?? 0),      color: 'var(--success)', iconBg: 'var(--success-bg)', bar: '#15803D,#166534' },
              { icon: <Package    size={16}/>, label: 'Produk Aktif',    val: dashData.productCount.toString(), color: '#0284C7',        iconBg: '#EFF6FF',           bar: '#0284C7,#0369A1' },
              { icon: <Users      size={16}/>, label: 'Total Reseller',  val: dashData.resellerCount.toString(),color: '#7C3AED',        iconBg: '#F5F3FF',           bar: '#7C3AED,#6D28D9' },
            ].map((c, i) => (
              <div key={i} className="card relative p-4 overflow-hidden"
                style={{ transition: 'transform 0.18s, box-shadow 0.18s', cursor: 'default' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(30,16,8,0.10)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 10, background: c.iconBg, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  {c.icon}
                </div>
                <p className="tabular" style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', lineHeight: 1.15, marginBottom: 4 }}>{c.val}</p>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{c.label}</p>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: '0 0 12px 12px', background: `linear-gradient(90deg, ${c.bar})` }} />
              </div>
            ))}
          </div>

          {/* Revenue chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Omzet 7 Hari Terakhir</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tren revenue 7 hari terakhir</p>
              </div>
              {dashData.revenueTrend.some(d => d.revenue > 0) && (
                <span className="badge badge-amber">
                  Total 7 hari: {formatRp(dashData.revenue)}
                </span>
              )}
            </div>
            {dashData.revenueTrend.every(d => d.revenue === 0) ? (
              <div className="py-8 text-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada transaksi 7 hari terakhir</p>
              </div>
            ) : (
              <RevenueChart data={dashData.revenueTrend} />
            )}
          </div>

          {/* Recent orders + Top products — 2-col */}
          <div className="grid lg:grid-cols-2 gap-4">

            {/* Recent orders */}
            {dashData.recentOrders.length > 0 ? (
              <div className="card overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <Receipt size={15} style={{ color: 'var(--accent)' }} />
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Pesanan Terbaru</p>
                </div>
                <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                  {dashData.recentOrders.map((o, i) => (
                    <div key={i} className="px-5 py-3.5 flex items-center gap-3"
                      style={{ transition: 'background 0.12s', cursor: 'default' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--success)', boxShadow: '0 0 0 3px rgba(21,128,61,0.12)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{o.date}</p>
                      </div>
                      <span className="text-sm font-extrabold tabular flex-shrink-0" style={{ color: 'var(--success)' }}>
                        {formatRp(o.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card p-10 text-center flex flex-col items-center justify-center">
                <div className="text-4xl mb-3">📊</div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada transaksi</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Buat pesanan di tab <strong>Kasir</strong> untuk mulai melihat data.
                </p>
              </div>
            )}

            {/* Top products */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                <Award size={15} style={{ color: 'var(--accent)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Produk Terlaris</p>
              </div>
              {dashData.topProducts.length > 0 ? (
                <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                  {dashData.topProducts.map((prod, i) => {
                    const rankColors = [
                      { fg: '#B8860B', bg: '#FFFBEA' },
                      { fg: '#6B7280', bg: '#F3F4F6' },
                      { fg: '#B07832', bg: '#FFF3E0' },
                    ];
                    const r = rankColors[i] ?? { fg: 'var(--text-muted)', bg: 'var(--surface-2)' };
                    const stockCls = prod.stock === 'Ada' ? 'badge-green' : prod.stock === 'Terbatas' ? 'badge-amber' : prod.stock === 'Habis' ? 'badge-red' : 'badge-gray';
                    return (
                      <div key={i} className="px-5 py-3.5 flex items-center gap-3"
                        style={{ transition: 'background 0.12s', cursor: 'default' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: r.bg, color: r.fg, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {i + 1}
                        </div>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${prod.bgColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
                          {prod.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{prod.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{prod.count} terjual</p>
                        </div>
                        <span className={`badge ${stockCls} flex-shrink-0`}>{prod.stock}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 py-10 text-center">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada data penjualan produk</p>
                </div>
              )}
            </div>
          </div>

          {/* Stok menipis */}
          {dashData.lowStockItems.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Stok Menipis</p>
                <span className="badge badge-amber">{dashData.lowStockItems.length}</span>
              </div>
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                {dashData.lowStockItems.slice(0, 8).map(item => (
                  <button key={`${item.kind}-${item.id}`}
                    onClick={() => setActiveTab(item.kind === 'product' ? 'products' : 'materials')}
                    className="w-full px-5 py-3.5 flex items-center gap-3 text-left"
                    style={{ transition: 'background 0.12s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <span className={`badge ${item.kind === 'product' ? 'badge-blue' : 'badge-gray'} flex-shrink-0`}>
                      {item.kind === 'product' ? 'Produk' : 'Bahan Baku'}
                    </span>
                    <p className="text-sm font-bold truncate flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                    <span className="text-xs font-semibold tabular flex-shrink-0" style={{ color: 'var(--warning)' }}>
                      Sisa {formatQty(item.stockQty)} {item.unit} <span style={{ color: 'var(--text-muted)' }}>· min. {item.minStock}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      </div>
      )}

      {dashSubView === 'analitik-web' && (
      <div className="space-y-5">
      {/* ── Analitik Pengunjung Web ── */}
      <div className="flex items-center justify-between gap-2.5 pt-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: '#EFF6FF', color: '#0284C7' }}>
            <Globe size={16} />
          </div>
          <div>
            <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Analitik Pengunjung Web</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Data kunjungan situs toko</p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-2)' }}>
          {([7, 30] as const).map(r => (
            <button key={r} onClick={() => changeWebRange(r)} disabled={webLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{
                background: webRange === r ? 'var(--surface)' : 'transparent',
                color: webRange === r ? 'var(--accent)' : 'var(--text-muted)',
                boxShadow: webRange === r ? '0 1px 4px rgba(30,16,8,0.10)' : 'none',
              }}>
              {r} hari
            </button>
          ))}
        </div>
      </div>

      {/* Web stats error banner */}
      {dashData?.webStatsErr && (
        <div className="rounded-2xl px-4 py-3.5 flex items-start gap-3"
          style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-light)' }}>
          <span className="text-base flex-shrink-0">⚠️</span>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--accent-dark)' }}>Data pengunjung tidak tersedia</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--warning)' }}>{dashData.webStatsErr}</p>
          </div>
        </div>
      )}

      {/* Web stats cards */}
      {dashData?.webStats && (() => {
        const ws = dashData.webStats!;
        const devTotal = ws.mobile + ws.desktop;
        const mPct = devTotal > 0 ? Math.round((ws.mobile  / devTotal) * 100) : 0;
        const dPct = devTotal > 0 ? Math.round((ws.desktop / devTotal) * 100) : 0;
        const avgPages = ws.visitors > 0 ? (ws.pageViews / ws.visitors).toFixed(1) : '–';
        const todayViews = ws.daily.length > 0 ? ws.daily[ws.daily.length - 1].views : 0;
        const avgViews = ws.daily.length > 0
          ? Math.round(ws.daily.reduce((s, d) => s + d.views, 0) / ws.daily.length)
          : 0;
        return (
          <>
            {/* Stat cards — Perangkat gabung jadi 1 kartu (mobile/desktop split) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { icon: <Users      size={15}/>, label: 'Pengunjung Unik', val: ws.visitors.toLocaleString('id'),  color: '#0284C7', bg: '#EFF6FF' },
                { icon: <Eye        size={15}/>, label: 'Total Pageview',  val: ws.pageViews.toLocaleString('id'), color: '#7C3AED', bg: '#F5F3FF' },
                { icon: <BarChart2  size={15}/>, label: 'Hlm / Pengunjung',val: avgPages,                          color: '#059669', bg: '#ECFDF5' },
              ].map((c, i) => (
                <div key={i} className="card relative p-4 overflow-hidden">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                    style={{ background: c.bg, color: c.color }}>
                    {c.icon}
                  </div>
                  <p className="text-xl font-extrabold tabular leading-tight mb-0.5" style={{ color: 'var(--text-primary)' }}>{c.val}</p>
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-2xl"
                    style={{ background: `linear-gradient(90deg, ${c.color}, ${c.color}88)` }} />
                </div>
              ))}

              {/* Perangkat — mobile/desktop split dalam 1 kartu */}
              <div className="card relative p-4 overflow-hidden">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <Smartphone size={13} style={{ color: '#0284C7' }} />
                    <Monitor size={13} style={{ color: '#7C3AED' }} />
                  </div>
                  <span className="text-[10px] font-semibold tabular" style={{ color: 'var(--text-muted)' }}>
                    {devTotal.toLocaleString('id')} sesi
                  </span>
                </div>
                <p className="text-xl font-extrabold tabular leading-tight mb-2" style={{ color: 'var(--text-primary)' }}>
                  {mPct}% <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>mobile</span>
                </p>
                <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--border-2)' }}>
                  <div style={{ width: `${mPct}%`, background: '#0284C7' }} />
                  <div style={{ width: `${dPct}%`, background: '#7C3AED' }} />
                </div>
                <p className="text-[11px] font-semibold mt-1.5" style={{ color: 'var(--text-muted)' }}>Perangkat</p>
              </div>
            </div>

            {/* Pageview trend */}
            {ws.daily.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tren Pageview {webRange} Hari</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Kunjungan halaman per hari</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="badge" style={{ background: '#EFF6FF', color: '#0284C7' }}>
                      Hari ini: {todayViews}
                    </span>
                    <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                      Rata-rata: {avgViews}/hari
                    </span>
                  </div>
                </div>
                <PageviewChart data={ws.daily} />
              </div>
            )}

            {/* Top pages */}
            {ws.topPages.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <span>🔥</span>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Halaman Terpopuler</p>
                </div>
                <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                  {ws.topPages.slice(0, 5).map((p, i) => {
                    const top = ws.topPages[0].visitors;
                    const pct = Math.round((p.visitors / top) * 100);
                    return (
                      <div key={i} className="px-5 py-3.5 flex items-center gap-3">
                        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                          style={{ background: i === 0 ? 'var(--accent-bg)' : 'var(--surface-2)', color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                            {pageLabel(p.path)}
                          </p>
                          <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: 'var(--border-2)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#0284C7' }} />
                          </div>
                        </div>
                        <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                          {p.visitors.toLocaleString('id')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Menu & Kategori terbanyak diklik */}
            {(ws.topMenu.length > 0 || ws.topCategories.length > 0) && (
              <div className="grid lg:grid-cols-2 gap-4">
                {ws.topMenu.length > 0 && (
                  <div className="card p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: '#EFF6FF', color: '#0EA5E9' }}>
                        <MousePointerClick size={15} />
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Menu Paling Banyak Diklik</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik navigasi {webRange} hari terakhir</p>
                      </div>
                    </div>
                    <TopListChart
                      color="#0EA5E9"
                      items={ws.topMenu.slice(0, 6).map(m => ({ label: pageLabel(m.path), value: m.count }))}
                    />
                  </div>
                )}

                {ws.topCategories.length > 0 && (
                  <div className="card p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        <Tag size={15} />
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Kategori Terpopuler</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik filter kategori produk</p>
                      </div>
                    </div>
                    <TopListChart
                      color="var(--accent)"
                      items={ws.topCategories.map(c => ({ label: c.name, value: c.count, emoji: c.emoji }))}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Produk terbanyak diklik */}
            {ws.topProducts.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: '#FEF2F2', color: 'var(--accent)' }}>
                    <ShoppingCart size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Produk Paling Banyak Diklik</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik kartu produk · label menunjukkan yang ditambah ke keranjang</p>
                  </div>
                </div>
                <TopListChart
                  color="var(--accent)"
                  items={ws.topProducts.slice(0, 6).map(p => ({
                    label: p.name,
                    value: p.clicks,
                    emoji: p.emoji,
                    sub: p.addToCart > 0 ? `🛒${p.addToCart}` : undefined,
                  }))}
                />
              </div>
            )}
          </>
        );
      })()}
      </div>
      )}

      {dashSubView === 'analitik-bisnis' && (
        <BusinessAnalyticsSection
          data={bizData}
          loading={bizLoading}
          period={bizPeriod}
          customFrom={bizCustomFrom}
          customTo={bizCustomTo}
          onPeriodChange={setBizPeriod}
          onCustomFromChange={setBizCustomFrom}
          onCustomToChange={setBizCustomTo}
          onNavigateFinance={() => setActiveTab('finance-report')}
        />
      )}

      {dashSubView === 'analitik-mitra' && (
        <ConsignmentAnalyticsSection
          data={mitraData}
          loading={mitraLoading}
          period={mitraPeriod}
          customFrom={mitraCustomFrom}
          customTo={mitraCustomTo}
          onPeriodChange={setMitraPeriod}
          onCustomFromChange={setMitraCustomFrom}
          onCustomToChange={setMitraCustomTo}
          onNavigateLocation={() => setActiveTab('consignment')}
        />
      )}

    </div>
  );


  // ─── Main render ──────────────────────────────────────────
  const adminUsername = authUser?.username ?? 'Admin';
  // Lets the 5 RBAC-management tabs hide/disable actions the caller's own
  // role can't perform (e.g. a role with `roles:view` but not `roles:create`
  // shouldn't see a live "Tambah Role" button that only 403s on click) —
  // the API is still the real enforcement point, this is just UI polish.
  const can = (featureKey: string, action: Action) => superAdmin || permissions[featureKey]?.[action] === true;
  return (
    <>
    <AppShell
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onLogout={logout}
      onForceLogout={reason => setForceLogoutReason(reason)}
      hasCart={posCartCount > 0}
      cartCount={posCartCount}
      username={adminUsername}
      superAdmin={superAdmin}
      creds={creds}
      role={authUser?.role}
      email={authUser?.email ?? null}
      avatar={authUser?.avatar ?? null}
      onProfileUpdated={patch => setAuthUser(u => u ? { ...u, ...patch } : u)}
      modules={modules}
      menus={menus}
      badges={{ orders: newOrdersCount }}
      onOpenNotification={handleOpenNotification}
    >
      {activeTab === 'dashboard'  && dashboardContent}
      <PosTab
        creds={creds}
        posProducts={posProducts}
        posProductsLoading={loading}
        posCategories={posCategories}
        resellerList={resellerList}
        customerList={customerList}
        bankOptions={bankOptions}
        isActive={activeTab === 'pos'}
        username={adminUsername}
        onCartChange={setPosCartCount}
        onGoToOrders={() => setActiveTab('orders')}
        onRefresh={() => fetchDash()}
        onRefreshStock={refreshPosStock}
      />
      {activeTab === 'products'   && <ProductsTab   creds={creds} />}
      {activeTab === 'categories' && <CategoriesTab creds={creds} />}
      {activeTab === 'orders'     && (
        <OrdersTab creds={creds} highlightInvoice={highlightInvoice} highlightOrderId={highlightOrderId}
          onHighlightHandled={() => { setHighlightInvoice(null); setHighlightOrderId(null); }}
          onNewOrdersCountChange={setNewOrdersCount} />
      )}
      {activeTab === 'resellers'  && <ResellersTab creds={creds} />}
      {activeTab === 'customers'  && <CustomersTab creds={creds} />}
      {activeTab === 'storefront-customers' && <StorefrontCustomersTab creds={creds} />}
      {activeTab === 'reviews'    && <ReviewsTab creds={creds} />}
      {activeTab === 'stock'      && <StockTab     creds={creds} products={posProducts} categories={posCategories} />}
      {activeTab === 'stock-report' && <StockReportTab creds={creds} products={posProducts} categories={posCategories} />}
      {activeTab === 'suppliers'  && <SuppliersTab  creds={creds} />}
      {activeTab === 'materials'  && (
        <MaterialsTab creds={creds} highlightMaterialId={highlightMaterialId}
          onHighlightHandled={() => setHighlightMaterialId(null)} />
      )}
      {activeTab === 'production' && <ProductionTab creds={creds} products={posProducts} />}
      {activeTab === 'consignment' && (
        <ConsignmentTab creds={creds} products={posProducts}
          highlightShipmentId={highlightShipmentId} highlightRecapId={highlightRecapId}
          onHighlightHandled={() => { setHighlightShipmentId(null); setHighlightRecapId(null); }} />
      )}
      {activeTab === 'income'     && <IncomeTab     creds={creds} />}
      {activeTab === 'expenses'   && <ExpensesTab   creds={creds} />}
      {activeTab === 'capital'    && <CapitalTab    creds={creds} />}
      {activeTab === 'wallets'    && <WalletsTab    creds={creds} />}
      {activeTab === 'finance-report' && (
        <FinanceReportTab creds={creds}
          onOpenOrder={invoiceNo => { setHighlightInvoice(invoiceNo); setActiveTab('orders'); }} />
      )}
      {activeTab === 'product-report' && <ProductReportTab creds={creds} />}
      {activeTab === 'settings'   && <SettingsTab  creds={creds} />}
      {activeTab === 'users'      && <UsersTab     creds={creds} currentUsername={adminUsername} can={(a: Action) => can('users', a)} />}
      {activeTab === 'roles'      && <RolesTab     creds={creds} can={(a: Action) => can('roles', a)} />}
      {activeTab === 'modules'    && <ModulesTab   creds={creds} can={(a: Action) => can('modules', a)} onChanged={() => fetchNav(creds)} />}
      {activeTab === 'menus'      && <MenusTab     creds={creds} can={(a: Action) => can('menus', a)} onChanged={() => fetchNav(creds)} />}
      {activeTab === 'role-permissions' && <RolePermissionsTab creds={creds} can={(a: Action) => can('role-permissions', a)} />}
      {activeTab === 'history'    && <HistoryTab   creds={creds} />}
      {activeTab === 'admin-fee' && superAdmin && <AdminFeeTab creds={creds} />}
      {activeTab === 'tagihan-admin-fee' && authUser?.role === 'admin' && <AdminFeeBillingTab creds={creds} />}
      {activeTab === 'notifications' && (
        <NotificationsTab creds={creds} username={adminUsername} onOpenNotification={handleOpenNotification} />
      )}
    </AppShell>
    {forceLogoutReason && (
      <ForceLogoutOverlay
        reason={forceLogoutReason}
        onDismiss={() => { setForceLogoutReason(null); logout(); }}
      />
    )}
    </>
  );
}
