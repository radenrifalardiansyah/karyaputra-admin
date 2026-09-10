import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

// Pembayaran ke partner "Titip Masuk" — melunasi sebagian/semua baris consignment_in_ledger yang
// masih 'unsettled' untuk satu partner sekaligus. Ditulis sebagai baris `expenses` biasa
// (source_type='consignment_in_settlement') di TRANSAKSI YANG SAMA (bukan best-effort cross-db
// seperti material-purchases — semuanya sudah di Postgres di sini), supaya otomatis muncul di
// Laporan Keuangan & mengurangi saldo dompet lewat computeWalletBalance TANPA perlu menyentuh
// wallet-balance.ts sama sekali. Lihat plan snug-sparking-ocean.md.

interface LedgerRow { id: string; product_id: string; product_name: string | null; qty: string; payout_amount: string; consignor_id: string }
interface SettlementRow {
  id: string; partner_id: string; partner_name: string | null; items: unknown; total_payable: string;
  wallet_id: string | null; note: string | null; expense_id: string | null; created_at: Date;
}
function rowToSettlement(r: SettlementRow) {
  return {
    id: r.id, partnerId: r.partner_id, partnerName: r.partner_name ?? '',
    items: r.items, totalPayable: Number(r.total_payable) || 0,
    walletId: r.wallet_id, note: r.note ?? '', expenseId: r.expense_id,
    createdAt: { seconds: Math.floor(r.created_at.getTime() / 1000) },
  };
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const sql = getSql();

  const rows = await sql<SettlementRow[]>`
    select * from consignment_in_settlements
    where (${partnerId}::text is null or partner_id = ${partnerId})
    order by created_at desc limit ${limit}
  `;
  return Response.json({ settlements: rows.map(rowToSettlement) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment-in', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    partnerId: string; partnerName: string; walletId?: string | null; note?: string;
    ledgerIds?: string[]; date?: string;
  };
  if (!data.partnerId) return Response.json({ error: 'Pilih partner.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const settlementId = randomUUID();
  const expenseId = randomUUID();
  const dateStr = data.date ?? new Date().toISOString().slice(0, 10);

  let totalPayable = 0;
  let settledCount = 0;
  let settledItems: { productId: string; productName: string; qty: number; payoutAmount: number }[] = [];

  try {
    await sql.begin(async pgTx => {
      const rows = Array.isArray(data.ledgerIds) && data.ledgerIds.length > 0
        ? await pgTx<LedgerRow[]>`
            select id, product_id, product_name, qty, payout_amount, consignor_id from consignment_in_ledger
            where id in ${pgTx(data.ledgerIds)} and consignor_id = ${data.partnerId} order by id for update
          `
        : await pgTx<LedgerRow[]>`
            select id, product_id, product_name, qty, payout_amount, consignor_id from consignment_in_ledger
            where consignor_id = ${data.partnerId} and status = 'unsettled' order by id for update
          `;

      if (Array.isArray(data.ledgerIds) && data.ledgerIds.length > 0) {
        const foundIds = new Set(rows.map(r => r.id));
        const missing = data.ledgerIds.filter(id => !foundIds.has(id));
        if (missing.length > 0) throw new Error('Sebagian baris tagihan yang dipilih tidak ditemukan / sudah tidak berlaku — muat ulang halaman.');
        // Re-check status di dalam lock (baris yang lolos select for update tapi ternyata sudah
        // disettle/dibatalkan sebelumnya harus ditolak, bukan disettle dobel).
        const statusRows = await pgTx<{ id: string; status: string }[]>`select id, status from consignment_in_ledger where id in ${pgTx(data.ledgerIds)}`;
        const notUnsettled = statusRows.filter(r => r.status !== 'unsettled');
        if (notUnsettled.length > 0) throw new Error('Sebagian baris tagihan yang dipilih sudah dibayar/dibatalkan — muat ulang halaman.');
      }

      if (rows.length === 0) throw new Error('Tidak ada tagihan yang belum dibayar untuk partner ini.');

      const merged = new Map<string, { productId: string; productName: string; qty: number; payoutAmount: number }>();
      for (const r of rows) {
        const qty = Number(r.qty) || 0;
        const payoutAmount = Number(r.payout_amount) || 0;
        totalPayable += payoutAmount;
        const existing = merged.get(r.product_id);
        if (existing) { existing.qty += qty; existing.payoutAmount += payoutAmount; }
        else merged.set(r.product_id, { productId: r.product_id, productName: r.product_name ?? '', qty, payoutAmount });
      }
      settledItems = [...merged.values()];
      settledCount = rows.length;

      await pgTx`
        insert into consignment_in_settlements (id, partner_id, partner_name, items, total_payable, wallet_id, note, expense_id, created_at)
        values (${settlementId}, ${data.partnerId}, ${data.partnerName}, ${JSON.stringify(settledItems)}, ${totalPayable}, ${data.walletId ?? null}, ${data.note ?? ''}, ${expenseId}, now())
      `;

      await pgTx`
        insert into expenses (id, category, description, amount, date, note, wallet_id, source_type, source_id, created_at, updated_at)
        values (
          ${expenseId}, 'Konsinyasi Masuk', ${`Pembayaran titipan – ${data.partnerName}`}, ${totalPayable}, ${dateStr},
          ${data.note ?? ''}, ${data.walletId ?? null}, 'consignment_in_settlement', ${settlementId}, now(), now()
        )
      `;

      const rowIds = rows.map(r => r.id);
      await pgTx`
        update consignment_in_ledger set status = 'settled', settlement_id = ${settlementId}, settled_at = now()
        where id in ${pgTx(rowIds)}
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan settlement.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment-in', entityCollection: 'consignmentInSettlements', entityId: settlementId,
      entityLabel: `${data.partnerName ?? 'Settlement'}${data.date ? ` - ${data.date}` : ''}`,
      action: 'create', actor: guard, after: { partnerId: data.partnerId, partnerName: data.partnerName, items: settledItems, totalPayable, walletId: data.walletId ?? null },
    });
  } catch (err) {
    console.error('Failed to write history for consignment-in settlement create', err);
  }
  try {
    await notify(db, {
      type: 'consignment_in_settle',
      title: 'Pembayaran titipan masuk',
      message: `${settledCount} tagihan (Rp${totalPayable.toLocaleString('id-ID')}) dibayar ke ${data.partnerName} — oleh ${guard.username}.`,
      link: 'consignment-in',
      entityCollection: 'consignmentInSettlements', entityId: settlementId, actor: guard,
    });
  } catch (err) {
    console.error('Failed to send notification for consignment-in settlement', err);
  }

  return Response.json({ id: settlementId, totalPayable });
}
