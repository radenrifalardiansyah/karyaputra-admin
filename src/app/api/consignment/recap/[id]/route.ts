import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';
import { readProductsForDeltasPg, applyStockDeltaPg, applyStockCostPg, writeStockLedgerEntryPg, stockKey, warehouseStockKey } from '@/lib/stock-pg';
import { rowToRecap, type RecapRow } from '@/lib/recaps-pg';

type Ctx = { params: Promise<{ id: string }> };
interface RecapItem { productId: string; variantId?: string; productName: string; qtySold: number; qtyRetur: number; qtyReject: number; hargaTitip: number }
interface RecapItemInput { productId: string; variantId?: string; productName: string; qtySold: number; qtyRetur: number; qtyReject?: number }

// Tandai Lunas — pendapatan konsinyasi dibaca langsung dari totalRevenue rekap ini di Laporan
// Keuangan, jadi menandai lunas cukup flip status (tidak perlu bikin dokumen tambahan).
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json().catch(() => ({})) as { walletId?: string | null };
  const db = getDb();
  const sql = getSql();
  const [before] = await sql<RecapRow[]>`select * from consignment_recaps where id = ${id}`;
  await sql`update consignment_recaps set payment_status = 'lunas', wallet_id = ${data.walletId ?? null}, updated_at = now() where id = ${id}`;
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentRecaps',
      entityId: id,
      entityLabel: before?.location_name || id,
      action: 'update',
      actor: guard,
      before: before ? rowToRecap(before) : null,
      after: before ? { ...rowToRecap(before), paymentStatus: 'lunas', walletId: data.walletId ?? null } : null,
    });
  } catch {}
  return Response.json({ ok: true });
}

// Hapus riwayat rekap — mengembalikan stok titip di lokasi, dan membalik stok gudang/produk
// yang sudah ditambah dari retur. Ditolak jika stok retur tersebut sudah terpakai lebih lanjut.
// Stok DAN dokumen rekap sekarang sama-sama di Postgres (Tahap 13) — satu transaksi sudah cukup.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [recapRow] = await sql<RecapRow[]>`select * from consignment_recaps where id = ${id}`;
  if (!recapRow) return Response.json({ error: 'Riwayat rekap tidak ditemukan.' }, { status: 404 });
  const recap = rowToRecap(recapRow);
  const items = recap.items as RecapItem[];
  const returItems = items.filter(it => it.qtyRetur > 0);
  const stockTouched = returItems.length > 0;

  try {
    await sql.begin(async pgTx => {
      const stockKeys = items.map(it => warehouseStockKey(recap.locationId, it.productId, it.variantId));
      const returKeys = returItems.map(it => stockKey(it.productId, it.variantId));
      const wsKeys = returItems.map(it => warehouseStockKey(recap.warehouseId ?? '', it.productId, it.variantId));

      const [stockRows, { products }, wsRows] = await Promise.all([
        pgTx<{ id: string; stock_qty: string }[]>`select id, stock_qty from consignment_stock where id in ${pgTx(stockKeys)} order by id for update`,
        readProductsForDeltasPg(pgTx, new Map(returKeys.map(k => [k, 0]))),
        wsKeys.length > 0 ? pgTx<{ id: string; stock_qty: string }[]>`select id, stock_qty from warehouse_stock where id in ${pgTx(wsKeys)} order by id for update` : [],
      ]);
      const stockById = new Map(stockRows.map(r => [r.id, r]));
      const wsById = new Map(wsRows.map(r => [r.id, r]));

      const shortages: string[] = [];
      returItems.forEach((it, i) => {
        const productQty = products.get(stockKey(it.productId, it.variantId))?.currentQty ?? 0;
        if (productQty < it.qtyRetur) shortages.push(`${it.productName} (stok toko tersisa ${productQty}, retur ${it.qtyRetur})`);
        const wsQty = Number(wsById.get(wsKeys[i])?.stock_qty) || 0;
        if (wsQty < it.qtyRetur) shortages.push(`${it.productName} (stok gudang tujuan tersisa ${wsQty}, retur ${it.qtyRetur})`);
      });
      if (shortages.length > 0) {
        throw new Error(`Tidak bisa menghapus — stok retur dari rekap ini sudah terpakai: ${shortages.join(', ')}`);
      }

      for (const [i, it] of items.entries()) {
        const key = stockKeys[i];
        const row = stockById.get(key);
        const restore = it.qtySold + it.qtyRetur + it.qtyReject;
        const oldQty = row ? Number(row.stock_qty) || 0 : 0;
        await pgTx`
          insert into consignment_stock (id, location_id, product_id, variant_id, product_name, stock_qty, harga_titip, updated_at)
          values (${key}, ${recap.locationId}, ${it.productId}, ${it.variantId ?? null}, ${it.productName}, ${oldQty + restore}, ${it.hargaTitip ?? 0}, now())
          on conflict (id) do update set stock_qty = ${oldQty + restore}, updated_at = now()
        `;
      }

      for (const it of returItems) {
        const product = products.get(stockKey(it.productId, it.variantId));
        if (!product?.exists) continue;
        await applyStockDeltaPg(pgTx, { product, warehouseId: recap.warehouseId ?? undefined, delta: -it.qtyRetur });
      }

      await pgTx`delete from consignment_recaps where id = ${id}`;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat rekap.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentRecaps',
      entityId: id,
      entityLabel: recap.locationName || id,
      action: 'delete',
      actor: guard,
      before: recap,
    });
  } catch (err) {
    console.error('Failed to write history for consignment recap delete', err);
  }

  if (stockTouched) after(() => revalidateStorefront('products'));
  // Menghapus rekap mengubah total totalSold yang dijumlah di beranda storefront.
  after(() => revalidateStorefront('stats'));
  return Response.json({ ok: true });
}

