import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';

type Ctx = { params: Promise<{ id: string }> };

// Tandai Lunas — baru di sini pengeluaran otomatis dibuat (uang benar-benar keluar sekarang),
// supaya tidak dobel hitung dengan pengeluaran yang seharusnya sudah dicatat kalau langsung lunas.
// Pakai tanggal pembelian yang sudah diisi manual (bisa mundur), bukan tanggal hari ini.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();
  const expenseId = randomUUID();

  let before: ReturnType<typeof rowToPurchase>;
  let didMark: boolean;

  try {
    ({ before, didMark } = await sql.begin(async pgTx => {
      const [row] = await pgTx<PurchaseRow[]>`select * from material_purchases where id = ${id} for update`;
      if (!row) throw new Error('Pembelian tidak ditemukan.');
      const purchase = rowToPurchase(row);
      if (purchase.paymentStatus !== 'belum_lunas') return { before: purchase, didMark: false }; // sudah lunas, tidak perlu apa-apa

      const willCreateExpense = purchase.total > 0;
      if (willCreateExpense) {
        const itemNames = purchase.items.map(it => it.materialName).join(', ');
        await pgTx`
          insert into expenses (id, category, description, amount, date, note, wallet_id, source_type, source_id, created_at, updated_at)
          values (${expenseId}, 'Bahan Baku', ${`Pembelian bahan baku - ${purchase.supplierName || 'Tanpa nama'}`}, ${purchase.total}, ${purchase.date}, ${`Otomatis dari pembelian bahan baku (${itemNames}) — ditandai lunas`}, ${purchase.walletId}, 'material-purchase', ${id}, now(), now())
        `;
      }

      await pgTx`update material_purchases set payment_status = 'lunas', expense_id = ${willCreateExpense ? expenseId : null}, updated_at = now() where id = ${id}`;

      return { before: purchase, didMark: true };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menandai lunas.' }, { status: 400 });
  }

  if (didMark) {
    try {
      await logHistory(db, {
        entity: 'material-purchases',
        entityId: id,
        entityLabel: `${before.supplierName?.trim() || 'Tanpa nama'} - Rp${before.total}`,
        action: 'update',
        actor: guard,
        before,
        after: { ...before, paymentStatus: 'lunas', expenseId: before.total > 0 ? expenseId : null },
      });
    } catch (err) {
      console.error('Failed to write history for material purchase mark-lunas', err);
    }
    if (before.total > 0) revalidateTag('admin-expenses', { expire: 0 });
  }

  return Response.json({ ok: true });
}
