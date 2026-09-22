import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { computeWalletBalance } from '@/lib/wallet-balance';

type Ctx = { params: Promise<{ id: string }> };
interface SettlementRow {
  id: string; partner_id: string; partner_name: string | null; items: unknown; total_payable: string;
  wallet_id: string | null; note: string | null; expense_id: string | null; created_at: Date;
}

class SettleValidationError extends Error {}

// Edit settlement — HANYA dompet pembayaran & catatan yang bisa diubah (jumlah & rincian item
// dikunci karena itu snapshot dari tagihan consignment_in_ledger saat settlement dibuat; kalau mau
// koreksi jumlah, hapus settlement ini lalu bayar ulang). Menulis ke expenses (yang jadi sumber
// baris ini di Laporan Keuangan) SEKALIGUS consignment_in_settlements di transaksi yang sama,
// supaya keduanya tetap sinkron.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment-in', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<SettlementRow[]>`select * from consignment_in_settlements where id = ${id}`;
  if (!before) return Response.json({ error: 'Settlement tidak ditemukan.' }, { status: 404 });

  const data = await req.json() as { walletId?: string | null; note?: string };
  const payload = { walletId: data.walletId ?? null, note: data.note ?? '' };
  const db = getDb();

  try {
    await sql.begin(async pgTx => {
      if (payload.walletId) {
        await pgTx`select pg_advisory_xact_lock(hashtext(${payload.walletId}))`;
        const [walletRow] = await pgTx<{ initial_balance: string }[]>`select initial_balance from wallets where id = ${payload.walletId}`;
        const initialBalance = Number(walletRow?.initial_balance) || 0;
        const totalPayable = Number(before.total_payable) || 0;
        // excludeExpenseId — kontribusi lama expense settlement ini sendiri dikeluarkan dulu dari
        // total, supaya pindah dompet yang saldonya cukup tidak keblokir oleh dirinya sendiri.
        const balance = await computeWalletBalance(db, payload.walletId, initialBalance, undefined, undefined, pgTx, undefined, before.expense_id ?? undefined);
        if (totalPayable > balance) {
          throw new SettleValidationError(`Saldo dompet tidak cukup untuk settlement ini (saldo saat ini Rp${Math.round(balance).toLocaleString('id-ID')}).`);
        }
      }

      if (before.expense_id) {
        await pgTx`update expenses set wallet_id = ${payload.walletId}, note = ${payload.note}, updated_at = now() where id = ${before.expense_id}`;
      }
      await pgTx`update consignment_in_settlements set wallet_id = ${payload.walletId}, note = ${payload.note} where id = ${id}`;
    });
  } catch (err) {
    if (err instanceof SettleValidationError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah settlement.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInSettlements', entityId: id,
      entityLabel: `${before.partner_name ?? 'Settlement'}`, action: 'update', actor: guard,
      before: { walletId: before.wallet_id, note: before.note }, after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for consignment-in settlement update', err);
  }
  revalidateTag('admin-expenses', { expire: 0 });
  return Response.json({ ok: true });
}

// Hapus settlement — membalik tagihan consignment_in_ledger yang terlanjur ditandai 'settled' balik
// ke 'unsettled' (supaya bisa dibayar ulang), lalu menghapus baris expenses yang dibuat otomatis
// saat settle, lalu menghapus dokumen settlement itu sendiri — semuanya SATU transaksi. Settlement
// TIDAK menyentuh stok (itu urusan Terima/Retur), jadi tidak ada pembalikan stok di sini.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment-in', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [row] = await sql<SettlementRow[]>`select * from consignment_in_settlements where id = ${id}`;
  if (!row) return Response.json({ error: 'Settlement tidak ditemukan.' }, { status: 404 });

  try {
    await sql.begin(async pgTx => {
      await pgTx`
        update consignment_in_ledger set status = 'unsettled', settlement_id = null, settled_at = null
        where settlement_id = ${id} and status = 'settled'
      `;
      await pgTx`delete from consignment_in_settlements where id = ${id}`;
      if (row.expense_id) {
        await pgTx`delete from expenses where id = ${row.expense_id}`;
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus settlement.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInSettlements', entityId: id,
      entityLabel: `${row.partner_name ?? 'Settlement'} — Rp${(Number(row.total_payable) || 0).toLocaleString('id-ID')}`,
      action: 'delete', actor: guard, before: row,
    });
  } catch (err) {
    console.error('Failed to write history for consignment-in settlement delete', err);
  }
  revalidateTag('admin-expenses', { expire: 0 });
  return Response.json({ ok: true });
}
