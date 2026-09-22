import { parseJsonb } from '@/lib/db';
import { toTimestamp } from '@/lib/orders-pg';

// Versi Postgres dari dokumen `consignmentShipments` (Tahap 18a migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md). Shape JSON yang dikembalikan ke frontend dipertahankan sama
// persis seperti dokumen Firestore lama (camelCase, createdAt/updatedAt sebagai
// {seconds,nanoseconds}) supaya UI (ConsignmentTab) tidak perlu berubah — pola sama seperti
// recaps-pg.ts/orders-pg.ts.

export interface ShipmentItemRow { productId: string; variantId?: string; productName: string; qty: number; hargaTitip: number; subtotal: number }

export interface ShipmentRow {
  id: string;
  location_id: string | null;
  location_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  items: unknown;
  note: string | null;
  created_at: Date;
  updated_at: Date | null;
}

export function rowToShipment(r: ShipmentRow) {
  return {
    id: r.id,
    locationId: r.location_id,
    locationName: r.location_name,
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name ?? '',
    items: (parseJsonb(r.items as string | ShipmentItemRow[] | null) as ShipmentItemRow[] | null) ?? [],
    note: r.note ?? '',
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}
