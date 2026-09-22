import { NextRequest, after } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg, stockKey } from '@/lib/stock-pg';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ productId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'stock', 'view');
  if (guard instanceof Response) return guard;
  const { productId } = await ctx.params;
  const sql = getSql();
  const rows = await sql`
    select id, product_id as "productId", variant_id as "variantId", product_name as "productName", warehouse_id as "warehouseId",
      warehouse_name as "warehouseName", type, qty, note, created_at as "createdAt"
    from stock_ledger where product_id = ${productId} order by created_at desc
  `;
  const entries = rows.map(r => ({ ...r, qty: Number(r.qty) }));
  return Response.json({ entries });
}

// Koreksi stok tanpa gudang — dipakai saat stok keluar bukan berasal dari gudang tertentu
// (mis. selisih stok fisik). Tidak menyentuh `warehouse_stock`, hanya total global produk (atau
// total varian tertentu kalau `variantId` dikirim).
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'stock', 'create');
  if (guard instanceof Response) return guard;
  const { productId } = await ctx.params;
  const data = await req.json() as { productName?: string; variantId?: string; qty?: number; type?: 'in' | 'out'; note?: string };

  const qty = typeof data.qty === 'number' ? data.qty : 0;
  const type = data.type ?? 'out';
  if (!qty || qty <= 0) {
    return Response.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const sql = getSql();
  const delta = type === 'in' ? qty : -qty;
  const key = stockKey(productId, data.variantId);

  try {
    await sql.begin(async pgTx => {
      const { products, shortages } = await readProductsForDeltasPg(pgTx, new Map([[key, delta]]));
      if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

      const product = products.get(key)!;
      await applyStockDeltaPg(pgTx, { product, delta });
      await writeStockLedgerEntryPg(pgTx, {
        productId: product.id, variantId: product.variantId, productName: product.name, type, qty, note: data.note ?? '',
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mencatat koreksi stok.' }, { status: 400 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
