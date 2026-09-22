// Shared POS types/helpers — used by the Kasir tab (PosTab) and by page.tsx
// (which owns the fetch for these and also feeds StockTab/the dashboard).

export interface PosProductVariant {
  id: string; options: Record<string, string>; sku: string;
  price: number; costPrice: number; originalPrice: number | null;
  stockQty: number; minStock: number; isActive: boolean;
}

export interface PosProduct {
  id: string; name: string; price: number; emoji: string;
  imageUrls: string[]; category: string; stock: string;
  bgColor: string; weight: string; badge?: string;
  stockQty?: number; openPO?: boolean; order?: number; costPrice?: number; published?: boolean; minStock?: number;
  // Kepemilikan "Titip Masuk" (konsinyasi masuk) — lihat plan snug-sparking-ocean.md.
  ownerType?: 'own' | 'consigned_in'; consignorId?: string | null;
  // Varian (Rasa/Ukuran dst, masing-masing harga & stok sendiri) — lihat rencana "Varian Produk".
  hasVariants?: boolean; variantAttributes?: string[]; variants?: PosProductVariant[];
}

// Label tampilan varian dari kombinasi options-nya, mis. {Rasa: 'BBQ', Ukuran: '250g'} -> "BBQ / 250g".
export const variantOptionsLabel = (options: Record<string, string>): string =>
  Object.values(options).filter(Boolean).join(' / ');

// Harga & status stok produk untuk ditampilkan di kartu/keranjang Kasir — produk tanpa varian
// pakai field-nya sendiri seperti biasa; produk dengan varian diringkas dari varian yang aktif
// (products.stock_qty/price TIDAK dipelihara lagi untuk produk yang sudah py varian).
export function posProductDisplay(product: PosProduct): { price: number; maxPrice: number; stockQty: number; openPO: boolean } {
  if (product.hasVariants && product.variants && product.variants.length > 0) {
    const active = product.variants.filter(v => v.isActive);
    const prices = active.map(v => v.price);
    return {
      price: prices.length > 0 ? Math.min(...prices) : 0,
      maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
      stockQty: active.reduce((s, v) => s + v.stockQty, 0),
      openPO: product.openPO ?? false,
    };
  }
  return { price: product.price, maxPrice: product.price, stockQty: product.stockQty ?? 0, openPO: product.openPO ?? false };
}

export interface PosCategory_Entry { id: string; label: string; emoji: string }

export interface PosReseller { id: string; customerId?: string; name: string; phone: string; status: string }

export interface PosCustomer { id: string; name: string; phone: string }

export interface PosBank { id: string; code: string; name: string; bankCode?: string; logoUrl?: string }

export const POS_CAT_ALL: PosCategory_Entry = { id: 'semua', label: 'Semua', emoji: '🛍️' };

export const POS_STOCK_MAP = {
  ready:   { label: 'Tersedia', cls: 'badge-green' },
  habis:   { label: 'Habis',    cls: 'badge-red'   },
  open_po: { label: 'Open PO',  cls: 'badge-amber' },
};

export const posStockStatus = (p: Pick<PosProduct, 'stockQty' | 'openPO'>) =>
  p.openPO ? POS_STOCK_MAP.open_po : (p.stockQty ?? 0) > 0 ? POS_STOCK_MAP.ready : POS_STOCK_MAP.habis;
