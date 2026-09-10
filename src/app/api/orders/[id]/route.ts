import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { restoreOrderStockInTxPg, RestorableOrderItem } from '@/lib/order-stock-pg';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { writeConsignmentInLedgerEntryPg } from '@/lib/consignment-in';
import { logHistory } from '@/lib/history';
import { getSettings } from '@/lib/settings-pg';
import { revalidateStorefront } from '@/lib/revalidate';
import { rowToOrder, OrderRow } from '@/lib/orders-pg';

type Ctx = { params: Promise<{ id: string }> };

interface OrderItemInput { productId?: string; name: string; weight: string; qty: number; price: number; subtotal: number; costPrice?: number }
interface OrderEditInput {
  customerName: string; customerPhone?: string; items: OrderItemInput[];
  subtotal: number; discount?: { amount: number; label: string }; total: number;
  paymentMethod?: 'cash' | 'transfer' | 'qris' | 'kredit';
  amountPaid?: number; changeAmount?: number;
  transferBank?: string; transferAmount?: number; transferProofUrl?: string;
  paymentStatus?: 'lunas' | 'belum_lunas'; note?: string;
  date?: string; transactionAt?: string; walletId?: string | null;
}

// Kegagalan yang diketahui (bukan/sudah dibatalkan, stok kurang) — dilempar dari dalam transaksi
// supaya bisa dibedakan dari error tak terduga dan diterjemahkan ke status HTTP yang tepat, sama
// pola dengan TransferValidationError di wallet-transfers/route.ts.
class OrderNotFoundError extends Error {}
class OrderValidationError extends Error {}

function qtyByProduct(items: OrderItemInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    if (!it.productId || !it.qty) continue;
    map.set(it.productId, (map.get(it.productId) ?? 0) + it.qty);
  }
  return map;
}

