import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';
import { rowToVariant, variantPatchFromBody, type ProductVariantRow } from '@/lib/product-variants-pg';

type Ctx = { params: Promise<{ id: string; variantId: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { id: productId, variantId } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  // Sama seperti products.stockQty — stok varian cuma boleh berubah lewat endpoint stok, bukan
  // lewat form kelola varian ini.
  delete data.stockQty;

  const sql = getSql();
  const patch = variantPatchFromBody(data);
  if (Object.keys(patch).length === 0) return Response.json({ ok: true });

  const [row] = await sql<ProductVariantRow[]>`
    update product_variants set ${sql(patch)}, updated_at = now()
    where id = ${variantId} and product_id = ${productId}
    returning *
  `;
  if (!row) return Response.json({ error: 'Varian tidak ditemukan' }, { status: 404 });
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json(rowToVariant(row));
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { id: productId, variantId } = await ctx.params;
  const sql = getSql();

  try {
    const [row] = await sql<{ id: string }[]>`delete from product_variants where id = ${variantId} and product_id = ${productId} returning id`;
    if (!row) return Response.json({ error: 'Varian tidak ditemukan' }, { status: 404 });
  } catch (err) {
    // FK RESTRICT dari warehouse_stock/stock_ledger/price_history/consignment_stock — sama alasan
    // dengan DELETE produk: varian yang sudah punya riwayat stok/transaksi tidak boleh hilang,
    // nonaktifkan (isActive = false) saja lewat PUT.
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
      return Response.json({
        error: 'Tidak bisa dihapus — varian ini sudah punya riwayat stok/transaksi. Nonaktifkan saja daripada dihapus.',
      }, { status: 400 });
    }
    throw err;
  }
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
