import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { clearWarehouseProductStock } from '@/lib/warehouse-stock';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string; productId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const { id: warehouseId, productId } = await ctx.params;
  const sql = getSql();

  const rows = await sql`
    select id, product_id as "productId", variant_id as "variantId", product_name as "productName", warehouse_id as "warehouseId",
      warehouse_name as "warehouseName", type, qty, note, created_at as "createdAt"
    from stock_ledger
    where warehouse_id = ${warehouseId} and product_id = ${productId}
    order by created_at desc limit 50
  `;
  const entries = rows.map(r => ({ ...r, qty: Number(r.qty) }));
  return Response.json({ entries });
}

// Kosongkan stok produk (atau satu varian tertentu, lewat ?variantId=) ke 0 di gudang ini (mis.
// hasil stock opname)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id: warehouseId, productId } = await ctx.params;
  const variantId = new URL(req.url).searchParams.get('variantId') || undefined;
  const db = getDb();
  const sql = getSql();
  const wsId = variantId ? `${warehouseId}_${productId}_${variantId}` : `${warehouseId}_${productId}`;

  const [before] = await sql<{ product_name: string | null; stock_qty: string }[]>`
    select product_name, stock_qty from warehouse_stock where id = ${wsId}
  `;

  await clearWarehouseProductStock(warehouseId, productId, 'Kosongkan stok produk', variantId);

  try {
    await logHistory(db, {
      entity: 'stock',
      entityId: productId,
      entityLabel: before?.product_name ?? productId,
      action: 'delete',
      actor: guard,
      before: before ? { productName: before.product_name, stockQty: Number(before.stock_qty) } : null,
    });
  } catch {
    // audit log failure must never fail the business request
  }

  return Response.json({ ok: true });
}