function toRestorable(order: ReturnType<typeof rowToOrder>) {
  return {
    items: order.items as RestorableOrderItem[],
    source: order.source,
    invoiceNo: order.invoiceNo,
    stockCut: order.stockCut,
    stockRestored: order.stockRestored,
    warehouseId: order.warehouseId,
    warehouseName: order.warehouseName,
  };
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'orders', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json() as { status?: string; paymentStatus?: string; walletId?: string | null; items?: OrderItemInput[] } & Partial<OrderEditInput>;
  const db = getDb();
  const sql = getSql();

  // Order dan stok sekarang sama-sama di Postgres (Tahap 9-12 Fase 2 — lihat plan
  // gleaming-wondering-quokka.md), jadi satu transaksi (`sql.begin`) sudah cukup — baris order
  // dikunci (`for update`) di awal, jadi tidak perlu lagi baca-ulang "fresh" di tengah untuk cegah
  // race seperti versi Firestore sebelumnya, dan tidak ada lagi kompensasi cross-database.
  if (Array.isArray(body.items)) {
    const data = body as OrderEditInput;
    let txResult: { orderBefore: ReturnType<typeof rowToOrder>; orderAfter: Record<string, unknown> };

    try {
      txResult = await sql.begin(async pgTx => {
        const [orderRow] = await pgTx<OrderRow[]>`select * from orders where id = ${id} for update`;
        if (!orderRow) throw new OrderNotFoundError('Pesanan tidak ditemukan.');
        const order = rowToOrder(orderRow);
        if (order.status === 'dibatalkan') throw new OrderValidationError('Pesanan yang sudah dibatalkan tidak bisa diedit.');

        // Pertahankan snapshot HPP (costPrice) tiap item lama — costPrice produk adalah rata-rata
        // bergerak, jadi baris yang qty/harganya diedit tetap pakai costPrice lama; hanya baris
        // produk yang BENAR-BENAR baru yang costPrice-nya diambil dari HPP produk saat ini.
        const oldCostByProductId = new Map<string, number>();
        (order.items as OrderItemInput[]).forEach(it => {
          if (it.productId) oldCostByProductId.set(it.productId, Number(it.costPrice) || 0);
        });
        const newProductIds = [...new Set(
          data.items.map(it => it.productId).filter((pid): pid is string => !!pid && !oldCostByProductId.has(pid)),
        )];
        const freshCostRows = newProductIds.length > 0
          ? await pgTx<{ id: string; cost_price: string | null }[]>`select id, cost_price from products where id in ${pgTx(newProductIds)}`
          : [];
        const freshCostByProductId = new Map(freshCostRows.map(r => [r.id, r.cost_price != null ? Number(r.cost_price) : 0]));

        const stockCut = order.stockCut === true || (order.source === 'kasir' && order.stockCut === undefined);
        const deltas = new Map<string, number>();
        if (stockCut) {
          const oldQty = qtyByProduct((order.items as OrderItemInput[]) ?? []);
          const newQty = qtyByProduct(data.items);
          const productIds = new Set([...oldQty.keys(), ...newQty.keys()]);
          for (const pid of productIds) {
            const delta = (newQty.get(pid) ?? 0) - (oldQty.get(pid) ?? 0);
            if (delta !== 0) deltas.set(pid, delta);
          }
        }

        if (deltas.size > 0) {
          // qtyByProduct delta di atas positif = lebih banyak dipesan = stok berkurang, jadi
          // dibalik tandanya untuk dipakai sebagai delta stok (negatif = keluar).
          // CATATAN: kalau item yang diedit adalah produk "Titip Masuk" (konsinyasi masuk),
          // consignment_in_ledger TIDAK ikut disesuaikan di sini (hanya dibuat di checkout awal &
          // dibatalkan di restoreOrderStockInTxPg) — perubahan qty lewat edit pesanan untuk produk
          // titipan perlu direkonsiliasi manual dulu selama belum ada endpoint penyesuaian ledger.
          const stockDeltas = new Map([...deltas].map(([pid, d]) => [pid, -d] as [string, number]));
          const { products, shortages } = await readProductsForDeltasPg(pgTx, stockDeltas);
          if (shortages.length > 0) throw new OrderValidationError(`Stok tidak cukup: ${shortages.join(', ')}`);
          for (const [pid, stockDelta] of stockDeltas) {
            const product = products.get(pid)!;
            await applyStockDeltaPg(pgTx, { productId: pid, product, warehouseId: order.warehouseId, delta: stockDelta });
            await writeStockLedgerEntryPg(pgTx, {
              productId: pid, productName: product.name, warehouseId: order.warehouseId, warehouseName: order.warehouseName,
              type: stockDelta < 0 ? 'out' : 'in', qty: stockDelta,
              note: `Edit pesanan ${order.invoiceNo ?? ''}`,
            });
          }
        }

        const items = data.items.map(it => ({
          ...it,
          subtotal: it.price * it.qty,
          costPrice: it.productId ? (oldCostByProductId.get(it.productId) ?? freshCostByProductId.get(it.productId) ?? 0) : 0,
        }));

        const updateCols: Record<string, unknown> = { items: JSON.stringify(items), updated_at: new Date() };
        if (data.customerName !== undefined) updateCols.customer_name = data.customerName;
        if (data.customerPhone !== undefined) updateCols.customer_phone = data.customerPhone;
        if (data.subtotal !== undefined) updateCols.subtotal = data.subtotal;
        if (data.discount !== undefined) updateCols.discount = data.discount ? JSON.stringify(data.discount) : null;
        if (data.total !== undefined) updateCols.total = data.total;
        if (data.paymentMethod !== undefined) updateCols.payment_method = data.paymentMethod;
        if (data.amountPaid !== undefined) updateCols.amount_paid = data.amountPaid;
        if (data.changeAmount !== undefined) updateCols.change_amount = data.changeAmount;
        if (data.transferBank !== undefined) updateCols.transfer_bank = data.transferBank;
        if (data.transferAmount !== undefined) updateCols.transfer_amount = data.transferAmount;
        if (data.transferProofUrl !== undefined) updateCols.transfer_proof_url = data.transferProofUrl;
        if (data.paymentStatus !== undefined) updateCols.payment_status = data.paymentStatus;
        if (data.note !== undefined) updateCols.note = data.note;
        if (data.walletId !== undefined) updateCols.wallet_id = data.walletId;
        if (data.date !== undefined) updateCols.date = data.date;
        if (data.transactionAt !== undefined) updateCols.created_at = new Date(data.transactionAt);

        await pgTx`update orders set ${pgTx(updateCols, ...Object.keys(updateCols))} where id = ${id}`;
        return { orderBefore: order, orderAfter: { ...order, ...updateCols, items } };
      });
    } catch (err) {
      if (err instanceof OrderNotFoundError) return Response.json({ error: err.message }, { status: 404 });
      if (err instanceof OrderValidationError) return Response.json({ error: err.message }, { status: 400 });
      return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan.' }, { status: 400 });
    }

    try {
      await logHistory(db, {
        entity: 'orders', entityId: id, entityLabel: `Pesanan ${txResult.orderBefore.invoiceNo ?? id}`,
        action: 'update', actor: guard, before: txResult.orderBefore, after: txResult.orderAfter,
      });
    } catch (err) {
      console.error('Failed to write history for order edit', err);
    }
    after(() => revalidateStorefront('products'));
    return Response.json({ ok: true });
  }

  // Update status/paymentStatus saja (batalkan, tandai selesai, tandai lunas)
  const { status, paymentStatus, walletId } = body;
  let statusResult: { orderBefore: ReturnType<typeof rowToOrder>; stockTouched: boolean };

  try {
    statusResult = await sql.begin(async pgTx => {
      let stockTouched = false;
      const [orderRow] = await pgTx<OrderRow[]>`select * from orders where id = ${id} for update`;
      if (!orderRow) throw new OrderNotFoundError('Pesanan tidak ditemukan.');
      const order = rowToOrder(orderRow);
      if (status !== undefined && order.status === 'dibatalkan') {
        throw new OrderValidationError('Pesanan yang sudah dibatalkan tidak bisa diubah statusnya lagi.');
      }

      const updateCols: Record<string, unknown> = { updated_at: new Date() };
      if (status !== undefined) updateCols.status = status;
      if (paymentStatus !== undefined) updateCols.payment_status = paymentStatus;
      if (walletId !== undefined) updateCols.wallet_id = walletId;

      // Pesanan (online ATAU kasir "Buka PO") ditandai selesai → baru sekarang stoknya dipotong.
      if (status === 'selesai' && !order.stockCut) {
        const settings = await getSettings();
        const warehouseId = settings.posWarehouseId as string | undefined;
        const warehouseName = settings.posWarehouseName as string | undefined;

        const items = (order.items as OrderItemInput[]) ?? [];
        const resolved = await Promise.all(items.map(async item => {
          if (item.productId || !item.qty) return item;
          const rows = await pgTx<{ id: string }[]>`select id from products where name = ${item.name} limit 2`;
          if (rows.length !== 1) return item;
          return { ...item, productId: rows[0].id };
        }));

        const deltas = new Map<string, number>();
        for (const item of resolved) {
          if (!item.productId || !item.qty) continue;
          deltas.set(item.productId, (deltas.get(item.productId) ?? 0) - item.qty);
        }

        if (deltas.size > 0) {
          const { products, shortages } = await readProductsForDeltasPg(pgTx, deltas);
          if (shortages.length > 0) throw new OrderValidationError(`Stok tidak cukup: ${shortages.join(', ')}`);
          for (const [productId, delta] of deltas) {
            const product = products.get(productId)!;
            await applyStockDeltaPg(pgTx, { productId, product, warehouseId, delta });
            await writeStockLedgerEntryPg(pgTx, {
              productId, productName: product.name, warehouseId, warehouseName, type: 'out', qty: delta,
              note: `Penjualan Online - ${order.invoiceNo ?? ''}`,
            });
            // Produk "Titip Masuk" (konsinyasi masuk) baru benar-benar terjual sekarang (stok baru
            // dipotong di sini untuk pesanan PO) — payout ke partner sudah disnapshot per item
            // sebagai costPrice saat order ini dibuat (lihat orders/route.ts), tinggal dipakai lagi.
            if (product.ownerType === 'consigned_in' && product.consignorId) {
              const qty = -delta;
              const item = resolved.find(it => it.productId === productId);
              const payoutAmount = Math.round((Number(item?.costPrice) || 0) * qty);
              await writeConsignmentInLedgerEntryPg(pgTx, {
                orderId: id, productId, productName: product.name,
                consignorId: product.consignorId, consignorName: product.consignorName ?? '',
                qty, payoutAmount,
              });
            }
          }
          stockTouched = true;
        }

        updateCols.stock_cut = true;
        if (warehouseId) { updateCols.warehouse_id = warehouseId; updateCols.warehouse_name = warehouseName ?? ''; }
      }

      // Batalkan pesanan → kembalikan stok yang sudah dipotong (sekali saja per pesanan)
      if (status === 'dibatalkan') {
        await restoreOrderStockInTxPg(pgTx, id, toRestorable(order));
        updateCols.stock_restored = true;
        stockTouched = true;
      }

      await pgTx`update orders set ${pgTx(updateCols, ...Object.keys(updateCols))} where id = ${id}`;
      return { orderBefore: order, stockTouched };
    });
  } catch (err) {
    if (err instanceof OrderNotFoundError) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof OrderValidationError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal memperbarui pesanan.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'orders', entityId: id, entityLabel: `Pesanan ${statusResult.orderBefore.invoiceNo ?? id}`,
      action: 'update', actor: guard, before: statusResult.orderBefore, after: { status, paymentStatus, walletId },
    });
  } catch (err) {
    console.error('Failed to write history for order status update', err);
  }

  if (statusResult.stockTouched) after(() => revalidateStorefront('products'));
  // "Terjual" di beranda storefront dihitung dari qty pesanan berstatus 'selesai' — status
  // apapun yang berubah di sini bisa menggeser hitungan itu (jadi/lepas dari 'selesai').
  if (status !== undefined) after(() => revalidateStorefront('stats'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'orders', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  let orderBefore: ReturnType<typeof rowToOrder> | null;
  try {
    orderBefore = await sql.begin(async pgTx => {
      const [orderRow] = await pgTx<OrderRow[]>`select * from orders where id = ${id} for update`;
      if (!orderRow) return null; // sudah tidak ada — hapus dianggap sukses (idempotent)
      const order = rowToOrder(orderRow);
      await restoreOrderStockInTxPg(pgTx, id, toRestorable(order));
      await pgTx`delete from orders where id = ${id}`;
      return order;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus pesanan.' }, { status: 400 });
  }

  if (orderBefore) {
    try {
      await logHistory(db, {
        entity: 'orders', entityId: id, entityLabel: `Pesanan ${orderBefore.invoiceNo ?? id}`,
        action: 'delete', actor: guard, before: orderBefore,
      });
    } catch (err) {
      console.error('Failed to write history for order delete', err);
    }
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
