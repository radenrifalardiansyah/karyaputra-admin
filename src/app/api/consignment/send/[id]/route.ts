import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { shipmentPdfTag } from '@/lib/pdf/shipmentPdfTag';
import { revalidateStorefront } from '@/lib/revalidate';
import { readProductsForDeltasPg, applyStockCostPg, writeStockLedgerEntryPg, stockKey, warehouseStockKey } from '@/lib/stock-pg';
import { rowToShipment, type ShipmentRow } from '@/lib/shipments-pg';

type Ctx = { params: Promise<{ id: string }> };
interface SendItemInput { productId: string; variantId?: string; productName: string; qty: number; hargaTitip: number }

// Hapus riwayat kirim — mengembalikan stok toko & stok gudang asal, dan mengurangi stok titip di
// lokasi, lalu menghapus dokumen pengiriman itu sendiri, semuanya dalam SATU transaksi Postgres
// (Tahap 18a — stok & dokumen sama-sama Postgres, tidak perlu lagi kompensasi cross-database
// seperti versi Firestore sebelumnya). Ditolak jika stok titip sudah terpakai (terjual/direkap)
// sehingga tidak cukup untuk dibalik.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [shipmentRow] = await sql<ShipmentRow[]>`select * from consignment_shipments where id = ${id}`;
  if (!shipmentRow) return Response.json({ error: 'Riwayat kirim tidak ditemukan.' }, { status: 404 });
  const shipment = rowToShipment(shipmentRow);
  const items = shipment.items;

  try {
    await sql.begin(async pgTx => {
      const outputKeys = items.map(it => stockKey(it.productId, it.variantId));
      const consignStockKeys = items.map(it => warehouseStockKey(shipment.locationId ?? '', it.productId, it.variantId));
      const [{ products }, stockRows] = await Promise.all([
        readProductsForDeltasPg(pgTx, new Map(outputKeys.map(k => [k, 0]))),
        consignStockKeys.length > 0 ? pgTx<{ id: string; stock_qty: string }[]>`select id, stock_qty from consignment_stock where id in ${pgTx(consignStockKeys)} order by id for update` : [],
      ]);
      const stockById = new Map(stockRows.map(r => [r.id, r]));

      const shortages: string[] = [];
      items.forEach((it, i) => {
        const stockQty = Number(stockById.get(consignStockKeys[i])?.stock_qty) || 0;
        if (stockQty < it.qty) shortages.push(`${it.productName} (stok titip tersisa ${stockQty}, butuh ${it.qty})`);
      });
      if (shortages.length > 0) {
        throw new Error(`Tidak bisa menghapus — sebagian stok kiriman ini sudah terjual/direkap: ${shortages.join(', ')}`);
      }

      for (const [i, it] of items.entries()) {
        const key = outputKeys[i];
        const product = products.get(key);
        if (product?.exists) {
          await applyStockCostPg(pgTx, { product, newQty: product.currentQty + it.qty, newCost: product.costPrice });
        }
        const consignStockKey = consignStockKeys[i];
        const stockQty = Number(stockById.get(consignStockKey)?.stock_qty) || 0;
        await pgTx`update consignment_stock set stock_qty = ${stockQty - it.qty}, updated_at = now() where id = ${consignStockKey}`;

        // Kiriman lama (sebelum fitur gudang asal) tidak pernah mengurangi warehouse_stock — jangan dibalik.
        if (shipment.warehouseId) {
          const wsKey = warehouseStockKey(shipment.warehouseId, it.productId, it.variantId);
          const wsRows = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${wsKey} for update`;
          const oldWsQty = wsRows[0] ? Number(wsRows[0].stock_qty) || 0 : 0;
          await pgTx`
            insert into warehouse_stock (id, warehouse_id, product_id, variant_id, product_name, stock_qty, updated_at)
            values (${wsKey}, ${shipment.warehouseId}, ${it.productId}, ${it.variantId ?? null}, ${it.productName}, ${oldWsQty + it.qty}, now())
            on conflict (id) do update set stock_qty = ${oldWsQty + it.qty}, updated_at = now()
          `;
        }
      }

      await pgTx`delete from consignment_shipments where id = ${id}`;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat kirim.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentShipments',
      entityId: id,
      entityLabel: shipment.locationName || id,
      action: 'delete',
      actor: guard,
      before: shipmentRow,
    });
  } catch (err) {
    console.error('Failed to write history for consignment send delete', err);
  }

  revalidateTag(shipmentPdfTag(id), 'max');
  revalidateTag('admin-consignment-shipments-list', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}

// Edit riwayat kirim — membalik efek stok yang lama (termasuk stok gudang asal lama, jika ada),
// menerapkan efek stok yang baru, dan menulis ulang dokumen pengiriman, semuanya dalam SATU
// transaksi Postgres (Tahap 18a). Ditolak jika stok lama sudah terpakai atau stok toko tidak
// cukup. Log gudang lama dibiarkan sebagai riwayat historis.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    locationId: string; locationName: string; warehouseId: string; warehouseName?: string;
    note?: string; items: SendItemInput[]; date?: string;
  };
  const newItems = data.items ?? [];
  if (newItems.length === 0) return Response.json({ error: 'Minimal 1 produk dikirim.' }, { status: 400 });
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang asal pengiriman.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();

  const [shipmentRow] = await sql<ShipmentRow[]>`select * from consignment_shipments where id = ${id}`;
  if (!shipmentRow) return Response.json({ error: 'Riwayat kirim tidak ditemukan.' }, { status: 404 });
  const oldShipment = rowToShipment(shipmentRow);
  const oldItems = oldShipment.items;

  const outputKeys = [...new Set([...oldItems, ...newItems].map(it => stockKey(it.productId, it.variantId)))];
  const productNameByKey = new Map<string, string>();
  [...oldItems, ...newItems].forEach(it => {
    const key = stockKey(it.productId, it.variantId);
    if (!productNameByKey.has(key)) productNameByKey.set(key, it.productName);
  });

  const stockMeta = new Map<string, { locationId: string; productId: string; variantId?: string; productName: string }>();
  oldItems.forEach(it => {
    const key = warehouseStockKey(oldShipment.locationId ?? '', it.productId, it.variantId);
    if (!stockMeta.has(key)) stockMeta.set(key, { locationId: oldShipment.locationId ?? '', productId: it.productId, variantId: it.variantId, productName: it.productName });
  });
  newItems.forEach(it => {
    const key = warehouseStockKey(data.locationId, it.productId, it.variantId);
    if (!stockMeta.has(key)) stockMeta.set(key, { locationId: data.locationId, productId: it.productId, variantId: it.variantId, productName: it.productName });
  });
  const stockKeys = [...stockMeta.keys()];

  let itemsWithSubtotal: (SendItemInput & { subtotal: number })[] = [];
  // Sama seperti versi Firestore lama: createdAt cuma ditimpa kalau tanggal baru diberikan,
  // kalau tidak dipertahankan (bukan direset ke waktu edit terjadi).
  const newCreatedAt = data.date ? new Date(data.date) : shipmentRow.created_at;

  try {
    await sql.begin(async pgTx => {
      const [{ products }, stockRows] = await Promise.all([
        readProductsForDeltasPg(pgTx, new Map(outputKeys.map(k => [k, 0]))),
        stockKeys.length > 0 ? pgTx<{ id: string; stock_qty: string; harga_titip: string | null }[]>`select id, stock_qty, harga_titip from consignment_stock where id in ${pgTx(stockKeys)} order by id for update` : [],
      ]);
      const stockById = new Map(stockRows.map(r => [r.id, r]));

      // Qty produk mutable lokal, diinisialisasi dari readProductsForDeltasPg lalu digeser
      // reverse-lalu-apply di bawah — ditulis balik lewat applyStockCostPg di langkah 3.
      const productQty = new Map(outputKeys.map(k => [k, products.get(k)?.currentQty ?? 0]));
      const stockState = new Map(stockKeys.map(k => {
        const row = stockById.get(k);
        return [k, { stockQty: row ? Number(row.stock_qty) || 0 : 0, hargaTitip: row?.harga_titip != null ? Number(row.harga_titip) : 0 }];
      }));

      // key = warehouseStockKey(warehouseId, productId, variantId) — kept alongside the parsed
      // fields so we never have to split it back apart.
      const wsDelta = new Map<string, { warehouseId: string; productId: string; variantId?: string; delta: number }>();
      const bumpWs = (warehouseId: string, productId: string, variantId: string | undefined, delta: number) => {
        const key = warehouseStockKey(warehouseId, productId, variantId);
        const cur = wsDelta.get(key);
        if (cur) cur.delta += delta;
        else wsDelta.set(key, { warehouseId, productId, variantId, delta });
      };

      // 1) Balik efek kiriman lama
      for (const it of oldItems) {
        const stockMetaKey = warehouseStockKey(oldShipment.locationId ?? '', it.productId, it.variantId);
        const s = stockState.get(stockMetaKey)!;
        if (s.stockQty < it.qty) {
          throw new Error(`Tidak bisa mengubah — sebagian stok kiriman lama sudah terjual/direkap: ${it.productName}.`);
        }
        s.stockQty -= it.qty;
        const key = stockKey(it.productId, it.variantId);
        productQty.set(key, (productQty.get(key) ?? 0) + it.qty);

        // Kiriman lama (sebelum fitur gudang asal) tidak pernah mengurangi warehouse_stock — jangan dibalik.
        if (oldShipment.warehouseId) bumpWs(oldShipment.warehouseId, it.productId, it.variantId, it.qty);
      }

      // 2) Validasi & terapkan kiriman baru — qty digabung dulu per produk(+varian) supaya baris
      // ganda untuk kombinasi yang sama di form yang sama ikut terhitung (sebelumnya divalidasi
      // terpisah dari angka stok awal yang sama, jadi bisa lolos validasi tapi jadi minus saat
      // diterapkan berturut-turut).
      const newQtyByKey = new Map<string, number>();
      newItems.forEach(it => {
        const key = stockKey(it.productId, it.variantId);
        newQtyByKey.set(key, (newQtyByKey.get(key) ?? 0) + it.qty);
      });

      const shortages: string[] = [];
      newQtyByKey.forEach((qty, key) => {
        const exists = products.get(key)?.exists ?? false;
        const name = productNameByKey.get(key) ?? key;
        if (!exists) { shortages.push(`${name} (produk tidak ditemukan)`); return; }
        const stockQty = productQty.get(key) ?? 0;
        if (stockQty < qty) shortages.push(`${name} (stok toko ${stockQty}, butuh ${qty})`);
      });
      if (shortages.length > 0) throw new Error(`Stok produk tidak cukup untuk dikirim: ${shortages.join(', ')}`);

      const bumpedKeys = new Set<string>();
      newItems.forEach(it => {
        const key = stockKey(it.productId, it.variantId);
        if (bumpedKeys.has(key)) return; // qty per key sudah dijumlahkan di newQtyByKey — terapkan sekali saja
        bumpedKeys.add(key);
        productQty.set(key, (productQty.get(key) ?? 0) - newQtyByKey.get(key)!);
        bumpWs(data.warehouseId, it.productId, it.variantId, -newQtyByKey.get(key)!);
      });

      newItems.forEach(it => {
        const stockMetaKey = warehouseStockKey(data.locationId, it.productId, it.variantId);
        const s = stockState.get(stockMetaKey)!;
        const newQty = s.stockQty + it.qty;
        s.hargaTitip = newQty > 0 ? (s.stockQty * s.hargaTitip + it.qty * it.hargaTitip) / newQty : 0;
        s.stockQty = newQty;
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
          on conflict (id) do update set stock_qty = ${s.stockQty}, harga_titip = ${s.hargaTitip}, updated_at = now()
        `;
      }
      for (const [key, { warehouseId, productId, variantId, delta }] of wsDelta) {
        if (delta === 0) continue;
        const rows = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${key} for update`;
        const oldQty = rows[0] ? Number(rows[0].stock_qty) || 0 : 0;
        const newQty = oldQty + delta;
        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, variant_id, product_name, stock_qty, updated_at)
          values (${key}, ${warehouseId}, ${productId}, ${variantId ?? null}, ${productNameByKey.get(stockKey(productId, variantId)) ?? ''}, ${newQty}, now())
          on conflict (id) do update set stock_qty = ${newQty}, updated_at = now()
        `;
      }

      // Log gudang baru untuk kiriman hasil edit — log lama dari kiriman sebelum diedit
      // dibiarkan sebagai riwayat historis (tidak dihapus/diubah).
      for (const it of newItems) {
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, variantId: it.variantId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'out', qty: it.qty, note: `Kirim konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });
      }

      itemsWithSubtotal = newItems.map(it => ({ ...it, subtotal: it.qty * it.hargaTitip }));

      await pgTx`
        update consignment_shipments set
          location_id = ${data.locationId}, location_name = ${data.locationName},
          warehouse_id = ${data.warehouseId}, warehouse_name = ${data.warehouseName ?? ''},
          items = ${JSON.stringify(itemsWithSubtotal)}, note = ${data.note ?? ''},
          created_at = ${newCreatedAt}, updated_at = now()
        where id = ${id}
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah pengiriman.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentShipments',
      entityId: id,
      entityLabel: `${data.locationName ?? oldShipment.locationName ?? id}${data.date ? ` - ${data.date}` : ''}`,
      action: 'update',
      actor: guard,
      before: shipmentRow,
      after: {
        locationId: data.locationId, locationName: data.locationName,
        warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
        items: itemsWithSubtotal, note: data.note ?? '',
      },
    });
  } catch (err) {
    console.error('Failed to write history for consignment send update', err);
  }

  revalidateTag(shipmentPdfTag(id), 'max');
  revalidateTag('admin-consignment-shipments-list', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
