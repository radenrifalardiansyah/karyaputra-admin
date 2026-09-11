import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';

interface PurchaseItemInput {
  materialId: string; materialName: string; unit: string;
  qty: number; price: number;
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const sql = getSql();
  const rows = await sql<PurchaseRow[]>`select * from material_purchases order by created_at desc limit ${limit}`;
  return Response.json({ purchases: rows.map(rowToPurchase) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    supplierId?: string; supplierName: string; date?: string; note?: string; items: PurchaseItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
  };
  const items = data.items ?? [];
  if (items.length === 0) return Response.json({ error: 'Minimal 1 bahan baku.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const date = data.date || new Date().toISOString().slice(0, 10);

  const db = getDb();
  const sql = getSql();
  const purchaseId = randomUUID();
  const expenseId = randomUUID();
  let purchaseData: Record<string, unknown> = {};

  // Bahan baku (Tahap 18b) DAN dokumen pembelian & pengeluaran otomatis (expenses, Tahap 5)
  // sekarang sama-sama di Postgres, jadi digabung jadi SATU transaksi atomic — tidak ada lagi
  // "expense ditulis setelah transaksi Firestore commit" seperti versi sebelumnya.
  try {
    await sql.begin(async pgTx => {
      const materialIds = items.map(it => it.materialId);
      const materialRows = await pgTx<{ id: string; stock_qty: string; avg_cost: string }[]>`
        select id, stock_qty, avg_cost from raw_materials where id in ${pgTx(materialIds)} order by id for update
      `;
      const materialById = new Map(materialRows.map(r => [r.id, r]));
      items.forEach(it => { if (!materialById.has(it.materialId)) throw new Error(`Bahan baku "${it.materialName}" tidak ditemukan.`); });

      const itemsWithSubtotal = items.map(it => ({ ...it, subtotal: it.qty * it.price }));
      const total = itemsWithSubtotal.reduce((s, it) => s + it.subtotal, 0);

      for (const it of items) {
        const m = materialById.get(it.materialId)!;
        const oldQty = Number(m.stock_qty) || 0;
        const oldAvg = Number(m.avg_cost) || 0;
        const newQty = oldQty + it.qty;
        const newAvg = newQty > 0 ? (oldQty * oldAvg + it.qty * it.price) / newQty : 0;
        await pgTx`update raw_materials set stock_qty = ${newQty}, avg_cost = ${newAvg}, updated_at = now() where id = ${it.materialId}`;
      }

      // Catat otomatis sebagai Pengeluaran (uang keluar beneran saat beli bahan baku) — cuma kalau
      // sudah lunas. Kalau belum lunas, pengeluaran baru dicatat saat ditandai lunas (lihat
      // [id]/mark-lunas/route.ts), supaya Jurnal Kas/Laba Rugi tidak menghitung uang yang belum
      // benar-benar keluar.
      const willCreateExpense = total > 0 && paymentStatus === 'lunas';

      purchaseData = {
        supplierId: data.supplierId ?? null,
        supplierName: data.supplierName ?? '',
        items: itemsWithSubtotal,
        total, date, paymentStatus,
        expenseId: willCreateExpense ? expenseId : null,
        note: data.note ?? '', walletId: data.walletId ?? null,
      };
      if (willCreateExpense) {
        const itemNames = itemsWithSubtotal.map(it => it.materialName).join(', ');
        await pgTx`
          insert into expenses (id, category, description, amount, date, note, wallet_id, source_type, source_id, created_at, updated_at)
          values (${expenseId}, 'Bahan Baku', ${`Pembelian bahan baku - ${data.supplierName || 'Tanpa nama'}`}, ${total}, ${date}, ${`Otomatis dari pembelian bahan baku (${itemNames})`}, ${data.walletId ?? null}, 'material-purchase', ${purchaseId}, now(), now())
        `;
      }

      await pgTx`
        insert into material_purchases (id, supplier_id, supplier_name, items, total, date, payment_status, expense_id, note, wallet_id, created_at)
        values (${purchaseId}, ${data.supplierId ?? null}, ${data.supplierName ?? ''}, ${JSON.stringify(itemsWithSubtotal)}, ${total}, ${date}, ${paymentStatus}, ${willCreateExpense ? expenseId : null}, ${data.note ?? ''}, ${data.walletId ?? null}, now())
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan pembelian.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'material-purchases',
      entityId: purchaseId,
      entityLabel: `${data.supplierName?.trim() || 'Tanpa nama'} - Rp${purchaseData.total}`,
      action: 'create',
      actor: guard,
      after: purchaseData,
    });
  } catch (err) {
    console.error('Failed to write history for material purchase create', err);
  }
  if (purchaseData.expenseId) revalidateTag('admin-expenses', { expire: 0 });

  return Response.json({ id: purchaseId });
}
