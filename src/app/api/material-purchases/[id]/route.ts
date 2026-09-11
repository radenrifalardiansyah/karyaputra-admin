import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';

type Ctx = { params: Promise<{ id: string }> };

interface PurchaseItem { materialId: string; materialName: string; unit: string; qty: number; price: number }

const itemsKey = (items: PurchaseItem[]) =>
  JSON.stringify(items.map(it => ({ materialId: it.materialId, qty: it.qty, price: it.price })));

// Edit — kalau daftar bahan baku/qty/harga berubah, HANYA diizinkan kalau tidak ada pembelian/produksi
// lain yang menyentuh salah satu bahan baku (lama maupun baru) SETELAH transaksi ini dibuat, supaya
// stok & harga rata-rata (avgCost) bisa dihitung ulang dengan tepat. Kalau cuma ganti supplier/tanggal/
// catatan/status bayar tanpa mengubah barang, selalu boleh (tidak menyentuh stok).
//
// Bahan baku, dokumen pembelian, DAN pengeluaran otomatis (expenses) sekarang sama-sama Postgres
// (Tahap 18b) — digabung jadi SATU transaksi. Kunci baris raw_materials (FOR UPDATE) diambil
// SEBELUM cek "sudah disentuh transaksi lain setelah ini" — itu menyerialkan pembelian/produksi lain
// yang menyentuh material yang sama, menutup celah race yang dulu diandalkan pada auto-retry
// transaksi Firestore.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    supplierId?: string; supplierName: string; date?: string; note?: string;
    items: PurchaseItem[]; paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
  };
  const newItems = data.items ?? [];
  if (newItems.length === 0) return Response.json({ error: 'Minimal 1 bahan baku.' }, { status: 400 });
  const newPaymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const date = data.date || new Date().toISOString().slice(0, 10);

  const db = getDb();
  const sql = getSql();
  const newExpenseId = randomUUID();

  let before: ReturnType<typeof rowToPurchase>;
  let purchaseUpdate: Record<string, unknown>;
  let expenseChanged: boolean;

  try {
    ({ before, purchaseUpdate, expenseChanged } = await sql.begin(async pgTx => {
      const [row] = await pgTx<PurchaseRow[]>`select * from material_purchases where id = ${id} for update`;
      if (!row) throw new Error('Pembelian tidak ditemukan.');
      const purchase = rowToPurchase(row);
      let expenseChangedLocal = false;
      const oldItems = purchase.items;
      const itemsChanged = itemsKey(oldItems) !== itemsKey(newItems);

      let itemsWithSubtotal = oldItems.map(it => ({ ...it, subtotal: it.qty * it.price }));
      let total = purchase.total;

      if (itemsChanged) {
        const materialIds = [...new Set([...oldItems.map(it => it.materialId), ...newItems.map(it => it.materialId)])];
        const materialRows = await pgTx<{ id: string; stock_qty: string; avg_cost: string }[]>`
          select id, stock_qty, avg_cost from raw_materials where id in ${pgTx(materialIds)} order by id for update
        `;
        const materialById = new Map(materialRows.map(r => [r.id, r]));
        newItems.forEach(it => { if (!materialById.has(it.materialId)) throw new Error(`Bahan baku "${it.materialName}" tidak ditemukan.`); });

        const [laterPurchaseRows, laterBatchRows] = await Promise.all([
          // Perbandingan lewat subquery (bukan JS Date yang dibaca balik dari `row.created_at`)
          // supaya presisi mikrodetik asli `timestamptz` tidak hilang — postgres.js/JS Date cuma
          // presisi milidetik, jadi meneruskan balik `row.created_at` sebagai parameter bisa
          // membuat baris ITU SENDIRI lolos `created_at > $1` (nilai tersimpan sesungguhnya
          // sedikit lebih besar dari versi yang dibulatkan ke bawah). `id != ${id}` sebagai jaring
          // pengaman tambahan.
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
        const blocked = materialIds.filter(mid => touchedAfter.has(mid));
        if (blocked.length > 0) {
          const names = [...oldItems, ...newItems].filter(it => blocked.includes(it.materialId)).map(it => it.materialName);
          throw new Error(`Tidak bisa diedit — bahan baku sudah dibeli/dipakai lagi setelah transaksi ini: ${[...new Set(names)].join(', ')}.`);
        }

        const finalState = new Map<string, { qty: number; avg: number }>();
        materialIds.forEach(mid => {
          const m = materialById.get(mid)!;
          finalState.set(mid, { qty: Number(m.stock_qty) || 0, avg: Number(m.avg_cost) || 0 });
        });

        // Kembalikan dulu efek barang lama, baru terapkan barang baru — persis reversal+forward
        // yang dipakai di DELETE & POST, supaya avgCost tetap konsisten.
        oldItems.forEach(it => {
          const st = finalState.get(it.materialId)!;
          const qty = st.qty - it.qty;
          const avg = qty > 0 ? (st.avg * st.qty - it.qty * it.price) / qty : 0;
          finalState.set(it.materialId, { qty, avg });
        });
        newItems.forEach(it => {
          const st = finalState.get(it.materialId)!;
          const qty = st.qty + it.qty;
          const avg = qty > 0 ? (st.avg * st.qty + it.qty * it.price) / qty : 0;
          finalState.set(it.materialId, { qty, avg });
        });

        for (const mid of materialIds) {
          const st = finalState.get(mid)!;
          await pgTx`update raw_materials set stock_qty = ${Math.max(0, st.qty)}, avg_cost = ${Math.max(0, st.avg)}, updated_at = now() where id = ${mid}`;
        }

        itemsWithSubtotal = newItems.map(it => ({ ...it, subtotal: it.qty * it.price }));
        total = itemsWithSubtotal.reduce((s, it) => s + it.subtotal, 0);
      }

      // Sinkronkan Pengeluaran otomatis dengan status pembayaran & total terbaru. Expense lama
      // dianggap "ada" hanya kalau benar-benar masih ada di database (bisa saja sudah dihapus
      // manual dari menu Pengeluaran) — kalau sudah tidak ada, dibuatkan baru, bukan update
      // yang akan gagal karena baris-nya tidak ada.
      const oldExpenseId = purchase.expenseId;
      const [oldExpenseRow] = oldExpenseId ? await pgTx<{ id: string }[]>`select id from expenses where id = ${oldExpenseId}` : [];
      const oldExpenseExists = !!oldExpenseRow;
      let expenseIdToStore: string | null = oldExpenseExists ? (oldExpenseId ?? null) : null;
      let expenseIdToDelete: string | null = null;
      const supplierName = data.supplierName ?? purchase.supplierName ?? '';
      const walletId = data.walletId !== undefined ? data.walletId : (purchase.walletId ?? null);

      if (newPaymentStatus === 'lunas') {
        expenseChangedLocal = true;
        if (oldExpenseExists && oldExpenseId) {
          await pgTx`update expenses set description = ${`Pembelian bahan baku - ${supplierName || 'Tanpa nama'}`}, amount = ${total}, date = ${date}, wallet_id = ${walletId}, updated_at = now() where id = ${oldExpenseId}`;
        } else {
          expenseIdToStore = newExpenseId;
          const itemNames = itemsWithSubtotal.map(it => it.materialName).join(', ');
          await pgTx`
            insert into expenses (id, category, description, amount, date, note, wallet_id, source_type, source_id, created_at, updated_at)
            values (${newExpenseId}, 'Bahan Baku', ${`Pembelian bahan baku - ${supplierName || 'Tanpa nama'}`}, ${total}, ${date}, ${`Otomatis dari pembelian bahan baku (${itemNames})`}, ${walletId}, 'material-purchase', ${id}, now(), now())
          `;
        }
      } else if (oldExpenseExists && oldExpenseId) {
        // Baris `expenses` baru boleh dihapus SETELAH `material_purchases.expense_id` dilepas
        // (di bawah) — sama seperti pola di production/[id]/route.ts.
        expenseChangedLocal = true;
        expenseIdToDelete = oldExpenseId;
        expenseIdToStore = null;
      }

      const purchaseUpdateLocal = {
        supplierId: data.supplierId ?? null, supplierName, items: itemsWithSubtotal, total, date,
        paymentStatus: newPaymentStatus, expenseId: expenseIdToStore, note: data.note ?? '', walletId,
      };
      await pgTx`
        update material_purchases set
          supplier_id = ${data.supplierId ?? null}, supplier_name = ${supplierName},
          items = ${JSON.stringify(itemsWithSubtotal)}, total = ${total}, date = ${date},
          payment_status = ${newPaymentStatus}, expense_id = ${expenseIdToStore}, note = ${data.note ?? ''},
          wallet_id = ${walletId}, updated_at = now()
        where id = ${id}
      `;
      if (expenseIdToDelete) {
        await pgTx`delete from expenses where id = ${expenseIdToDelete}`;
      }
      return { before: purchase, purchaseUpdate: purchaseUpdateLocal, expenseChanged: expenseChangedLocal };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'material-purchases',
      entityId: id,
      entityLabel: `${(purchaseUpdate.supplierName as string) || 'Tanpa nama'} - Rp${purchaseUpdate.total}`,
      action: 'update',
      actor: guard,
      before,
      after: { ...before, ...purchaseUpdate },
    });
  } catch (err) {
    console.error('Failed to write history for material purchase update', err);
  }
  if (expenseChanged) revalidateTag('admin-expenses', { expire: 0 });

  return Response.json({ ok: true });
}

// Hapus — HANYA diizinkan kalau tidak ada pembelian/produksi lain yang menyentuh salah satu bahan
// baku di transaksi ini SETELAH transaksi ini dibuat. Kalau aman, stok & harga rata-rata (avgCost)
// tiap bahan baku dikembalikan persis seperti sebelum pembelian ini, dan Pengeluaran otomatisnya
// (kalau ada) ikut dihapus — semuanya dalam satu transaksi Postgres (Tahap 18b).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  let before: ReturnType<typeof rowToPurchase>;
  let expenseDeleted: boolean;

  try {
    ({ before, expenseDeleted } = await sql.begin(async pgTx => {
      const [row] = await pgTx<PurchaseRow[]>`select * from material_purchases where id = ${id} for update`;
      if (!row) throw new Error('Pembelian tidak ditemukan.');
      const purchase = rowToPurchase(row);
      let deleted = false;
      const items = purchase.items;

      const materialIds = items.map(it => it.materialId);
      const materialRows = materialIds.length > 0
        ? await pgTx<{ id: string; stock_qty: string; avg_cost: string }[]>`select id, stock_qty, avg_cost from raw_materials where id in ${pgTx(materialIds)} order by id for update`
        : [];
      const materialById = new Map(materialRows.map(r => [r.id, r]));

      // Perbandingan lewat subquery, bukan JS Date `row.created_at` — lihat komentar sama di PUT.
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
      const blockedNames = items.filter(it => touchedAfter.has(it.materialId)).map(it => it.materialName);
      if (blockedNames.length > 0) {
        throw new Error(`Tidak bisa dihapus — bahan baku sudah dibeli/dipakai lagi setelah transaksi ini: ${blockedNames.join(', ')}.`);
      }

      for (const it of items) {
        const m = materialById.get(it.materialId);
        if (!m) continue;
        const curQty = Number(m.stock_qty) || 0;
        const curAvg = Number(m.avg_cost) || 0;
        const oldQty = curQty - it.qty;
        // Kebalikan dari rumus rata-rata tertimbang saat pembelian: curAvg = (oldQty*oldAvg + qty*price) / curQty
        const oldAvg = oldQty > 0 ? (curAvg * curQty - it.qty * it.price) / oldQty : 0;
        await pgTx`update raw_materials set stock_qty = ${Math.max(0, oldQty)}, avg_cost = ${Math.max(0, oldAvg)}, updated_at = now() where id = ${it.materialId}`;
      }

      // `material_purchases` harus dihapus DULU sebelum `expenses` — sama pola dengan
      // production/[id]/route.ts DELETE.
      await pgTx`delete from material_purchases where id = ${id}`;

      if (purchase.expenseId) {
        const [expenseRow] = await pgTx<{ id: string }[]>`select id from expenses where id = ${purchase.expenseId}`;
        if (expenseRow) {
          await pgTx`delete from expenses where id = ${purchase.expenseId}`;
          deleted = true;
        }
      }

      return { before: purchase, expenseDeleted: deleted };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus pembelian.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'material-purchases',
      entityId: id,
      entityLabel: `${before.supplierName?.trim() || 'Tanpa nama'} - Rp${before.total}`,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch (err) {
    console.error('Failed to write history for material purchase delete', err);
  }
  if (expenseDeleted) revalidateTag('admin-expenses', { expire: 0 });

  return Response.json({ ok: true });
}
