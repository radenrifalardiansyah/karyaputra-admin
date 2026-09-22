import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { clearWarehouseStockForProducts } from '@/lib/warehouse-stock';

type Ctx = { params: Promise<{ id: string }> };
interface WarehouseRow { id: string; name: string; location: string | null; description: string | null }

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [row] = await sql<WarehouseRow[]>`select id, name, location, description from warehouses where id = ${id}`;
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ warehouse: { id: row.id, name: row.name, location: row.location ?? '', description: row.description ?? '' } });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();

  const [before] = await sql<WarehouseRow[]>`select id, name, location, description from warehouses where id = ${id}`;

  const after = {
    name: data.name as string,
    location: (data.location as string) ?? '',
    description: (data.description as string) ?? '',
  };
  await sql`update warehouses set name = ${after.name}, location = ${after.location}, description = ${after.description}, updated_at = now() where id = ${id}`;

  try {
    await logHistory(db, {
      entity: 'warehouses',
      entityId: id,
      entityLabel: after.name ?? before?.name ?? id,
      action: 'update',
      actor: guard,
      before,
      after,
    });
  } catch {
    // audit log failure must never fail the business request
  }

  revalidateTag('admin-warehouses', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [before] = await sql<WarehouseRow[]>`select id, name, location, description from warehouses where id = ${id}`;

  // Kembalikan dulu stok tiap produk di gudang ini ke `products.stockQty` global SEBELUM baris
  // warehouse_stock-nya dihapus — kalau dihapus langsung tanpa lewat sini, stockQty global tetap
  // menghitung stok yang sudah tidak ada di gudang manapun (stok hantu).
  const stockRows = await sql<{ product_id: string; variant_id: string | null }[]>`select product_id, variant_id from warehouse_stock where warehouse_id = ${id} and stock_qty > 0`;
  const items = stockRows.map(r => ({ productId: r.product_id, variantId: r.variant_id }));
  const { cleared, failed } = await clearWarehouseStockForProducts(id, items, 'Gudang dihapus');
  // Kalau ada produk yang gagal dikembalikan stoknya, JANGAN lanjut menghapus gudang & baris
  // warehouse_stock-nya — produk yang sudah berhasil (`cleared`) tetap permanen ter-commit, tapi
  // menghapus gudang di titik ini akan mengorbankan sisanya jadi stok hantu lagi (masalah yang
  // justru sedang diperbaiki). Aman diulang: yang sudah cleared di-skip otomatis (no-op) di
  // percobaan hapus berikutnya.
  if (failed.length > 0) {
    return Response.json({
      error: `Gagal mengembalikan stok ${failed.length} produk sebelum menghapus gudang — coba hapus lagi. (${cleared.length} produk lain sudah berhasil dikembalikan.)`,
      failed,
    }, { status: 500 });
  }

  // Hapus dulu baris warehouse_stock gudang ini (sekarang sudah bernilai 0 lewat
  // clearWarehouseProductStock di atas, atau memang sudah 0 sebelumnya) SEBELUM menghapus
  // baris warehouses — urutan terbalik akan selalu gagal karena warehouse_stock masih
  // mereferensikan warehouse_id ini.
  await sql`delete from warehouse_stock where warehouse_id = ${id}`;

  try {
    await sql`delete from warehouses where id = ${id}`;
  } catch (err) {
    // FK ke stock_ledger/production_batches/orders/consignment_shipments sengaja TIDAK cascade —
    // gudang yang sudah punya riwayat mutasi stok/produksi/order/konsinyasi tidak boleh hilang
    // begitu saja (merusak jejak audit & laporan).
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
      return Response.json({
        error: 'Tidak bisa dihapus — gudang ini sudah punya riwayat mutasi stok, produksi, order, atau konsinyasi. Stok di gudang ini sudah dikosongkan, tapi gudangnya sendiri tidak bisa dihapus permanen.',
      }, { status: 400 });
    }
    throw err;
  }

  try {
    await logHistory(db, {
      entity: 'warehouses',
      entityId: id,
      entityLabel: before?.name ?? id,
      action: 'delete',
      actor: guard,
      before,
      meta: { clearedProductCount: cleared.length },
    });
  } catch {
    // audit log failure must never fail the business request
  }

  revalidateTag('admin-warehouses', { expire: 0 });
  return Response.json({ ok: true });
}