// Edit riwayat rekap — membalik efek stok yang lama (stok titip & retur/reject ke gudang),
// lalu menerapkan efek stok yang baru dalam satu transaksi. Log gudang lama untuk retur/reject
// dibiarkan sebagai riwayat historis; edit yang menghasilkan retur/reject baru dicatat sebagai log baru.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    locationId: string; locationName: string; note?: string; items: RecapItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
    warehouseId?: string; warehouseName?: string; date?: string; dueDate?: string;
  };
  const newItems = (data.items ?? [])
    .map(it => ({ ...it, qtyReject: it.qtyReject ?? 0 }))
    .filter(it => it.qtySold > 0 || it.qtyRetur > 0 || it.qtyReject > 0);
  if (newItems.length === 0) return Response.json({ error: 'Isi minimal 1 produk dengan qty terjual, retur, atau reject.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const newHasReturnOrReject = newItems.some(it => it.qtyRetur > 0 || it.qtyReject > 0);
  if (newHasReturnOrReject && !data.warehouseId) {
    return Response.json({ error: 'Pilih gudang tujuan untuk retur/reject.' }, { status: 400 });
  }

  const db = getDb();
  const sql = getSql();

  const [oldRecapRowPeek] = await sql<RecapRow[]>`select * from consignment_recaps where id = ${id}`;
  if (!oldRecapRowPeek) return Response.json({ error: 'Riwayat rekap tidak ditemukan.' }, { status: 404 });
  const oldRecap = rowToRecap(oldRecapRowPeek);
  const oldItems = oldRecap.items as RecapItem[];
  const oldReturItems = oldItems.filter(it => it.qtyRetur > 0);
  const newReturItems = newItems.filter(it => it.qtyRetur > 0);

  const outputKeys = [...new Set([...oldReturItems, ...newReturItems].map(it => stockKey(it.productId, it.variantId)))];
  const stockTouched = outputKeys.length > 0;

  const stockMeta = new Map<string, { locationId: string; productId: string; variantId?: string; productName: string }>();
  oldItems.forEach(it => {
    const key = warehouseStockKey(oldRecap.locationId, it.productId, it.variantId);
    if (!stockMeta.has(key)) stockMeta.set(key, { locationId: oldRecap.locationId, productId: it.productId, variantId: it.variantId, productName: it.productName });
  });
  newItems.forEach(it => {
    const key = warehouseStockKey(data.locationId, it.productId, it.variantId);
    if (!stockMeta.has(key)) stockMeta.set(key, { locationId: data.locationId, productId: it.productId, variantId: it.variantId, productName: it.productName });
  });
  const stockKeys = [...stockMeta.keys()];

  const wsMeta = new Map<string, { warehouseId: string; productId: string; variantId?: string; productName: string }>();
  oldReturItems.forEach(it => {
    const key = warehouseStockKey(oldRecap.warehouseId ?? '', it.productId, it.variantId);
    if (!wsMeta.has(key)) wsMeta.set(key, { warehouseId: oldRecap.warehouseId ?? '', productId: it.productId, variantId: it.variantId, productName: it.productName });
  });
  newReturItems.forEach(it => {
    const key = warehouseStockKey(data.warehouseId ?? '', it.productId, it.variantId);
    if (!wsMeta.has(key)) wsMeta.set(key, { warehouseId: data.warehouseId ?? '', productId: it.productId, variantId: it.variantId, productName: it.productName });
  });
  const wsKeys = [...wsMeta.keys()];

  interface RecapItemComputed extends RecapItemInput { hargaTitip: number; revenue: number }
  let recapItems: RecapItemComputed[] = [];
  let totalSold = 0, totalRetur = 0, totalReject = 0, totalRevenue = 0;

  try {
    await sql.begin(async pgTx => {
      // Kunci baris rekap ini SEBELUM baca ulang state produk/stok — cegah dua edit bersamaan
      // pada rekap yang sama saling menimpa.
      await pgTx`select id from consignment_recaps where id = ${id} for update`;

      const [{ products }, stockRows, wsRows] = await Promise.all([
        readProductsForDeltasPg(pgTx, new Map(outputKeys.map(k => [k, 0]))),
        stockKeys.length > 0 ? pgTx<{ id: string; stock_qty: string; harga_titip: string | null }[]>`select id, stock_qty, harga_titip from consignment_stock where id in ${pgTx(stockKeys)} order by id for update` : [],
        wsKeys.length > 0 ? pgTx<{ id: string; stock_qty: string }[]>`select id, stock_qty from warehouse_stock where id in ${pgTx(wsKeys)} order by id for update` : [],
      ]);
      const stockById = new Map(stockRows.map(r => [r.id, r]));
      const wsById = new Map(wsRows.map(r => [r.id, r]));

      // Qty produk mutable lokal, diinisialisasi dari readProductsForDeltasPg lalu digeser
      // reverse-lalu-apply di bawah — ditulis balik lewat applyStockCostPg di langkah 3.
      const productQty = new Map(outputKeys.map(k => [k, products.get(k)?.currentQty ?? 0]));
      const stockState = new Map(stockKeys.map(k => {
        const row = stockById.get(k);
        return [k, { stockQty: row ? Number(row.stock_qty) || 0 : 0, hargaTitip: row?.harga_titip != null ? Number(row.harga_titip) : 0 }];
      }));
      const wsState = new Map(wsKeys.map(k => {
        const row = wsById.get(k);
        return [k, { stockQty: row ? Number(row.stock_qty) || 0 : 0 }];
      }));

      // 1) Balik efek rekap lama
      oldItems.forEach(it => {
        const key = warehouseStockKey(oldRecap.locationId, it.productId, it.variantId);
        const s = stockState.get(key)!;
        s.stockQty += it.qtySold + it.qtyRetur + it.qtyReject;
      });
      oldReturItems.forEach(it => {
        const pKey = stockKey(it.productId, it.variantId);
        const curQty = productQty.get(pKey) ?? 0;
        if (curQty < it.qtyRetur) throw new Error(`Tidak bisa mengubah — stok retur dari rekap lama sudah terpakai: ${it.productName}.`);
        productQty.set(pKey, curQty - it.qtyRetur);
        const ws = wsState.get(warehouseStockKey(oldRecap.warehouseId ?? '', it.productId, it.variantId))!;
        if (ws.stockQty < it.qtyRetur) throw new Error(`Tidak bisa mengubah — stok gudang dari retur rekap lama sudah terpakai: ${it.productName}.`);
        ws.stockQty -= it.qtyRetur;
      });

      // 2) Validasi & terapkan rekap baru — qty diminta digabung dulu per produk (per lokasi_produk)
      // supaya baris ganda untuk produk yang sama tidak lolos validasi ganda dari angka stok awal
      // yang sama, yang baru jadi minus saat masing-masing baris diterapkan berurutan.
      const requestedByKey = new Map<string, number>();
      newItems.forEach(it => {
        const key = warehouseStockKey(data.locationId, it.productId, it.variantId);
        requestedByKey.set(key, (requestedByKey.get(key) ?? 0) + it.qtySold + it.qtyRetur + it.qtyReject);
      });

      const shortages: string[] = [];
      requestedByKey.forEach((requested, key) => {
        const s = stockState.get(key)!;
        if (s.stockQty < requested) shortages.push(`${stockMeta.get(key)!.productName} (stok di lokasi ${s.stockQty}, diminta ${requested})`);
      });
      if (shortages.length > 0) throw new Error(`Qty melebihi stok di lokasi: ${shortages.join(', ')}`);

      recapItems = newItems.map(it => {
        const s = stockState.get(warehouseStockKey(data.locationId, it.productId, it.variantId))!;
        const hargaTitip = s.hargaTitip;
        s.stockQty -= (it.qtySold + it.qtyRetur + it.qtyReject);
        return { ...it, hargaTitip, revenue: it.qtySold * hargaTitip };
      });
      totalSold    = recapItems.reduce((s, it) => s + it.qtySold, 0);
      totalRetur   = recapItems.reduce((s, it) => s + it.qtyRetur, 0);
      totalReject  = recapItems.reduce((s, it) => s + (it.qtyReject ?? 0), 0);
      totalRevenue = recapItems.reduce((s, it) => s + it.revenue, 0);

      newReturItems.forEach(it => {
        const pKey = stockKey(it.productId, it.variantId);
        productQty.set(pKey, (productQty.get(pKey) ?? 0) + it.qtyRetur);
        const ws = wsState.get(warehouseStockKey(data.warehouseId ?? '', it.productId, it.variantId))!;
        ws.stockQty += it.qtyRetur;
      });

      // 3) Tulis ulang state produk, stok titip & stok gudang
      for (const key of outputKeys) {
        const product = products.get(key);
        if (!product?.exists) continue;
        // Math.max(0, ...) — jaring pengaman terakhir, seharusnya tidak pernah terpakai kalau validasi
        // di atas benar, tapi mencegah stok minus tersimpan kalau ada celah lain yang belum ketahuan.
        const qty = Math.max(0, productQty.get(key) ?? 0);
        await applyStockCostPg(pgTx, { product, newQty: qty, newCost: product.costPrice });
      }
      for (const key of stockKeys) {
        const meta = stockMeta.get(key)!;
        const s = stockState.get(key)!;
        await pgTx`
          insert into consignment_stock (id, location_id, product_id, variant_id, product_name, stock_qty, harga_titip, updated_at)
          values (${key}, ${meta.locationId}, ${meta.productId}, ${meta.variantId ?? null}, ${meta.productName}, ${s.stockQty}, ${s.hargaTitip}, now())
          on conflict (id) do update set stock_qty = ${s.stockQty}, updated_at = now()
        `;
      }
      for (const key of wsKeys) {
        const meta = wsMeta.get(key)!;
        const ws = wsState.get(key)!;
        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, variant_id, product_name, stock_qty, updated_at)
          values (${key}, ${meta.warehouseId}, ${meta.productId}, ${meta.variantId ?? null}, ${meta.productName}, ${ws.stockQty}, now())
          on conflict (id) do update set stock_qty = ${ws.stockQty}, product_name = excluded.product_name, updated_at = now()
        `;
      }

      // Log gudang baru untuk retur/reject hasil edit — log lama dari rekap sebelum diedit
      // dibiarkan sebagai riwayat historis (tidak dihapus/diubah).
      for (const it of newReturItems) {
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, variantId: it.variantId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'in', qty: it.qtyRetur, note: `Retur konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });
      }
      for (const it of newItems.filter(it => (it.qtyReject ?? 0) > 0)) {
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, variantId: it.variantId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'reject', qty: it.qtyReject ?? 0, note: `Reject konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });
      }

      // overdue_notified_at direset — biar bisa dinotifikasi ulang kalau dueDate/status berubah.
      await pgTx`
        update consignment_recaps set
          location_id = ${data.locationId}, location_name = ${data.locationName},
          items = ${JSON.stringify(recapItems)}, total_sold = ${totalSold}, total_retur = ${totalRetur},
          total_reject = ${totalReject}, total_revenue = ${totalRevenue}, payment_status = ${paymentStatus},
          warehouse_id = ${data.warehouseId ?? null}, warehouse_name = ${data.warehouseName ?? null},
          note = ${data.note ?? null}, wallet_id = ${data.walletId ?? null},
          created_at = ${data.date ? new Date(data.date) : oldRecapRowPeek.created_at},
          due_date = ${data.dueDate ? new Date(data.dueDate) : null},
          overdue_notified_at = null, updated_at = now()
        where id = ${id}
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah rekap.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentRecaps',
      entityId: id,
      entityLabel: `${data.locationName ?? oldRecap.locationName ?? id}${data.date ? ` - ${data.date}` : ''}`,
      action: 'update',
      actor: guard,
      before: oldRecap,
      after: { ...oldRecap, locationId: data.locationId, locationName: data.locationName, items: recapItems, totalSold, totalRetur, totalReject, totalRevenue, paymentStatus },
    });
  } catch (err) {
    console.error('Failed to write history for consignment recap update', err);
  }

  if (stockTouched) after(() => revalidateStorefront('products'));
  // Edit rekap menghitung ulang totalSold yang dijumlah di beranda storefront.
  after(() => revalidateStorefront('stats'));
  return Response.json({ ok: true });
}
