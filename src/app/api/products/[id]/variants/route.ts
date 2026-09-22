import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';
import { rowToVariant, variantPatchFromBody, type ProductVariantRow } from '@/lib/product-variants-pg';

type Ctx = { params: Promise<{ id: string }> };

// Tambah satu varian ke produk yang sudah ada (produk harus disimpan dulu sebelum bisa punya
// varian — lihat catatan di ProductsTab.tsx). Stok varian tidak diterima di sini (lihat catatan
// stockQty di product-variants-pg.ts) — dimulai dari 0, diisi lewat menu Stok di fase berikutnya.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { id: productId } = await ctx.params;
  const sql = getSql();

  const [product] = await sql<{ id: string }[]>`select id from products where id = ${productId}`;
  if (!product) return Response.json({ error: 'Produk tidak ditemukan' }, { status: 404 });

  const data = await req.json() as Record<string, unknown>;
  delete data.stockQty;
  const patch = variantPatchFromBody(data);
  const id = randomUUID();

  const [row] = await sql<ProductVariantRow[]>`
    insert into product_variants ${sql({ id, product_id: productId, ...patch, created_at: new Date(), updated_at: new Date() })}
    returning *
  `;
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json(rowToVariant(row));
}
