import type { Action } from '@/types/rbac';

export interface FeatureKeyDef {
  key: string;
  label: string;
  actions: Action[];
}

const CRUD: Action[] = ['view', 'create', 'edit', 'delete'];

// Single source of truth for every permission scope in the app. Used by:
// route guards (src/lib/rbac.ts), the Struktur Menu featureKey picker,
// and the Hak Akses Role matrix.
export const FEATURE_KEYS: FeatureKeyDef[] = [
  { key: 'dashboard',       label: 'Analitik',           actions: ['view'] },
  { key: 'pos',              label: 'Kasir',              actions: ['view', 'create'] },
  { key: 'orders',           label: 'Pesanan',            actions: CRUD },
  { key: 'products',         label: 'Produk',             actions: CRUD },
  { key: 'categories',       label: 'Kategori',           actions: CRUD },
  { key: 'resellers',        label: 'Reseller',           actions: CRUD },
  { key: 'customers',        label: 'Pelanggan',          actions: CRUD },
  { key: 'storefront-customers', label: 'Akun Storefront', actions: ['view', 'delete'] },
  { key: 'reviews',          label: 'Ulasan',             actions: ['view', 'edit', 'delete'] },
  { key: 'consignment',      label: 'Mitra',              actions: CRUD },
  { key: 'consignment-in',   label: 'Titip Jual',        actions: CRUD },
  { key: 'income',           label: 'Pemasukan',          actions: CRUD },
  { key: 'expenses',         label: 'Pengeluaran',        actions: CRUD },
  { key: 'capital',          label: 'Modal & Prive',      actions: CRUD },
  { key: 'wallets',          label: 'Dompet',             actions: CRUD },
  { key: 'finance-report',   label: 'Laporan Keuangan',   actions: ['view'] },
  { key: 'product-report',   label: 'Laporan Produk',     actions: ['view'] },
  { key: 'stock',            label: 'Gudang',             actions: ['view', 'edit'] },
  { key: 'materials',        label: 'Bahan Baku',         actions: CRUD },
  { key: 'suppliers',        label: 'Supplier',           actions: CRUD },
  { key: 'production',       label: 'Produksi',           actions: CRUD },
  { key: 'stock-report',     label: 'Laporan Stok',       actions: ['view'] },
  { key: 'settings',         label: 'Pengaturan',         actions: CRUD },
  { key: 'users',            label: 'Pengguna',           actions: CRUD },
  { key: 'roles',            label: 'Role',               actions: CRUD },
  { key: 'modules',          label: 'Modul',              actions: CRUD },
  { key: 'menus',            label: 'Struktur Menu',      actions: CRUD },
  { key: 'role-permissions', label: 'Hak Akses Role',     actions: ['view', 'edit'] },
  { key: 'history',          label: 'Riwayat',            actions: ['view'] },
  { key: 'notifications',    label: 'Notifikasi',         actions: ['view'] },
];

export const FEATURE_KEY_SET = new Set(FEATURE_KEYS.map(f => f.key));

export function getFeatureKeyDef(key: string): FeatureKeyDef | undefined {
  return FEATURE_KEYS.find(f => f.key === key);
}

export function permissionCell(actions: Action[]): Partial<Record<Action, boolean>> {
  const cell: Partial<Record<Action, boolean>> = {};
  for (const a of actions) cell[a] = true;
  return cell;
}

// Full access to every action every featureKey supports — what `super-admin`
// resolves to (computed, not stored) and what `admin` is seeded with.
export function fullAccessPermissions(): Record<string, Partial<Record<Action, boolean>>> {
  const perms: Record<string, Partial<Record<Action, boolean>>> = {};
  for (const f of FEATURE_KEYS) perms[f.key] = permissionCell(f.actions);
  return perms;
}

// RBAC-management scopes — kept together for bootstrap/seed role-permission decisions:
// 'admin' role is granted full access to these too (matching the full access every
// existing user already has today), 'super-admin' is additionally a hardcoded bypass
// regardless of what these rows say.
export const RBAC_MANAGEMENT_KEYS = ['users', 'roles', 'modules', 'menus', 'role-permissions'];

// Confirmed cross-feature reads: these API routes are consumed by more than
// one tab, so requirePermission is called with an array (OR semantics) —
// the caller needs `view` on ANY one of the listed keys, not all of them.
export const CONSIGNMENT_RECAP_VIEW_KEYS = ['consignment', 'income', 'finance-report'];
export const WAREHOUSES_LIST_VIEW_KEYS = ['settings', 'stock', 'production', 'stock-report', 'consignment', 'consignment-in'];

// Seed-time convention (not enforced in code): a role granted dashboard:view
// should also get view on these, or dashboard sections silently render as
// zero because their underlying fetches 403 and get swallowed as "no data".
export const DASHBOARD_IMPLIED_VIEW_KEYS = ['products', 'orders', 'resellers', 'customers', 'materials'];
