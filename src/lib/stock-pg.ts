import { randomUUID } from 'crypto';
import type postgres from 'postgres';

// Versi Postgres dari src/lib/stock.ts (Tahap 9 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md) — satu-satunya tempat yang boleh mengubah stok produk setelah
// `products`/`stock_ledger`/`warehouse_stock`/`consignment_stock` pindah ke Postgres. Semua
// fungsi di sini WAJIB dipanggil di dalam `sql.begin(async pgTx => {...})` milik caller (tidak
// membuka transaksi sendiri) supaya bisa digabung atomik dengan penulisan lain di transaksi yang
// sama.
//
// Beda penting dari versi Firestore: Firestore transaction otomatis retry kalau ada konflik baca
// (optimistic concurrency). Postgres butuh locking eksplisit — `readProductsForDeltasPg` pakai
// `SELECT ... FOR UPDATE ORDER BY id` supaya baris produk yang kena delta terkunci sampai
// transaksi ini commit/rollback, DAN urutan kunci selalu sama (ascending id) di semua caller
// supaya tidak ada risiko deadlock antar transaksi yang saling kunci produk yang sama beda urutan.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgTx = postgres.ISql<{}>;

export interface ProductStockInfoPg {
  id: string;
  exists: boolean;
  currentQty: number;
  name: string;
  openPO: boolean;
  costPrice: number;
  // Kepemilikan konsinyasi-masuk (lihat plan snug-sparking-ocean.md) — 'own' untuk produk milik
  // toko sendiri. Dibaca di sini (bukan query terpisah) supaya orders/route.ts bisa menghitung
  // payout ke partner dari snapshot yang sama, terkunci, dengan stok yang sedang diproses.
  ownerType: 'own' | 'consigned_in';
  consignorId: string | null;
  consignorName: string | null;
  settlementType: 'fixed' | 'percentage' | null;
  payoutPrice: number | null;
  commissionPct: number | null;
}

interface ProductStockRow {
  id: string; name: string; stock_qty: string; open_po: boolean; cost_price: string | null;
  owner_type: string | null; consignor_id: string | null; consignor_name: string | null;
  settlement_type: string | null; payout_price: string | null; commission_pct: string | null;
}

export async function readProductsForDeltasPg(
  pgTx: PgTx,
  deltas: Map<string, number>,
): Promise<{ products: Map<string, ProductStockInfoPg>; shortages: string[]; shortageDetails: { productId: string; message: string }[] }> {
  const productIds = [...deltas.keys()];
  const rows = productIds.length > 0
    ? await pgTx<ProductStockRow[]>`
        select p.id, p.name, p.stock_qty, p.open_po, p.cost_price,
          p.owner_type, p.consignor_id, cip.name as consignor_name,
          p.settlement_type, p.payout_price, p.commission_pct
        from products p
        left join consignment_in_partners cip on cip.id = p.consignor_id
        where p.id in ${pgTx(productIds)} order by p.id for update
      `
    : [];
  const byId = new Map(rows.map(r => [r.id, r]));

  const products = new Map<string, ProductStockInfoPg>();
  const shortages: string[] = [];
  const shortageDetails: { productId: string; message: string }[] = [];

  productIds.forEach(pid => {
    const row = byId.get(pid);
    const exists = !!row;
    const currentQty = row ? Number(row.stock_qty) || 0 : 0;
    const delta = deltas.get(pid)!;

    if (delta < 0 && (!exists || currentQty < -delta)) {
      const name = row?.name ?? pid;
      const message = `${name} (stok tersisa ${currentQty}, butuh ${-delta})`;
      shortages.push(message);
      shortageDetails.push({ productId: pid, message });
    }

    products.set(pid, {
      id: pid, exists, currentQty, name: row?.name ?? '', openPO: row?.open_po ?? false,
      costPrice: row?.cost_price != null ? Number(row.cost_price) : 0,
      ownerType: row?.owner_type === 'consigned_in' ? 'consigned_in' : 'own',
      consignorId: row?.consignor_id ?? null,
      consignorName: row?.consignor_name ?? null,
      settlementType: row?.settlement_type === 'percentage' ? 'percentage' : row?.settlement_type === 'fixed' ? 'fixed' : null,
      payoutPrice: row?.payout_price != null ? Number(row.payout_price) : null,
      commissionPct: row?.commission_pct != null ? Number(row.commission_pct) : null,
    });
  });

  return { products, shortages, shortageDetails };
}

