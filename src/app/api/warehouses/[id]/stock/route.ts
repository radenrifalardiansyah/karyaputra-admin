import { NextRequest, after } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg, stockKey } from '@/lib/stock-pg';
import { revalidateStorefront } from '@/lib/revalidate';
import { parseJsonb } from '@/lib/db';
import { variantOptionsLabel } from '@/lib/pos-types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const { id: warehouseId } = await ctx.params;
  const sql = getSql();

  // Ambil warehouse_stock untuk gudang ini — hanya produk/varian yang benar-benar punya stok di
  // sini. Nama produk (& label varian, kalau ada) diambil langsung dari products/product_variants
  // (JOIN) supaya selalu yang terbaru (bisa berubah setelah dicatat di warehouse_stock), dengan
  // fallback ke nama yang tersimpan di warehouse_stock sendiri kalau produk/variannya sudah dihapus.
  const rows = await sql<{ product_id: string; variant_id: string | null; product_name: string | null; stock_qty: string; name: string | null; options: unknown }[]>`
    select ws.product_id, ws.variant_id, ws.product_name, ws.stock_qty, p.name, pv.options
    from warehouse_stock ws
    left join products p on p.id = ws.product_id
    left join product_variants pv on pv.id = ws.variant_id
    where ws.warehouse_id = ${warehouseId} and ws.stock_qty > 0
  `;

  const stocks = rows
    .map(r => {
      const variantLabel = r.variant_id ? variantOptionsLabel(parseJsonb<Record<string, string>>(r.options as Record<string, string> | string | null) ?? {}) : '';
      const productName = r.name ? (variantLabel ? `${r.name} — ${variantLabel}` : r.name) : (r.product_name ?? '');
      return {
        productId: r.product_id,
        variantId: r.variant_id,
        productName,
        stockQty: Number(r.stock_qty) || 0,
      };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName));

  return Response.json({ stocks });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id: warehouseId } = await ctx.params;
  const data = await req.json() as {
    productId: string;
    variantId?: string;
    productName: string;
    warehouseName?: string;
    type: 'in' | 'out';
    qty: number;
    note?: string;
  };

  const { productId, variantId, warehouseName, type, qty, note } = data;
  if (!productId || !type || !qty || qty <= 0) {
    return Response.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const sql = getSql();
  const delta = type === 'in' ? qty : -qty;
  const key = stockKey(productId, variantId);

  try {
    await sql.begin(async pgTx => {
      const { products, shortages } = await readProductsForDeltasPg(pgTx, new Map([[key, delta]]));
      if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

      const product = products.get(key)!;
      await applyStockDeltaPg(pgTx, { product, warehouseId, delta });
      await writeStockLedgerEntryPg(pgTx, {
        productId: product.id, variantId: product.variantId, productName: product.name, warehouseId, warehouseName, type, qty, note: note ?? '',
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mencatat transaksi stok.' }, { status: 400 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
