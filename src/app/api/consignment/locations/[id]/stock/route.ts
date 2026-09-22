import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

// Daftar produk yang punya stok titip di lokasi ini — dipakai form Rekap Harian & ringkasan nilai stok per lokasi.
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const { id: locationId } = await ctx.params;
  const sql = getSql();
  const rows = await sql`
    select location_id as "locationId", product_id as "productId", variant_id as "variantId", product_name as "productName",
      stock_qty as "stockQty", harga_titip as "hargaTitip"
    from consignment_stock where location_id = ${locationId} and stock_qty > 0
    order by product_name
  `;
  const stock = rows.map(r => ({ ...r, stockQty: Number(r.stockQty), hargaTitip: Number(r.hargaTitip) }));
  return Response.json({ stock });
}
