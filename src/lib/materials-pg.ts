import { parseJsonb } from '@/lib/db';
import { toTimestamp } from '@/lib/orders-pg';
import { stockKey } from '@/lib/stock-pg';

// Versi Postgres dari `rawMaterials`/`materialPurchases`/`productionBatches`/`materialAdjustments`
// (Tahap 18b migrasi Fase 2, lihat plan gleaming-wondering-quokka.md). Shape JSON yang
// dikembalikan ke frontend dipertahankan sama persis seperti dokumen Firestore lama (camelCase,
// createdAt/updatedAt/voidedAt sebagai {seconds,nanoseconds}) supaya MaterialsTab/ProductionTab
// tidak perlu berubah — pola sama seperti recaps-pg.ts/shipments-pg.ts.

export interface MaterialRow {
  id: string; name: string; unit: string; min_stock: string; stock_qty: string; avg_cost: string;
  created_at: Date; updated_at: Date | null;
}
export function rowToMaterial(r: MaterialRow) {
  return {
    id: r.id, name: r.name, unit: r.unit,
    minStock: Number(r.min_stock), stockQty: Number(r.stock_qty), avgCost: Number(r.avg_cost),
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}

export interface PurchaseItemRow { materialId: string; materialName: string; unit: string; qty: number; price: number; subtotal: number }
export interface PurchaseRow {
  id: string; supplier_id: string | null; supplier_name: string; items: unknown;
  total: string; date: string; payment_status: string; expense_id: string | null;
  note: string; wallet_id: string | null;
  voided: boolean; voided_at: Date | null; void_note: string | null;
  created_at: Date; updated_at: Date | null;
}
export function rowToPurchase(r: PurchaseRow) {
  return {
    id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name,
    items: (parseJsonb(r.items as string | PurchaseItemRow[] | null) as PurchaseItemRow[] | null) ?? [],
    total: Number(r.total), date: r.date, paymentStatus: r.payment_status, expenseId: r.expense_id,
    note: r.note, walletId: r.wallet_id,
    voided: r.voided, voidedAt: toTimestamp(r.voided_at), voidNote: r.void_note,
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}

export interface BatchOutputRow { productId: string; variantId?: string; productName: string; yieldQty: number; costPerPcs: number }
export interface BatchMaterialUsedRow { materialId: string; materialName: string; unit: string; qty: number; costPerUnit: number; cost: number }

// Gabungkan baris dengan id yang sama SEBELUM dipakai — dipakai baik saat catat produksi baru
// maupun edit, supaya batch tidak pernah menyimpan dua baris terpisah untuk produk/bahan yang
// sama (data lebih rapi, dan cocok dengan larangan pilih produk yang sama 2x di ProductionTab).
export function mergeMaterialsUsed<T extends { materialId: string; qty: number }>(rows: T[]): T[] {
  const merged = new Map<string, T>();
  for (const r of rows) {
    const qty = Number(r.qty) || 0;
    const existing = merged.get(r.materialId);
    if (existing) existing.qty += qty;
    else merged.set(r.materialId, { ...r, qty });
  }
  return [...merged.values()];
}

export function mergeOutputs<T extends { productId: string; variantId?: string; yieldQty: number }>(rows: T[]): T[] {
  const merged = new Map<string, T>();
  for (const r of rows) {
    const qty = Number(r.yieldQty) || 0;
    const key = stockKey(r.productId, r.variantId);
    const existing = merged.get(key);
    if (existing) existing.yieldQty += qty;
    else merged.set(key, { ...r, yieldQty: qty });
  }
  return [...merged.values()];
}
export interface ProductionBatchRow {
  id: string; date: string; outputs: unknown; materials_used: unknown;
  material_cost: string; other_cost: string; total_cost: string; total_yield_qty: string; cost_per_pcs: string;
  warehouse_id: string | null; warehouse_name: string | null; note: string; expense_id: string | null;
  created_at: Date; updated_at: Date | null;
}
export function rowToBatch(r: ProductionBatchRow) {
  return {
    id: r.id, date: r.date,
    outputs: (parseJsonb(r.outputs as string | BatchOutputRow[] | null) as BatchOutputRow[] | null) ?? [],
    materialsUsed: (parseJsonb(r.materials_used as string | BatchMaterialUsedRow[] | null) as BatchMaterialUsedRow[] | null) ?? [],
    materialCost: Number(r.material_cost), otherCost: Number(r.other_cost), totalCost: Number(r.total_cost),
    totalYieldQty: Number(r.total_yield_qty), costPerPcs: Number(r.cost_per_pcs),
    warehouseId: r.warehouse_id, warehouseName: r.warehouse_name ?? '', note: r.note, expenseId: r.expense_id,
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}
