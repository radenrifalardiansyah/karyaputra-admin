import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan (void) — jalan keluar kalau Hapus/Edit diblokir karena bahan baku sudah dipakai/dibeli
// lagi. Beda dari Hapus: baris pembelian TETAP ADA (ditandai voided) untuk jejak audit, bukan
// dihapus permanen. Stok & harga rata-rata dikembalikan dengan rumus reversal yang SAMA seperti
// DELETE — TAPI hanya kalau aman (belum ada pembelian/produksi lain yang menyentuh bahan baku yang
// sama setelah transaksi ini, sama seperti guard di PUT/DELETE). Kalau tidak aman, reversal
// dilewati (stok dibiarkan apa adanya) dan itu dilaporkan balik ke client lewat `reversed`/
// `skippedMaterials`, supaya UI bisa memberi tahu user secara akurat apakah stok betul-betul sudah
// dibetulkan atau masih perlu Koreksi manual di menu Stok.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const { note } = await req.json().catch(() => ({})) as { note?: string };
  const db = getDb();
  const sql = getSql();

  let before: ReturnType<typeof rowToPurchase>;
  let purchaseUpdate: Record<string, unknown>;
  let expenseDeleted: boolean;
  let reversed: boolean;
  let skippedMaterials: string[];

  try {
    ({ before, purchaseUpdate, expenseDeleted, reversed, skippedMaterials } = await sql.begin(async pgTx => {
      const [row] = await pgTx<PurchaseRow[]>`select * from material_purchases where id = ${id} for update`;
      if (!row) throw new Error('Pembelian tidak ditemukan.');
      const purchase = rowToPurchase(row);
      if (purchase.voided) throw new Error('Pembelian ini sudah dibatalkan sebelumnya.');

      const items = purchase.items;
      const materialIds = items.map(it => it.materialId);
      const materialRows = materialIds.length > 0
        ? await pgTx<{ id: string; stock_qty: string; avg_cost: string }[]>`select id, stock_qty, avg_cost from raw_materials where id in ${pgTx(materialIds)} order by id for update`
        : [];
      const materialById = new Map(materialRows.map(r => [r.id, r]));

      // Perbandingan lewat subquery, bukan JS Date `row.created_at` — sama seperti PUT & DELETE.
      const [laterPurchaseRows, laterBatchRows] = await Promise.all([
        pgTx<{ items: unknown }[]>`select items from material_purchases where created_at > (select created_at from material_purchases where id = ${id}) and id != ${id}`,
        pgTx<{ materials_used: unknown }[]>`select materials_used from production_batches where created_at > (select created_at from material_purchases where id = ${id})`,
      ]);
      const touchedAfter = new Set<string>();
      laterPurchaseRows.forEach(r => {
        ((parseJsonb(r.items) as { materialId: string }[] | null) ?? []).forEach(it => touchedAfter.add(it.materialId));
      });
      laterBatchRows.forEach(r => {
        ((parseJsonb(r.materials_used) as { materialId: string }[] | null) ?? []).forEach(m => touchedAfter.add(m.materialId));
      });

      const blockedNames = [...new Set(items.filter(it => touchedAfter.has(it.materialId)).map(it => it.materialName))];
      const canReverse = blockedNames.length === 0;

      if (canReverse) {
        for (const it of items) {
          const m = materialById.get(it.materialId);
          if (!m) continue;
          const curQty = Number(m.stock_qty) || 0;
          const curAvg = Number(m.avg_cost) || 0;
          const oldQty = curQty - it.qty;
          // Kebalikan dari rumus rata-rata tertimbang saat pembelian — sama seperti DELETE.
          const oldAvg = oldQty > 0 ? (curAvg * curQty - it.qty * it.price) / oldQty : 0;
          await pgTx`update raw_materials set stock_qty = ${Math.max(0, oldQty)}, avg_cost = ${Math.max(0, oldAvg)}, updated_at = now() where id = ${it.materialId}`;
        }
      }

      const voidNote = note?.trim() ?? '';
      await pgTx`
        update material_purchases set
          voided = true, voided_at = now(), void_note = ${voidNote},
          payment_status = 'belum_lunas', expense_id = null, updated_at = now()
        where id = ${id}
      `;

      // `material_purchases.expense_id` sudah dilepas (di atas) sebelum baris `expenses`-nya
      // dihapus — sama pola dengan production/[id]/route.ts.
      let deleted = false;
      if (purchase.expenseId) {
        const [expenseRow] = await pgTx<{ id: string }[]>`select id from expenses where id = ${purchase.expenseId}`;
        if (expenseRow) {
          await pgTx`delete from expenses where id = ${purchase.expenseId}`;
          deleted = true;
        }
      }

      return {
        before: purchase,
        purchaseUpdate: { voided: true, voidNote, paymentStatus: 'belum_lunas', expenseId: null },
        expenseDeleted: deleted,
        reversed: canReverse,
        skippedMaterials: blockedNames,
      };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membatalkan pembelian.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'material-purchases',
      entityId: id,
      entityLabel: `${before.supplierName?.trim() || 'Tanpa nama'} - Rp${before.total}`,
      action: 'update',
      actor: guard,
      before,
      after: { ...before, ...purchaseUpdate },
      meta: { stockReversed: reversed, skippedMaterials },
    });
  } catch (err) {
    console.error('Failed to write history for material purchase void', err);
  }
  if (expenseDeleted) revalidateTag('admin-expenses', { expire: 0 });

  return Response.json({ ok: true, reversed, skippedMaterials });
}
