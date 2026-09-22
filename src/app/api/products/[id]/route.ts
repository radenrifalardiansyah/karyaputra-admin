import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { getAuthUser } from '@/lib/admin-auth';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';
import { rowToProduct, productPatchFromBody, type ProductRow } from '@/lib/products-pg';
import { rowToVariant, type ProductVariantRow } from '@/lib/product-variants-pg';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [row] = await sql<ProductRow[]>`select * from products where id = ${id}`;
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
  const variantRows = await sql<ProductVariantRow[]>`select * from product_variants where product_id = ${id} order by sort_order`;
  return Response.json({ ...rowToProduct(row), variants: variantRows.map(rowToVariant) });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  // Stok tidak boleh diubah lewat endpoint ini (harus lewat /api/stock/* atau
  // /api/warehouses/*/stock, yang menjaga products.stockQty & warehouse_stock tetap sinkron).
  delete data.stockQty;
  delete data.stock;

  const sql = getSql();
  const patch = productPatchFromBody(data);
  if (Object.keys(patch).length === 0) return Response.json({ ok: true });

  // Catat riwayat perubahan harga jual (audit trail) supaya kalau ada transaksi dengan harga
  // yang beda dari harga sekarang, bisa ditelusuri siapa & kapan harga produk ini pernah diubah
  // — tanpa perlu mengubah alur update produk yang lain.
  if (typeof data.price === 'number') {
    const [before] = await sql<{ price: string | null; name: string | null }[]>`select price, name from products where id = ${id}`;
    const oldPrice = before?.price != null ? Number(before.price) : undefined;
    if (typeof oldPrice === 'number' && oldPrice !== data.price) {
      await sql`
        insert into price_history (id, product_id, product_name, old_price, new_price, changed_by, created_at)
        values (${randomUUID()}, ${id}, ${before?.name ?? ''}, ${oldPrice}, ${data.price}, ${getAuthUser(req)?.username ?? ''}, now())
      `;
    }
  }

  await sql`update products set ${sql(patch)}, updated_at = now() where id = ${id}`;
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();

  try {
    await sql`delete from products where id = ${id}`;
  } catch (err) {
    // FK ke stock_ledger/warehouse_stock/consignment_stock sengaja TIDAK cascade — produk yang
    // sudah punya riwayat stok/transaksi tidak boleh hilang begitu saja (merusak jejak audit &
    // laporan). Nonaktifkan (unpublish) adalah alternatif yang aman untuk kasus ini.
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
      return Response.json({
        error: 'Tidak bisa dihapus — produk ini sudah punya riwayat stok/transaksi. Nonaktifkan (unpublish) saja daripada dihapus.',
      }, { status: 400 });
    }
    throw err;
  }
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