export async function applyStockDeltaPg(
  pgTx: PgTx,
  opts: { productId: string; product: ProductStockInfoPg; warehouseId?: string; delta: number },
): Promise<void> {
  const { productId, product, warehouseId, delta } = opts;
  const newQty = product.currentQty + delta;

  if (product.exists) {
    const newStock = product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis';
    await pgTx`update products set stock_qty = ${newQty}, stock = ${newStock}, updated_at = now() where id = ${productId}`;
  }

  if (warehouseId) {
    await pgTx`
      insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
      values (${`${warehouseId}_${productId}`}, ${warehouseId}, ${productId}, ${product.name}, ${delta}, now())
      on conflict (id) do update set
        stock_qty = warehouse_stock.stock_qty + excluded.stock_qty,
        product_name = excluded.product_name,
        updated_at = now()
    `;
  }
}

export interface ProductSnapshot { productId: string; oldQty: number; oldCost: number; openPO: boolean }
export interface WsSnapshot { key: string; warehouseId: string; productId: string; productName: string; oldQty: number }

export function stockLabel(openPO: boolean, qty: number): 'open_po' | 'ready' | 'habis' {
  return openPO ? 'open_po' : qty > 0 ? 'ready' : 'habis';
}

// Baca (dengan lock) & set ulang satu baris warehouse_stock, sambil mencatat nilai lama untuk
// kompensasi kalau langkah Firestore setelahnya (dokumen order/produksi/rekap) gagal tersimpan.
export async function captureAndSetWs(
  pgTx: PgTx, snapshots: WsSnapshot[],
  key: string, warehouseId: string, productId: string, productName: string,
  nextQty: (oldQty: number) => number,
): Promise<void> {
  const rows = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${key} for update`;
  const oldQty = rows[0] ? Number(rows[0].stock_qty) || 0 : 0;
  snapshots.push({ key, warehouseId, productId, productName, oldQty });
  const newQty = nextQty(oldQty);
  await pgTx`
    insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
    values (${key}, ${warehouseId}, ${productId}, ${productName}, ${newQty}, now())
    on conflict (id) do update set stock_qty = ${newQty}, product_name = excluded.product_name, updated_at = now()
  `;
}

// Kembalikan products & warehouse_stock ke state sebelum sebuah operasi (production/consignment),
// dipanggil saat langkah Firestore setelahnya gagal tersimpan padahal Postgres sudah commit.
export async function compensateStock(
  sql: postgres.Sql, productSnapshots: ProductSnapshot[], wsSnapshots: WsSnapshot[],
): Promise<void> {
  await sql.begin(async pgTx => {
    for (const s of productSnapshots) {
      await pgTx`update products set stock_qty = ${s.oldQty}, cost_price = ${s.oldCost}, stock = ${stockLabel(s.openPO, s.oldQty)}, updated_at = now() where id = ${s.productId}`;
    }
    for (const w of wsSnapshots) {
      await pgTx`
        insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
        values (${w.key}, ${w.warehouseId}, ${w.productId}, ${w.productName}, ${w.oldQty}, now())
        on conflict (id) do update set stock_qty = ${w.oldQty}, updated_at = now()
      `;
    }
  });
}

export async function writeStockLedgerEntryPg(
  pgTx: PgTx,
  opts: {
    productId: string;
    productName?: string;
    warehouseId?: string;
    warehouseName?: string;
    type: 'in' | 'out' | 'adjustment' | 'transfer' | 'reject';
    qty: number;
    note: string;
  },
): Promise<void> {
  const id = randomUUID();
  await pgTx`
    insert into stock_ledger (id, product_id, product_name, warehouse_id, warehouse_name, type, qty, note, created_at)
    values (${id}, ${opts.productId}, ${opts.productName ?? null}, ${opts.warehouseId ?? null}, ${opts.warehouseName ?? null}, ${opts.type}, ${Math.abs(opts.qty)}, ${opts.note}, now())
  `;
}

// Transfer stok antar gudang — satu baris ledger dengan info gudang asal & tujuan sekaligus
// (bukan warehouse_id/warehouse_name tunggal seperti tipe lain), supaya tampilan "A → B" di
// StockTab/StockReportTab tetap sama seperti versi Firestore lama.
export async function writeTransferLedgerEntryPg(
  pgTx: PgTx,
  opts: {
    productId: string; productName?: string;
    fromWarehouseId: string; fromWarehouseName?: string;
    toWarehouseId: string; toWarehouseName?: string;
    qty: number; note: string;
  },
): Promise<void> {
  const id = randomUUID();
  await pgTx`
    insert into stock_ledger (
      id, product_id, product_name, type, qty, note,
      from_warehouse_id, from_warehouse_name, to_warehouse_id, to_warehouse_name, created_at
    ) values (
      ${id}, ${opts.productId}, ${opts.productName ?? null}, 'transfer', ${Math.abs(opts.qty)}, ${opts.note},
      ${opts.fromWarehouseId}, ${opts.fromWarehouseName ?? null}, ${opts.toWarehouseId}, ${opts.toWarehouseName ?? null}, now()
    )
  `;
}
