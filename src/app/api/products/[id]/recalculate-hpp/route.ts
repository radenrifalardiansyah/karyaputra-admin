import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

// Timpa HPP (costPrice) yang SUDAH tersimpan di semua order & rekap konsinyasi lama yang
// mengandung produk ini dengan Harga Modal terkini — dipakai saat HPP lama diketahui salah input
// dan perlu dikoreksi retroaktif. Beda dari tombol "Hitung Ulang HPP" di Laporan Keuangan, yang
// cuma mengisi fallback untuk transaksi yang costPrice-nya kosong, bukan menimpa yang sudah ada
// (lihat effectiveCostPrice di FinanceReportTab.tsx — snapshot costPrice yang truthy selalu menang).
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [productRow] = await sql<{ cost_price: string | null; name: string | null; owner_type: string | null }[]>`
    select cost_price, name, owner_type from products where id = ${id}
  `;
  if (!productRow) return Response.json({ error: 'Produk tidak ditemukan.' }, { status: 404 });
  // Untuk produk "Titip Masuk" (konsinyasi masuk), costPrice di tiap item order BUKAN HPP biasa —
  // itu payout yang sudah/akan dibayar ke partner (lihat consignment-in.ts), dihitung dari aturan
  // settlement produk saat transaksi terjadi, bukan dari cost_price. Menimpanya dengan cost_price
  // di sini akan merusak angka payout yang sudah tercatat (bahkan yang sudah disettle ke partner).
  if (productRow.owner_type === 'consigned_in') {
    return Response.json({ error: 'Produk ini adalah titipan masuk — HPP historisnya adalah payout ke partner, tidak bisa ditimpa lewat sini.' }, { status: 400 });
  }
  const costPrice = productRow.cost_price != null ? Number(productRow.cost_price) : 0;
  const productName = productRow.name ?? '';

  // `orders` & `consignment_recaps` sudah di Postgres (Tahap 12 & 13 migrasi Fase 2 — lihat plan
  // gleaming-wondering-quokka.md) — jumlah baris masih kecil, jadi cukup scan semua & filter di JS,
  // sama seperti pola lama.
  const [orderRows, recapRows] = await Promise.all([
    sql<{ id: string; items: unknown }[]>`select id, items from orders`,
    sql<{ id: string; items: unknown }[]>`select id, items from consignment_recaps`,
  ]);

  let updatedOrders = 0;
  let updatedRecaps = 0;

  for (const row of orderRows) {
    const items = parseJsonb(row.items) as { productId?: string; costPrice?: number }[] | null;
    if (!items?.some(it => it.productId === id)) continue;
    const newItems = items.map(it => (it.productId === id ? { ...it, costPrice } : it));
    await sql`update orders set items = ${JSON.stringify(newItems)}, updated_at = now() where id = ${row.id}`;
    updatedOrders++;
  }

  for (const row of recapRows) {
    const items = parseJsonb(row.items) as { productId?: string; costPrice?: number; qtySold?: number }[] | null;
    if (!items?.some(it => it.productId === id)) continue;
    const newItems = items.map(it => (it.productId === id ? { ...it, costPrice, cogs: (it.qtySold ?? 0) * costPrice } : it));
    await sql`update consignment_recaps set items = ${JSON.stringify(newItems)}, updated_at = now() where id = ${row.id}`;
    updatedRecaps++;
  }

  await logHistory(db, {
    entity: 'products',
    entityId: id,
    entityLabel: `Hitung Ulang HPP Retroaktif - ${productName}`,
    action: 'update',
    actor: guard,
    meta: { costPrice, updatedOrders, updatedRecaps },
  }).catch(err => console.error('Failed to log recalculate-hpp history', err));

  return Response.json({ ok: true, costPrice, updatedOrders, updatedRecaps });
}
