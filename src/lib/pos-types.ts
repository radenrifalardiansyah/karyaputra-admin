// Shared POS types/helpers — used by the Kasir tab (PosTab) and by page.tsx
// (which owns the fetch for these and also feeds StockTab/the dashboard).

export interface PosProduct {
  id: string; name: string; price: number; emoji: string;
  imageUrls: string[]; category: string; stock: string;
  bgColor: string; weight: string; badge?: string;
  stockQty?: number; openPO?: boolean; order?: number; costPrice?: number; published?: boolean; minStock?: number;
  // Kepemilikan "Titip Masuk" (konsinyasi masuk) — lihat plan snug-sparking-ocean.md.
  ownerType?: 'own' | 'consigned_in'; consignorId?: string | null;
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
