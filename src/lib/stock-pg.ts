import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { parseJsonb } from '@/lib/db';

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
//
// Dukungan Varian (Fase 2): sebuah "baris stok" sekarang bisa merujuk ke produk biasa ATAU ke satu
// varian (`product_variants`). Map<string, number> deltas dipakai persis seperti sebelumnya, hanya
// saja key-nya sekarang boleh berupa productId polos ATAU key gabungan dari `stockKey()` di bawah
// (`${productId}::${variantId}`) — produk tanpa varian sama sekali tidak berubah perilakunya. Stok
// varian disimpan di `product_variants.stock_qty` sendiri (dikunci `FOR UPDATE` terpisah dari
// `products`, ordering ascending-by-id di masing-masing tabel tetap dijaga per query supaya tidak
// ada risiko deadlock baru). Atribut kepemilikan/konsinyasi & Buka PO tetap di level produk induk
// (belum ada kebutuhan bisnis untuk beda per varian — lihat diskusi Fase 4).

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgTx = postgres.ISql<{}>;

export function stockKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}::${variantId}` : productId;
}
function parseStockKey(key: string): { productId: string; variantId: string | null } {
  const sep = key.indexOf('::');
  return sep === -1 ? { productId: key, variantId: null } : { productId: key.slice(0, sep), variantId: key.slice(sep + 2) };
}

export interface ProductStockInfoPg {
  id: string; // products.id (produk induk) — SELALU id produk asli, valid sebagai FK, baik untuk
              // baris polos maupun baris varian (dipakai consignment_in_ledger.product_id dst).
  variantId: string | null; // product_variants.id kalau baris ini varian, null kalau produk polos.
  exists: boolean;
  currentQty: number;
  name: string;
  openPO: boolean;
  costPrice: number;
  // Kepemilikan konsinyasi-masuk (lihat plan snug-sparking-ocean.md) — 'own' untuk produk milik
  // toko sendiri. Dibaca di sini (bukan query terpisah) supaya orders/route.ts bisa menghitung
  // payout ke partner dari snapshot yang sama, terkunci, dengan stok yang sedang diproses. Selalu
  // level produk induk, sama untuk semua variannya.
  ownerType: 'own' | 'consigned_in';
  consignorId: string | null;
  consignorName: string | null;
  settlementType: 'fixed' | 'percentage' | null;
  payoutPrice: number | null;
  commissionPct: number | null;
}

interface OwnershipRow {
  open_po: boolean; owner_type: string | null; consignor_id: string | null; consignor_name: string | null;
  settlement_type: string | null; payout_price: string | null; commission_pct: string | null;
}
function ownershipFields(row: OwnershipRow | undefined) {
  return {
    openPO: row?.open_po ?? false,
    ownerType: (row?.owner_type === 'consigned_in' ? 'consigned_in' : 'own') as 'own' | 'consigned_in',
    consignorId: row?.consignor_id ?? null,
    consignorName: row?.consignor_name ?? null,
    settlementType: (row?.settlement_type === 'percentage' ? 'percentage' : row?.settlement_type === 'fixed' ? 'fixed' : null) as 'fixed' | 'percentage' | null,
    payoutPrice: row?.payout_price != null ? Number(row.payout_price) : null,
    commissionPct: row?.commission_pct != null ? Number(row.commission_pct) : null,
  };
}

interface ProductStockRow extends OwnershipRow {
  id: string; name: string; stock_qty: string; cost_price: string | null;
}
interface VariantStockRow extends OwnershipRow {
  variant_id: string; product_id: string; product_name: string;
  variant_stock_qty: string; variant_cost_price: string | null; options: unknown;
}

export async function readProductsForDeltasPg(
  pgTx: PgTx,
  deltas: Map<string, number>,
): Promise<{ products: Map<string, ProductStockInfoPg>; shortages: string[]; shortageDetails: { productId: string; message: string }[] }> {
  const parsed = [...deltas.keys()].map(key => ({ key, ...parseStockKey(key) }));
  const plainIds = parsed.filter(p => !p.variantId).map(p => p.productId);
  const variantIds = parsed.filter(p => p.variantId).map(p => p.variantId!);

  const [plainRows, variantRows] = await Promise.all([
    plainIds.length > 0
      ? pgTx<ProductStockRow[]>`
          select p.id, p.name, p.stock_qty, p.cost_price,
            p.open_po, p.owner_type, p.consignor_id, cip.name as consignor_name,
            p.settlement_type, p.payout_price, p.commission_pct
          from products p
          left join consignment_in_partners cip on cip.id = p.consignor_id
          where p.id in ${pgTx(plainIds)} order by p.id for update of p
        `
      : Promise.resolve([] as ProductStockRow[]),
    variantIds.length > 0
      ? pgTx<VariantStockRow[]>`
          select pv.id as variant_id, pv.product_id, p.name as product_name,
            pv.stock_qty as variant_stock_qty, pv.cost_price as variant_cost_price, pv.options,
            p.open_po, p.owner_type, p.consignor_id, cip.name as consignor_name,
            p.settlement_type, p.payout_price, p.commission_pct
          from product_variants pv
          join products p on p.id = pv.product_id
          left join consignment_in_partners cip on cip.id = p.consignor_id
          where pv.id in ${pgTx(variantIds)} order by pv.id for update of pv
        `
      : Promise.resolve([] as VariantStockRow[]),
  ]);

  const plainById = new Map(plainRows.map(r => [r.id, r]));
  const variantById = new Map(variantRows.map(r => [r.variant_id, r]));

  const products = new Map<string, ProductStockInfoPg>();
  const shortages: string[] = [];
  const shortageDetails: { productId: string; message: string }[] = [];

  for (const { key, productId, variantId } of parsed) {
    const delta = deltas.get(key)!;
    let info: ProductStockInfoPg;

    if (variantId) {
      const row = variantById.get(variantId);
      const exists = !!row;
      const currentQty = row ? Number(row.variant_stock_qty) || 0 : 0;
      const options = (row ? parseJsonb<Record<string, string>>(row.options as Record<string, string> | string | null) : null) ?? {};
      const variantLabel = Object.values(options).filter(Boolean).join(' / ');
      info = {
        id: row?.product_id ?? productId, variantId, exists, currentQty,
        name: row ? (variantLabel ? `${row.product_name} - ${variantLabel}` : row.product_name) : '',
        costPrice: row?.variant_cost_price != null ? Number(row.variant_cost_price) : 0,
        ...ownershipFields(row),
      };
    } else {
      const row = plainById.get(productId);
      const exists = !!row;
      const currentQty = row ? Number(row.stock_qty) || 0 : 0;
      info = {
        id: productId, variantId: null, exists, currentQty, name: row?.name ?? '',
        costPrice: row?.cost_price != null ? Number(row.cost_price) : 0,
        ...ownershipFields(row),
      };
    }

    if (delta < 0 && (!info.exists || info.currentQty < -delta)) {
      const message = `${info.name || (variantId ?? productId)} (stok tersisa ${info.currentQty}, butuh ${-delta})`;
      shortages.push(message);
      shortageDetails.push({ productId: info.id, message });
    }

    products.set(key, info);
  }

  return { products, shortages, shortageDetails };
}

// Id baris warehouse_stock — dipakai di sini dan di caller yang menulis warehouse_stock langsung
// (mis. production/route.ts, tidak lewat applyStockDeltaPg karena juga membaurkan HPP).
export function warehouseStockKey(warehouseId: string, productId: string, variantId?: string | null): string {
  return variantId ? `${warehouseId}_${productId}_${variantId}` : `${warehouseId}_${productId}`;
}

export async function applyStockDeltaPg(
  pgTx: PgTx,
  opts: { product: ProductStockInfoPg; warehouseId?: string; delta: number },
): Promise<void> {
  const { product, warehouseId, delta } = opts;
  const newQty = product.currentQty + delta;

  if (product.exists) {
    if (product.variantId) {
      await pgTx`update product_variants set stock_qty = ${newQty}, updated_at = now() where id = ${product.variantId}`;
    } else {
      const newStock = product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis';
      await pgTx`update products set stock_qty = ${newQty}, stock = ${newStock}, updated_at = now() where id = ${product.id}`;
    }
  }

  if (warehouseId) {
    const wsId = warehouseStockKey(warehouseId, product.id, product.variantId);
    await pgTx`
      insert into warehouse_stock (id, warehouse_id, product_id, variant_id, product_name, stock_qty, updated_at)
      values (${wsId}, ${warehouseId}, ${product.id}, ${product.variantId}, ${product.name}, ${delta}, now())
      on conflict (id) do update set
        stock_qty = warehouse_stock.stock_qty + excluded.stock_qty,
        product_name = excluded.product_name,
        updated_at = now()
    `;
  }
}

// Tulis qty & HPP ABSOLUT (bukan delta) — dipakai Produksi, yang membaurkan HPP rata-rata
// tertimbang dari HPP bahan baku, bukan menambah/mengurangi qty biasa. `product`/`newQty` di sini
// SELALU untuk produk sendiri (own), tidak pernah dipakai untuk produk konsinyasi.
export async function applyStockCostPg(
  pgTx: PgTx,
  opts: { product: ProductStockInfoPg; newQty: number; newCost: number },
): Promise<void> {
  const { product, newQty, newCost } = opts;
  if (product.variantId) {
    await pgTx`update product_variants set stock_qty = ${newQty}, cost_price = ${newCost}, updated_at = now() where id = ${product.variantId}`;
  } else {
    const newStock = product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis';
    await pgTx`update products set stock_qty = ${newQty}, cost_price = ${newCost}, stock = ${newStock}, updated_at = now() where id = ${product.id}`;
  }
}

export interface ProductSnapshot { productId: string; oldQty: number; oldCost: number; openPO: boolean }
export interface WsSnapshot { key: string; warehouseId: string; productId: string; productName: string; oldQty: number }

export function stockLabel(openPO: boolean, qty: number): 'open_po' | 'ready' | 'habis' {
  return openPO ? 'open_po' : qty > 0 ? 'ready' : 'habis';
}

// Baca (dengan lock) & set ulang satu baris warehouse_stock, sambil mencatat nilai lama untuk
// kompensasi kalau langkah Firestore setelahnya (dokumen order/produksi/rekap) gagal tersimpan.
// Belum menyentuh varian (dipakai produksi/konsinyasi-keluar, di luar cakupan Fase 2 ini).
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
    variantId?: string | null;
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
    insert into stock_ledger (id, product_id, variant_id, product_name, warehouse_id, warehouse_name, type, qty, note, created_at)
    values (${id}, ${opts.productId}, ${opts.variantId ?? null}, ${opts.productName ?? null}, ${opts.warehouseId ?? null}, ${opts.warehouseName ?? null}, ${opts.type}, ${Math.abs(opts.qty)}, ${opts.note}, now())
  `;
}

// Transfer stok antar gudang — satu baris ledger dengan info gudang asal & tujuan sekaligus
// (bukan warehouse_id/warehouse_name tunggal seperti tipe lain), supaya tampilan "A → B" di
// StockTab/StockReportTab tetap sama seperti versi Firestore lama.
export async function writeTransferLedgerEntryPg(
  pgTx: PgTx,
  opts: {
    productId: string; variantId?: string | null; productName?: string;
    fromWarehouseId: string; fromWarehouseName?: string;
    toWarehouseId: string; toWarehouseName?: string;
    qty: number; note: string;
  },
): Promise<void> {
  const id = randomUUID();
  await pgTx`
    insert into stock_ledger (
      id, product_id, variant_id, product_name, type, qty, note,
      from_warehouse_id, from_warehouse_name, to_warehouse_id, to_warehouse_name, created_at
    ) values (
      ${id}, ${opts.productId}, ${opts.variantId ?? null}, ${opts.productName ?? null}, 'transfer', ${Math.abs(opts.qty)}, ${opts.note},
      ${opts.fromWarehouseId}, ${opts.fromWarehouseName ?? null}, ${opts.toWarehouseId}, ${opts.toWarehouseName ?? null}, now()
    )
  `;
}
