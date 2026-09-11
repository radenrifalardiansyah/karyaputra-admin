import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

interface ImportRow {
  materialId: string; materialName: string; unit: string; qty: number; price: number;
  supplierName?: string; date?: string; note?: string; paymentStatus?: 'lunas' | 'belum_lunas';
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const { purchases } = await req.json() as { purchases: ImportRow[] };
  if (!Array.isArray(purchases) || purchases.length === 0) {
    return Response.json({ error: 'Tidak ada data pembelian untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const sql = getSql();
  let created = 0, skippedInvalid = 0;

  // Diproses satu per satu (bukan Promise.all) supaya update stok & harga rata-rata bahan baku
  // yang sama di baris berurutan tetap akurat — tiap baris harus melihat hasil baris sebelumnya.
  for (const row of purchases) {
    const qty = Number(row.qty) || 0;
    const price = Number(row.price) || 0;
    if (!row.materialId || qty <= 0 || price < 0) { skippedInvalid++; continue; }

    const paymentStatus = row.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
    const date = row.date || new Date().toISOString().slice(0, 10);
    const purchaseId = randomUUID();
    const expenseId = randomUUID();

    try {
      await sql.begin(async pgTx => {
        const [material] = await pgTx<{ stock_qty: string; avg_cost: string }[]>`select stock_qty, avg_cost from raw_materials where id = ${row.materialId} for update`;
        if (!material) throw new Error('not-found');

        const oldQty = Number(material.stock_qty) || 0;
        const oldAvg = Number(material.avg_cost) || 0;
        const newQty = oldQty + qty;
        const newAvg = newQty > 0 ? (oldQty * oldAvg + qty * price) / newQty : 0;
        await pgTx`update raw_materials set stock_qty = ${newQty}, avg_cost = ${newAvg}, updated_at = now() where id = ${row.materialId}`;

        const subtotal = qty * price;
        const willCreateExpense = subtotal > 0 && paymentStatus === 'lunas';
        const supplierName = (row.supplierName ?? '').toString().trim();
        const items = [{ materialId: row.materialId, materialName: row.materialName, unit: row.unit, qty, price, subtotal }];

        if (willCreateExpense) {
          await pgTx`
            insert into expenses (id, category, description, amount, date, note, source_type, source_id, created_at, updated_at)
            values (${expenseId}, 'Bahan Baku', ${`Pembelian bahan baku - ${row.supplierName || 'Tanpa nama'}`}, ${subtotal}, ${date}, ${`Otomatis dari pembelian bahan baku (${row.materialName})`}, 'material-purchase', ${purchaseId}, now(), now())
          `;
        }

        await pgTx`
          insert into material_purchases (id, supplier_id, supplier_name, items, total, date, payment_status, expense_id, note, created_at)
          values (${purchaseId}, null, ${supplierName}, ${JSON.stringify(items)}, ${subtotal}, ${date}, ${paymentStatus}, ${willCreateExpense ? expenseId : null}, ${(row.note ?? '').toString().trim()}, now())
        `;
      });
      created++;
    } catch {
      skippedInvalid++;
    }
  }

  try {
    await logHistory(db, {
      entity: 'material-purchases',
      entityId: `bulk-${Date.now()}`,
      entityLabel: `Impor massal ${created} pembelian bahan`,
      action: 'create',
      actor: guard,
      meta: { bulk: true, createdCount: created, rowCount: purchases.length },
    });
  } catch {
    // kegagalan menulis audit log tidak boleh menggagalkan hasil impor yang sudah terjadi
  }

  if (created > 0) revalidateTag('admin-expenses', { expire: 0 });
  return Response.json({ created, skippedInvalid });
}
