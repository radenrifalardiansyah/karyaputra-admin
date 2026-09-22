import type { PosProduct } from '@/lib/pos-types';

/** Resolves a scanned QR value (default = product detail URL, e.g. ".../products/{id}") to a product id. */
export function resolveScannedProductId(text: string, products: PosProduct[]): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/products\/([^/?#]+)/);
  const candidateId = match ? decodeURIComponent(match[1]) : trimmed;
  return products.find(p => p.id === candidateId)?.id ?? null;
}

/** Fallback untuk produk yang punya varian: kalau teks yang di-scan bukan QR/id produk (dicoba
 * lebih dulu lewat resolveScannedProductId), coba cocokkan sebagai kode SKU salah satu variannya —
 * dipakai untuk barcode fisik per-varian (bukan QR produk yang dibuat toko). */
export function resolveScannedVariant(text: string, products: PosProduct[]): { productId: string; variantId: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const p of products) {
    const variant = p.variants?.find(v => v.sku && v.sku.trim() === trimmed);
    if (variant) return { productId: p.id, variantId: variant.id };
  }
  return null;
}
