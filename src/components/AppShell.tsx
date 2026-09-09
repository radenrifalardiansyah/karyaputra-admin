'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import { getToken } from 'firebase/messaging';
import {
  ChevronDown, MoreHorizontal, PanelLeftClose, PanelLeftOpen, LogOut, Home, Info, UserCog, Landmark, Receipt, Search,
} from 'lucide-react';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import AboutModal from '@/components/AboutModal';
import EditProfileModal from '@/components/EditProfileModal';
import ChatWidget, { type PendingLoginRequest } from '@/components/chat/ChatWidget';
import LoginRequestWatcher from '@/components/LoginRequestWatcher';
import NotificationBell, { type NotificationDoc } from '@/components/NotificationBell';
import { NotificationsProvider } from '@/components/NotificationsProvider';
import { resolveIcon } from '@/lib/icon-registry';
import { getClientMessaging } from '@/lib/firebase-client';
import { BRAND_NAME } from '@/lib/branding';
import type { ModuleDoc, MenuDoc } from '@/types/rbac';

// Notification.permission sudah 'granted' berarti device ini pernah getToken() lewat
// NotificationBell — panggil lagi di sini akan mengembalikan token yang SAMA (deterministik per
// device/service-worker), bukan minta izin baru, jadi aman dipanggil diam-diam saat logout.
async function unregisterPushToken(creds: string): Promise<void> {
  const messaging = await getClientMessaging();
  if (!messaging) return;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return;
  await fetch('/api/notifications/register-device', {
    method: 'DELETE',
    headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

// The 27 fixed screens the app actually has code for (19 original tabs + 5
// RBAC-management tabs + Riwayat + Akun Storefront + Ulasan). Struktur Menu / Modul only
// control label, icon, order, nesting, and active-state for the sidebar — not which screens
// exist — so this stays a closed union, just a bigger one than before.
// 'admin-fee' is intentionally NOT driven by ModuleDoc/MenuDoc like the rest — it's RMedia's own
// internal billing tool, hardcoded to render only for `superAdmin` below, bypassing Struktur
// Menu / Hak Akses Role entirely so it can never be granted to any other role.
// 'tagihan-admin-fee' is the mirror image for `role === 'admin'`: the read/pay side of the same
// Biaya Admin invoices, also hardcoded (not a MenuDoc) so it can't be granted to staff/kasir/finance.
// 'notifications' is a normal feature like the rest — register a MenuDoc for it via Struktur Menu
// so it appears in the sidebar, and grant roles access to it via Hak Akses Role like any other tab.
// 'storefront-customers'/'reviews' read the STOREFRONT app's own Firestore collections
// (storefront_customers, reviews) — separate from this app's 'customers' (manual CRM contacts).
export type TabId =
  | 'dashboard' | 'pos' | 'products' | 'categories' | 'orders' | 'resellers' | 'customers'
  | 'storefront-customers' | 'reviews'
  | 'stock' | 'stock-report' | 'materials' | 'suppliers' | 'production' | 'consignment' | 'income' | 'expenses'
  | 'finance-report' | 'product-report' | 'capital' | 'wallets' | 'settings'
  | 'users' | 'roles' | 'modules' | 'menus' | 'role-permissions' | 'history'
  | 'admin-fee' | 'tagihan-admin-fee' | 'notifications';

// `id: null` marks a folder — a menu that only groups children and has no screen/page of
// its own (see MenuDoc.featureKey). `key` is a stable identity for React keys and expand
// state, independent of `id` — needed because `id` can be null and non-unique across
// multiple folders, unlike the underlying menu row's own `id` (module_id/parent_id chains
// use the same "id" name in MenuDoc, so this is named `key` here to avoid confusion).
interface NavTab { key: string; id: TabId | null; label: string; Icon: LucideIcon; children?: NavTab[] }
interface NavGroup { id: string; label: string; Icon: LucideIcon; tabs: NavTab[] }

// Builds the sidebar tree from the dynamic `modules`/`menus` data (Struktur
// Menu / Modul) instead of a hardcoded array. `menus` is expected to already
// be permission-filtered by the caller (GET /api/menus) — AppShell just renders
// whatever it's given, sorted by `order`, nested one level via `parentId`.
function buildNavGroups(modules: ModuleDoc[], menus: MenuDoc[]): NavGroup[] {
  const toNavTab = (m: MenuDoc): NavTab => {
    const children = menus
      .filter(c => c.parentId === m.id)
      .sort((a, b) => a.order - b.order)
      .map(toNavTab);
    return {
      key: m.id,
      id: m.featureKey as TabId | null,
      label: m.label,
      Icon: resolveIcon(m.icon),
      children: children.length ? children : undefined,
    };
  };

  return modules
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(mod => ({
      id: mod.id,
      label: mod.name,
      Icon: resolveIcon(mod.icon),
      tabs: menus
        .filter(m => m.moduleId === mod.id && !m.parentId)
        .sort((a, b) => a.order - b.order)
        .map(toNavTab),
    }))
    .filter(g => g.tabs.length > 0);
}

// Folders (id === null) aren't real screens, so they're excluded from the flattened
// lists that drive the mobile bottom nav / "More" sheet / preferred-primary-tabs logic —
// only their (recursively) flattened children appear there, exactly as if those children
// were direct siblings. Desktop sidebar renders the tree as-is (see buildNavGroups) so
// folders still show up there as an expand/collapse-only header.
type ClickableTab = NavTab & { id: TabId };

function flattenClickable(tabs: NavTab[]): ClickableTab[] {
  return tabs.flatMap(t => {
    const rest = t.children ? flattenClickable(t.children) : [];
    return t.id === null ? rest : [{ ...t, id: t.id }, ...rest];
  });
}

// Preferred quick-access order for the mobile bottom nav; gracefully
// degrades to whatever's actually visible for a narrower role instead of
// assuming these 4 always exist.
const PREFERRED_PRIMARY_IDS: TabId[] = ['dashboard', 'pos', 'products', 'orders'];

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://karyaputra.vercel.app';

const SIDEBAR_BG   = 'var(--sidebar)';
const SIDEBAR_FULL = 256;
const SIDEBAR_MINI = 64;

interface AppShellProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  onLogout: () => void;
  onForceLogout: (reason: string) => void;
  hasCart: boolean;
  cartCount: number;
  children: React.ReactNode;
  topbarActions?: React.ReactNode;
  username?: string;
  superAdmin?: boolean;
  creds: string;
  role?: string;
  email?: string | null;
  avatar?: string | null;
  onProfileUpdated?: (patch: { email: string | null; avatar: string | null }) => void;
  modules: ModuleDoc[];
  menus: MenuDoc[];
  badges?: Partial<Record<TabId, number>>;
  onOpenNotification: (n: NotificationDoc) => void;
}

export default function AppShell({
  activeTab, setActiveTab, onLogout, onForceLogout,
  hasCart, cartCount, children, topbarActions,
  username = 'Admin', superAdmin = false, creds, role = '', email = null, avatar = null,
  onProfileUpdated, modules, menus, badges = {}, onOpenNotification,
}: AppShellProps) {
  const [moreOpen,   setMoreOpen]   = useState(false);
  const [moreQuery,  setMoreQuery]  = useState('');
  const [moreDragY,  setMoreDragY]  = useState(0);
  // Diisi dari heartbeat chat (lihat ChatWidget.tsx) — bukan poll sendiri, supaya tidak menambah
  // beban request/query di luar yang sudah ada.
  const [pendingLoginRequest, setPendingLoginRequest] = useState<PendingLoginRequest | null>(null);
  const moreDragStartY = useRef<number | null>(null);
  const moreDragging = useRef(false);
  const moreTouchedOnce = useRef(false);

  const handleMoreDragStart = (e: React.TouchEvent) => {
    moreDragStartY.current = e.touches[0].clientY;
    moreDragging.current = true;
    moreTouchedOnce.current = true;
  };
  const handleMoreDragMove = (e: React.TouchEvent) => {
    if (!moreDragging.current || moreDragStartY.current === null) return;
    const delta = e.touches[0].clientY - moreDragStartY.current;
    if (delta > 0) setMoreDragY(delta);
  };
  const handleMoreDragEnd = () => {
    if (moreDragY > 80) {
      setMoreOpen(false);
      setMoreQuery('');
    }
    setMoreDragY(0);
    moreDragStartY.current = null;
    moreDragging.current = false;
  };
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [aboutOpen,  setAboutOpen]  = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [collapsed,  setCollapsed]  = useState(false);
  // Maps a manually-toggled tab.key to the childActive value it had at toggle time,
  // so the override can be told apart from a stale one left behind by navigation
  // (see toggleExpanded / isExpanded below).
  const [expandedOverrides, setExpandedOverrides] = useState<Map<string, boolean>>(new Map());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const confirm = useConfirm();

  // Logo & nama brand diambil dari Pengaturan > Tampilan & Tema (settings.logo/adminAppName) —
  // sebelumnya sidebar/topbar/mobile nav hardcode ke /icon-192.png & "Cemilan Teh Risma", jadi
  // upload logo baru di Pengaturan tidak pernah terlihat di sini. Fallback ke BRAND_NAME kalau
  // belum pernah diisi.
  const [brandLogo, setBrandLogo] = useState<string | undefined>(undefined);
  const [brandName, setBrandName] = useState<string>(BRAND_NAME);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/settings', { headers: { 'x-admin-auth': creds } });
        if (!r.ok) return;
        const { settings } = await r.json() as { settings?: { logo?: string; adminAppName?: string; storeName?: string } };
        if (settings?.logo) setBrandLogo(settings.logo);
        setBrandName(settings?.adminAppName?.trim() || settings?.storeName?.trim() || BRAND_NAME);
      } catch { /* keep defaults */ }
    })();
  }, [creds]);

  const NAV_GROUPS  = buildNavGroups(modules, menus);
  const ALL_TABS     = NAV_GROUPS.flatMap(g => flattenClickable(g.tabs));
  const preferred     = PREFERRED_PRIMARY_IDS.map(id => ALL_TABS.find(t => t.id === id)).filter((t): t is ClickableTab => !!t);
  const rest           = ALL_TABS.filter(t => !preferred.includes(t));
  const PRIMARY_TABS  = [...preferred, ...rest].slice(0, Math.min(4, ALL_TABS.length));
  const primaryIds     = new Set(PRIMARY_TABS.map(t => t.id));
  const MORE_TABS      = ALL_TABS.filter(t => !primaryIds.has(t.id));

  // Pinned outside NAV_GROUPS on purpose — see the TabId comment above.
  const SUPER_ADMIN_TAB: ClickableTab | null = superAdmin ? { key: 'admin-fee', id: 'admin-fee', label: 'Biaya Admin', Icon: Landmark } : null;
  const ADMIN_BILLING_TAB: ClickableTab | null = role === 'admin' ? { key: 'tagihan-admin-fee', id: 'tagihan-admin-fee', label: 'Tagihan Biaya Admin', Icon: Receipt } : null;
  const PINNED_TAB = SUPER_ADMIN_TAB ?? ADMIN_BILLING_TAB;
  const MORE_TABS_DISPLAY = PINNED_TAB ? [...MORE_TABS, PINNED_TAB] : MORE_TABS;
  const filteredMoreTabs = moreQuery.trim()
    ? MORE_TABS_DISPLAY.filter(t => t.label.toLowerCase().includes(moreQuery.trim().toLowerCase()))
    : MORE_TABS_DISPLAY;

  // Desktop sidebar search — filters the nested NAV_GROUPS tree by label, keeping a
  // parent tab whenever it or any of its children match so results stay navigable.
  const sq = sidebarQuery.trim().toLowerCase();
  const isSidebarSearching = sq.length > 0;
  const filterNavTab = (tab: NavTab): NavTab | null => {
    if (tab.label.toLowerCase().includes(sq)) return tab;
    const children = tab.children?.map(filterNavTab).filter((c): c is NavTab => !!c);
    return children && children.length ? { ...tab, children } : null;
  };
  const SIDEBAR_GROUPS = isSidebarSearching
    ? NAV_GROUPS
        .map(g => ({ ...g, tabs: g.tabs.map(filterNavTab).filter((t): t is NavTab => !!t) }))
        .filter(g => g.tabs.length > 0)
    : NAV_GROUPS;
  const pinnedVisible = !!PINNED_TAB && (!isSidebarSearching || PINNED_TAB.label.toLowerCase().includes(sq));

  const handleLogout = async () => {
    if (await confirm({
      title: 'Konfirmasi Keluar',
      message: 'Yakin ingin keluar dari akun ini?',
      danger: true,
      confirmLabel: 'Keluar',
      // Ditunggu (bukan fire-and-forget) sebelum dialog menutup dan layar login muncul — kalau
      // tidak, ada race dengan login ulang yang cepat (mis. autofill+enter): request /api/login
      // bisa sempat jalan sebelum DELETE presence ini commit, jadi masih kebaca "aktif di
      // perangkat lain" dan disodori layar "Menunggu Persetujuan" lagi walau sudah logout duluan.
      onConfirm: async () => {
        await fetch('/api/logout', { method: 'POST', headers: { 'x-admin-auth': creds } }).catch(() => {});
      },
    })) {
      // Best-effort — kalau device ini pernah "Aktifkan notifikasi HP", cabut token FCM-nya
      // supaya perangkat (mis. kios/tablet yang dipakai bergantian) berhenti menerima push untuk
      // akun ini setelah logout. Tidak boleh menunda/menggagalkan logout kalau gagal.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        unregisterPushToken(creds).catch(() => {});
      }
      onLogout();
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('sb-collapsed');
    if (saved === 'true') setCollapsed(true);
    const savedGroups = localStorage.getItem('sb-group-collapsed');
    if (savedGroups) {
      try { setCollapsedGroups(new Set(JSON.parse(savedGroups))); } catch { /* ignore */ }
    }
  }, []);

  const toggleGroup = (label: string) => {
    setCollapsedGroups(s => {
      const next = new Set(s);
      next.has(label) ? next.delete(label) : next.add(label);
      localStorage.setItem('sb-group-collapsed', JSON.stringify([...next]));
      return next;
    });
  };

  const toggleCollapse = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem('sb-collapsed', String(next));
      return next;
    });
  };

  const currentTab   = ALL_TABS.find(t => t.id === activeTab) ?? (SUPER_ADMIN_TAB?.id === activeTab ? SUPER_ADMIN_TAB : undefined);
  const isMoreActive = MORE_TABS_DISPLAY.some(t => t.id === activeTab);
  const sw           = collapsed ? SIDEBAR_MINI : SIDEBAR_FULL;

  const go = (tab: TabId) => { setActiveTab(tab); setMoreOpen(false); setMoreQuery(''); };
  const toggleExpanded = (key: string, childActiveNow: boolean) =>
    setExpandedOverrides(m => {
      const n = new Map(m);
      n.has(key) ? n.delete(key) : n.set(key, childActiveNow);
      return n;
    });

  return (
    <NotificationsProvider creds={creds}>
    <div className="flex h-app-screen overflow-hidden" style={{ background: 'var(--ground)' }}>

      {/* ═══ Desktop Sidebar ═══════════════════════════════════ */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 h-full"
        style={{
          width: sw,
          minWidth: sw,
          background: SIDEBAR_BG,
          borderRight: '1px solid var(--sidebar-border)',
          boxShadow: '2px 0 16px rgba(0,0,0,0.18)',
          transition: 'width 0.26s cubic-bezier(0.4,0,0.2,1), min-width 0.26s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Brand */}
        <div
          className="flex-shrink-0 flex items-center px-3 pt-5 pb-4"
          style={{
            height: 72,
            borderBottom: '1px solid var(--sidebar-border)',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            paddingLeft: collapsed ? 0 : 16,
            transition: 'gap 0.26s, padding 0.26s',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Ambient glow */}
          <div style={{
            position: 'absolute', top: -28, left: -28,
            width: 150, height: 150, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(22,163,74,0.12) 0%, transparent 68%)',
            pointerEvents: 'none', zIndex: 0,
          }} />

          <div className="flex-shrink-0" style={{ zIndex: 1 }}>
            {brandLogo
              ? <img
                  src={brandLogo} alt="logo" width={34} height={34}
                  className="rounded-xl"
                  style={{ width: 34, height: 34, objectFit: 'cover', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
                />
              : <Image
                  src="/icon-192.png" alt="logo" width={34} height={34}
                  className="rounded-xl"
                  style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
                />}
          </div>
          {!collapsed && (
            <div className="min-w-0 overflow-hidden" style={{ zIndex: 1 }}>
              <p className="text-[13px] font-extrabold leading-tight truncate" style={{ color: 'var(--sidebar-text)' }}>
                {brandName}
              </p>
              <p className="text-[10px] mt-0.5 font-semibold truncate tracking-wide uppercase" style={{ color: 'var(--sidebar-muted)' }}>
                Admin Panel
              </p>
            </div>
          )}
        </div>

        {/* Sidebar menu search */}
        {!collapsed && (
          <div className="px-3 pt-3 pb-1 flex-shrink-0">
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--sidebar-muted)', pointerEvents: 'none' }} />
              <input
                value={sidebarQuery}
                onChange={e => setSidebarQuery(e.target.value)}
                placeholder="Cari menu…"
                className="w-full sidebar-search"
                style={{
                  height: 32, paddingLeft: 28, paddingRight: 8, borderRadius: 8,
                  background: 'var(--sidebar-hover)', border: '1px solid var(--sidebar-border)',
                  fontSize: 12, color: 'var(--sidebar-text)', outline: 'none',
                }}
              />
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: 'none' }}>
          {isSidebarSearching && SIDEBAR_GROUPS.length === 0 && !pinnedVisible && (
            <p className="text-center px-3" style={{ fontSize: 11, color: 'var(--sidebar-muted)', padding: '20px 0' }}>
              Menu tidak ditemukan
            </p>
          )}
          {SIDEBAR_GROUPS.map((group, gi) => {
            const groupCollapsed = !collapsed && !isSidebarSearching && collapsedGroups.has(group.label);
            return (
            <div key={group.id} className={gi > 0 ? 'mt-4' : ''}>
              {!collapsed && (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-3 mb-1.5"
                >
                  <span className="flex items-center gap-1.5">
                    <group.Icon size={12} style={{ color: 'var(--sidebar-muted)' }} />
                    <span
                      className="text-[9.5px] font-bold uppercase tracking-[0.1em] whitespace-nowrap"
                      style={{ color: 'var(--sidebar-muted)' }}
                    >
                      {group.label}
                    </span>
                  </span>
                  <ChevronDown
                    size={11}
                    style={{
                      color: 'var(--sidebar-muted)', transition: 'transform 0.15s',
                      transform: groupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}
                  />
                </button>
              )}
              {collapsed && gi > 0 && (
                <div className="mx-auto mb-2 w-6" style={{ height: 1, background: 'var(--sidebar-border)' }} />
              )}
              {!groupCollapsed && (
              <div className="space-y-0.5">
                {group.tabs.map(tab => {
                  const isFolder     = tab.id === null;
                  const isActive     = !isFolder && activeTab === tab.id;
                  const hasChildren  = !!tab.children?.length;
                  const childActive  = tab.children?.some(c => c.id === activeTab) ?? false;
                  // expandedOverrides stores which tabs were manually toggled AWAY from their
                  // default open/closed state (default = open only while a child is the active
                  // page), tagged with the childActive value at the moment of the toggle. If
                  // childActive has since changed (e.g. the user clicked into one of this tab's
                  // own children after manually opening it), the override is stale and ignored —
                  // otherwise clicking a sub-menu item would flip childActive without updating the
                  // override, making the parent collapse right as its own child becomes active.
                  const override    = expandedOverrides.get(tab.key);
                  const isOverridden = override !== undefined && override === childActive;
                  const isExpanded   = !collapsed && (isSidebarSearching || (isOverridden ? !childActive : childActive));
                  const navButton = (
                      <button
                        onClick={() => isFolder ? toggleExpanded(tab.key, childActive) : setActiveTab(tab.id!)}
                        className={`sidebar-nav-item w-full${isActive ? ' active' : ''}`}
                        style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                      >
                        <tab.Icon
                          size={17}
                          strokeWidth={isActive ? 2.2 : 1.7}
                          style={{ color: isActive ? 'var(--accent)' : 'var(--sidebar-muted)', flexShrink: 0 }}
                        />
                        {!collapsed && (
                          <span className="flex-1 text-left overflow-hidden whitespace-nowrap" style={{ color: isActive ? 'var(--accent)' : 'var(--sidebar-text)' }}>
                            {tab.label}
                          </span>
                        )}
                        {!collapsed && tab.id === 'pos' && hasCart && (
                          <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center flex-shrink-0">
                            {cartCount}
                          </span>
                        )}
                        {collapsed && tab.id === 'pos' && hasCart && (
                          <span
                            className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"
                          />
                        )}
                        {!collapsed && !isFolder && tab.id !== 'pos' && (badges[tab.id!] ?? 0) > 0 && (
                          <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center flex-shrink-0">
                            {badges[tab.id!]}
                          </span>
                        )}
                        {collapsed && !isFolder && tab.id !== 'pos' && (badges[tab.id!] ?? 0) > 0 && (
                          <span
                            className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"
                          />
                        )}
                        {!collapsed && hasChildren && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={e => { e.stopPropagation(); toggleExpanded(tab.key, childActive); }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleExpanded(tab.key, childActive); } }}
                            className="flex-shrink-0 p-0.5"
                          >
                            <ChevronDown
                              size={13}
                              style={{
                                color: 'var(--sidebar-muted)', transition: 'transform 0.15s',
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                              }}
                            />
                          </span>
                        )}
                      </button>
                  );
                  return (
                    <div key={tab.key}>
                      {collapsed
                        ? <Tooltip label={tab.label}>{navButton}</Tooltip>
                        : navButton}

                      {isExpanded && (
                        <div className="mt-0.5 space-y-0.5" style={{ paddingLeft: 29 }}>
                          {tab.children!.map(child => {
                            const childIsActive = child.id !== null && activeTab === child.id;
                            return (
                              <button
                                key={child.key}
                                onClick={() => child.id && setActiveTab(child.id)}
                                className={`sidebar-nav-item w-full${childIsActive ? ' active' : ''}`}
                                style={{ justifyContent: 'flex-start' }}
                              >
                                <child.Icon
                                  size={15}
                                  strokeWidth={childIsActive ? 2.2 : 1.7}
                                  style={{ color: childIsActive ? 'var(--accent)' : 'var(--sidebar-muted)', flexShrink: 0 }}
                                />
                                <span className="flex-1 text-left overflow-hidden whitespace-nowrap" style={{ color: childIsActive ? 'var(--accent)' : 'var(--sidebar-text)' }}>
                                  {child.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
            );
          })}

          {/* Super Admin / Tagihan — pinned, not part of Struktur Menu (see TabId comment) */}
          {pinnedVisible && PINNED_TAB && (
            <div className="mt-4">
              {!collapsed && (
                <div className="px-3 mb-1.5">
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] whitespace-nowrap" style={{ color: 'rgba(220,38,38,0.75)' }}>
                    {SUPER_ADMIN_TAB ? 'Super Admin' : 'Tagihan'}
                  </span>
                </div>
              )}
              {collapsed && (
                <div className="mx-auto mb-2 w-6" style={{ height: 1, background: 'var(--sidebar-border)' }} />
              )}
              <div className="space-y-0.5">
                {(() => {
                  const isActive = activeTab === PINNED_TAB.id;
                  const navButton = (
                    <button
                      onClick={() => setActiveTab(PINNED_TAB.id)}
                      className={`sidebar-nav-item w-full${isActive ? ' active' : ''}`}
                      style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                    >
                      <PINNED_TAB.Icon
                        size={17}
                        strokeWidth={isActive ? 2.2 : 1.7}
                        style={{ color: isActive ? 'var(--accent)' : 'var(--sidebar-muted)', flexShrink: 0 }}
                      />
                      {!collapsed && (
                        <span className="flex-1 text-left overflow-hidden whitespace-nowrap" style={{ color: isActive ? 'var(--accent)' : 'var(--sidebar-text)' }}>
                          {PINNED_TAB.label}
                        </span>
                      )}
                    </button>
                  );
                  return collapsed ? <Tooltip label={PINNED_TAB.label}>{navButton}</Tooltip> : navButton;
                })()}
              </div>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div
          className="flex-shrink-0 px-2 pb-4 pt-2"
          style={{ borderTop: '1px solid var(--sidebar-border)' }}
        >
          {/* Collapse toggle */}
          {(() => {
            const collapseButton = (
              <button
                onClick={toggleCollapse}
                className="sidebar-nav-item w-full mb-2"
                style={{ justifyContent: collapsed ? 'center' : 'flex-start', opacity: 0.7 }}
              >
                {collapsed
                  ? <PanelLeftOpen  size={14} style={{ color: 'var(--sidebar-muted)', flexShrink: 0 }} />
                  : <PanelLeftClose size={14} style={{ color: 'var(--sidebar-muted)', flexShrink: 0 }} />
                }
                {!collapsed && <span className="whitespace-nowrap text-xs" style={{ color: 'var(--sidebar-muted)' }}>Perkecil</span>}
              </button>
            );
            return collapsed
              ? <Tooltip label="Perlebar menu" side="top">{collapseButton}</Tooltip>
              : collapseButton;
          })()}

          {/* User card — expanded */}
          {!collapsed && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 10,
              background: 'var(--sidebar-hover)',
              border: '1px solid var(--sidebar-border)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Tooltip label="Edit profil" side="top">
                  <button
                    onClick={() => setProfileOpen(true)}
                    className="flex items-center w-full"
                    style={{ gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div className="relative" style={{ flexShrink: 0 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, overflow: 'hidden',
                        background: 'linear-gradient(135deg, var(--accent), #15803D)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: 'white',
                        boxShadow: '0 2px 6px rgba(22,163,74,0.30)',
                      }}>
                        {avatar
                          ? <img src={avatar} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : username[0].toUpperCase()}
                      </div>
                      <span
                        className="status-dot-blink absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2"
                        style={{ borderColor: 'var(--sidebar)' }}
                        title="Aktif"
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--sidebar-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                        {username}
                      </p>
                      <p style={{ fontSize: 10, color: 'var(--sidebar-muted)', lineHeight: 1.3 }}>{superAdmin ? 'Super Admin' : 'Administrator'}</p>
                    </div>
                  </button>
                </Tooltip>
              </div>
              <Tooltip label="Keluar" side="top">
                <button
                  onClick={handleLogout}
                  style={{
                    width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                    background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.28)',
                    color: '#F87171', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.24)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.14)')}
                >
                  <LogOut size={13} />
                </button>
              </Tooltip>
            </div>
          )}

          {/* User card — collapsed: logout icon */}
          {collapsed && (
            <Tooltip label="Keluar" side="top">
              <button
                onClick={handleLogout}
                className="sidebar-nav-item w-full mt-0.5"
                style={{ justifyContent: 'center' }}
              >
                <LogOut size={15} style={{ color: '#F87171', flexShrink: 0 }} />
              </button>
            </Tooltip>
          )}
        </div>
      </aside>

      {/* ═══ Main Area ═════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden"
        style={{ '--sidebar-w': `${sw}px` } as React.CSSProperties}>

        {/* Topbar */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-4 lg:px-6"
          style={{
            height: 'calc(60px + env(safe-area-inset-top))',
            paddingTop: 'env(safe-area-inset-top)',
            background: '#FFFFFF',
            borderBottom: '1.5px solid var(--border)',
            boxShadow: '0 4px 16px rgba(30,16,8,0.08)',
            position: 'relative',
            zIndex: 5,
          }}
        >
          <div className="flex items-center gap-3">
            {brandLogo
              ? <img src={brandLogo} alt="logo" style={{ width: 30, height: 30, objectFit: 'cover' }} className="rounded-xl flex-shrink-0 lg:hidden" />
              : <Image src="/icon-192.png" alt="logo" width={30} height={30} className="rounded-xl flex-shrink-0 lg:hidden" />}
            {/* Desktop: show collapse toggle only when fully collapsed and sidebar visible */}
            <div className="hidden lg:flex items-center gap-3">
              <div>
                <p className="text-[15px] font-extrabold leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {currentTab?.label ?? 'Dashboard'}
                </p>
                <p className="text-[11px] leading-tight mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {brandName} · Admin
                </p>
              </div>
            </div>
            <div className="lg:hidden">
              <p className="text-[15px] font-extrabold leading-tight" style={{ color: 'var(--text-primary)' }}>
                {currentTab?.label ?? 'Dashboard'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <div id="topbar-slot" className="flex items-center gap-1 sm:gap-2" />
            <NotificationBell creds={creds} username={username} onOpen={onOpenNotification} onViewAll={() => go('notifications')} />
            <a
              href={MAIN_APP} target="_blank" rel="noopener noreferrer"
              title="Lihat Toko"
              className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              <Home size={14} style={{ flexShrink: 0 }} />
              <span className="hidden sm:inline">Lihat Toko</span>
            </a>
            {topbarActions}
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto thin-scrollbar mobile-content-pad">
          {children}
        </main>
      </div>

      {/* ═══ Mobile Bottom Navigation ══════════════════════════ */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30"
        style={{
          background: 'var(--sidebar)',
          borderTop: '1px solid var(--sidebar-border)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.22)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex items-stretch h-16">
          {PRIMARY_TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => go(tab.id)}
                className="flex flex-col items-center justify-center gap-1 flex-1 relative pb-1"
              >
                <span className="relative">
                  <tab.Icon
                    size={21}
                    strokeWidth={isActive ? 2.2 : 1.6}
                    style={{ color: isActive ? 'var(--accent)' : 'var(--sidebar-muted)' }}
                  />
                  {tab.id === 'pos' && hasCart && (
                    <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                      {cartCount}
                    </span>
                  )}
                  {tab.id !== 'pos' && (badges[tab.id] ?? 0) > 0 && (
                    <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                      {badges[tab.id]}
                    </span>
                  )}
                </span>
                <span
                  className="text-[10px] leading-none font-semibold"
                  style={{ color: isActive ? 'var(--accent)' : 'var(--sidebar-muted)' }}
                >
                  {tab.label}
                </span>
                {isActive && (
                  <span
                    className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
              </button>
            );
          })}

          {/* More button */}
          {MORE_TABS_DISPLAY.length > 0 && (() => {
            const moreBadgeTotal = MORE_TABS_DISPLAY.reduce((s, t) => s + (badges[t.id] ?? 0), 0);
            return (
          <button
            onClick={() => { moreTouchedOnce.current = false; setMoreDragY(0); setMoreOpen(true); }}
            className="flex flex-col items-center justify-center gap-1 flex-1 relative pb-1"
            aria-label={isMoreActive ? (currentTab?.label ?? 'Lainnya') : 'Lainnya'}
          >
            <span className="relative">
            <MoreHorizontal
              size={21}
              strokeWidth={isMoreActive ? 2.2 : 1.6}
              style={{ color: isMoreActive ? 'var(--accent)' : 'var(--sidebar-muted)' }}
            />
            {moreBadgeTotal > 0 && (
              <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                {moreBadgeTotal}
              </span>
            )}
            </span>
            <span
              className="text-[10px] leading-none font-semibold"
              style={{ color: isMoreActive ? 'var(--accent)' : 'var(--sidebar-muted)' }}
            >
              {isMoreActive ? (currentTab?.label ?? 'Lainnya') : 'Lainnya'}
            </span>
            {isMoreActive && (
              <span
                className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            )}
          </button>
            );
          })()}
        </div>
      </nav>

      {/* ═══ More Bottom Sheet ═════════════════════════════════ */}
      {moreOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40"
            style={{ background: 'rgba(30,16,8,0.4)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            onClick={() => { setMoreOpen(false); setMoreQuery(''); }}
          />
          <div
            className={`lg:hidden fixed left-0 right-0 z-50 flex flex-col ${moreTouchedOnce.current ? '' : 'animate-slide-up'}`}
            style={{
              bottom: 0,
              maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 48px)',
              background: 'var(--surface)',
              borderRadius: '20px 20px 0 0',
              boxShadow: '0 -8px 40px rgba(30,16,8,0.14)',
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
              transform: moreDragY ? `translateY(${moreDragY}px)` : undefined,
              transition: moreDragging.current ? 'none' : 'transform 0.2s ease-out',
            }}
          >
            <div
              className="flex justify-center pt-3 pb-5 shrink-0"
              style={{ touchAction: 'none' }}
              onTouchStart={handleMoreDragStart}
              onTouchMove={handleMoreDragMove}
              onTouchEnd={handleMoreDragEnd}
            >
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>

            <div className="px-5 overflow-y-auto flex-1 min-h-0">
              <div style={{ position: 'relative', marginBottom: 14 }}>
                <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  value={moreQuery}
                  onChange={e => setMoreQuery(e.target.value)}
                  placeholder="Cari menu…"
                  className="w-full"
                  style={{
                    height: 40, paddingLeft: 36, paddingRight: 12, borderRadius: 12,
                    border: '1.5px solid var(--border)', background: 'var(--surface-2)',
                    fontSize: 13.5, color: 'var(--text-primary)', outline: 'none',
                  }}
                />
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--text-muted)' }}>
                Menu Lainnya
              </p>
              {filteredMoreTabs.length === 0 && (
                <p className="text-xs text-center" style={{ color: 'var(--text-muted)', padding: '20px 0' }}>
                  Menu tidak ditemukan
                </p>
              )}
              <div className="grid grid-cols-4 gap-3">
                {filteredMoreTabs.map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => go(tab.id)}
                      className="flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-2xl transition-all"
                      style={{
                        background: isActive ? 'var(--accent-bg)' : 'var(--surface-2)',
                        border: `1.5px solid ${isActive ? 'var(--accent-light)' : 'transparent'}`,
                      }}
                    >
                      <span className="relative">
                        <tab.Icon
                          size={22}
                          strokeWidth={isActive ? 2.5 : 1.8}
                          style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
                        />
                        {(badges[tab.id] ?? 0) > 0 && (
                          <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                            {badges[tab.id]}
                          </span>
                        )}
                      </span>
                      <span
                        className="text-[11px] font-semibold text-center leading-tight px-0.5"
                        style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
                      >
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 flex flex-col gap-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                <button
                  onClick={() => { setMoreOpen(false); setProfileOpen(true); }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                >
                  <UserCog size={20} strokeWidth={1.8} />
                  <span className="font-semibold text-sm">Edit Profil</span>
                </button>
                <button
                  onClick={() => { setMoreOpen(false); setAboutOpen(true); }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                >
                  <Info size={20} strokeWidth={1.8} />
                  <span className="font-semibold text-sm">Tentang Aplikasi</span>
                </button>
                <button
                  onClick={() => { setMoreOpen(false); handleLogout(); }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
                  style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
                >
                  <LogOut size={20} strokeWidth={1.8} />
                  <span className="font-semibold text-sm">Keluar</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {aboutOpen && <AboutModal creds={creds} onClose={() => setAboutOpen(false)} />}
      {profileOpen && (
        <EditProfileModal
          creds={creds}
          username={username}
          role={superAdmin ? 'Super Admin' : (role || 'Administrator')}
          email={email}
          avatar={avatar}
          onClose={() => setProfileOpen(false)}
          onSaved={patch => onProfileUpdated?.(patch)}
        />
      )}

      <ChatWidget
        username={username}
        creds={creds}
        avatar={avatar}
        canKick={superAdmin || role === 'admin'}
        onForceLogout={onForceLogout}
        onPendingLoginRequest={setPendingLoginRequest}
      />
      <LoginRequestWatcher
        request={pendingLoginRequest}
        creds={creds}
        onResolved={() => setPendingLoginRequest(null)}
      />
    </div>
    </NotificationsProvider>
  );
}
