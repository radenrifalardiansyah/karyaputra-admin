import { parseJsonb } from '@/lib/db';

// Varian produk (Fase 1 dari rencana "Varian Produk" — 1 produk bisa punya beberapa varian
// rasa/ukuran, masing-masing dengan harga/HPP sendiri). Sama pola dengan products-pg.ts:
// COLUMN_MAP camelCase -> snake_case + rowToVariant/variantPatchFromBody.
//
// `stockQty` SENGAJA tidak ada di COLUMN_MAP — sama seperti products.stockQty, stok varian nanti
// hanya boleh berubah lewat endpoint stok (menyusul di fase berikutnya), bukan lewat form ini.
const COLUMN_MAP: Record<string, string> = {
  options: 'options', sku: 'sku', price: 'price', costPrice: 'cost_price',
  originalPrice: 'original_price', minStock: 'min_stock', imageUrl: 'image_url',
  sortOrder: 'sort_order', isActive: 'is_active',
};
const JSONB_FIELDS = new Set(['options']);

export interface ProductVariantRow {
  id: string; product_id: string; options: unknown; sku: string | null;
  price: string; cost_price: string; original_price: string | null;
  stock_qty: string; min_stock: string | null; image_url: string | null;
  sort_order: number; is_active: boolean;
  created_at: Date; updated_at: Date | null;
}

export function rowToVariant(row: ProductVariantRow): Record<string, unknown> {
  return {
    id: row.id,
    productId: row.product_id,
    options: parseJsonb(row.options) ?? {},
    sku: row.sku ?? '',
    price: row.price != null ? Number(row.price) : 0,
    costPrice: row.cost_price != null ? Number(row.cost_price) : 0,
    originalPrice: row.original_price != null ? Number(row.original_price) : null,
    stockQty: Number(row.stock_qty) || 0,
    minStock: row.min_stock != null ? Number(row.min_stock) : 0,
    imageUrl: row.image_url ?? '',
    sortOrder: row.sort_order ?? 0,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

export function variantPatchFromBody(data: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [camelKey, column] of Object.entries(COLUMN_MAP)) {
    if (!(camelKey in data)) continue;
    const value = data[camelKey];
    patch[column] = JSONB_FIELDS.has(camelKey) ? JSON.stringify(value ?? null) : value;
  }
  return patch;
}
