import { parseJsonb } from '@/lib/db';

// Versi Postgres dari koleksi Firestore `products` (Tahap 11 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md) — `rowToProduct`/`productPatchFromBody` menjaga bentuk JSON
// camelCase yang sama persis seperti dokumen Firestore lama supaya frontend (ProductsTab, POS,
// dsb) tidak perlu berubah sama sekali.

// camelCase (field lama di Firestore) -> nama kolom snake_case di Postgres.
const COLUMN_MAP: Record<string, string> = {
  name: 'name', description: 'description', details: 'details', code: 'code', category: 'category',
  price: 'price', originalPrice: 'original_price', costPrice: 'cost_price', weight: 'weight',
  emoji: 'emoji', imageUrls: 'image_urls', gradient: 'gradient', bgColor: 'bg_color', badge: 'badge',
  stockQty: 'stock_qty', stock: 'stock', openPO: 'open_po', minStock: 'min_stock',
  order: 'sort_order', published: 'published', qrUrl: 'qr_url',
  ownerType: 'owner_type', consignorId: 'consignor_id', settlementType: 'settlement_type',
  payoutPrice: 'payout_price', commissionPct: 'commission_pct',
};
const JSONB_FIELDS = new Set(['details', 'imageUrls']);

export interface ProductRow {
  id: string; name: string | null; description: string | null; details: unknown;
  code: string | null; category: string | null; price: string | null; original_price: string | null;
  cost_price: string | null; weight: string | null; emoji: string | null; image_urls: unknown;
  gradient: string | null; bg_color: string | null; badge: string | null;
  stock_qty: string; stock: string; open_po: boolean; min_stock: string;
  sort_order: number | null; published: boolean; qr_url: string | null;
  owner_type: string | null; consignor_id: string | null; settlement_type: string | null;
  payout_price: string | null; commission_pct: string | null;
  created_at: Date; updated_at: Date | null;
}

export function rowToProduct(row: ProductRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name ?? '',
    description: row.description ?? '',
    details: parseJsonb(row.details) ?? [''],
    code: row.code ?? '',
    category: row.category ?? '',
    price: row.price != null ? Number(row.price) : 0,
    originalPrice: row.original_price != null ? Number(row.original_price) : null,
    costPrice: row.cost_price != null ? Number(row.cost_price) : 0,
    weight: row.weight ?? '',
    emoji: row.emoji ?? '',
    imageUrls: parseJsonb(row.image_urls) ?? [],
    gradient: row.gradient ?? '',
    bgColor: row.bg_color ?? '',
    badge: row.badge ?? '',
    stockQty: Number(row.stock_qty) || 0,
    stock: row.stock,
    openPO: row.open_po,
    minStock: Number(row.min_stock) || 0,
    order: row.sort_order ?? 0,
    published: row.published,
    qrUrl: row.qr_url ?? '',
    ownerType: row.owner_type ?? 'own',
    consignorId: row.consignor_id ?? null,
    settlementType: row.settlement_type ?? null,
    payoutPrice: row.payout_price != null ? Number(row.payout_price) : null,
    commissionPct: row.commission_pct != null ? Number(row.commission_pct) : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

// Bangun object patch snake_case dari body request (camelCase) — dipakai untuk INSERT (create,
// kolom yang tidak dikirim jatuh ke default kolom) maupun UPDATE parsial (edit, cuma field yang
// benar-benar dikirim yang tersentuh — mis. PUT { costPrice } saja dari koreksi HPP manual).
export function productPatchFromBody(data: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [camelKey, column] of Object.entries(COLUMN_MAP)) {
    if (!(camelKey in data)) continue;
    const value = data[camelKey];
    patch[column] = JSONB_FIELDS.has(camelKey) ? JSON.stringify(value ?? null) : value;
  }
  return patch;
}
