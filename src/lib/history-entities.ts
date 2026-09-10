// Semua nilai `entity` yang benar-benar dipakai oleh writeHistoryEntry/logHistory di seluruh
// route API (lihat src/lib/history.ts). Dipisah dari FEATURE_KEYS (src/lib/permissions.ts) karena
// tidak semua entity di sini punya scope permission sendiri — mis. `material-purchases` digerbangi
// featureKey 'materials', `warehouses` digerbangi 'settings'. Client-safe (tidak ada import server-only).
export const HISTORY_ENTITIES: { key: string; label: string }[] = [
  { key: 'orders',              label: 'Pesanan' },
  { key: 'production',          label: 'Produksi' },
  { key: 'material-purchases',  label: 'Pembelian Bahan' },
  { key: 'materials',           label: 'Bahan Baku' },
  { key: 'consignment',         label: 'Konsinyasi' },
  { key: 'consignment-in',      label: 'Titip Jual' },
  { key: 'stock',                label: 'Stok' },
  { key: 'warehouses',           label: 'Gudang' },
  { key: 'pos',                  label: 'Kasir' },
  { key: 'capital',              label: 'Modal & Prive' },
  { key: 'income',               label: 'Pemasukan' },
  { key: 'expenses',             label: 'Pengeluaran' },
];

export function historyEntityLabel(key: string): string {
  return HISTORY_ENTITIES.find(e => e.key === key)?.label ?? key;
}
