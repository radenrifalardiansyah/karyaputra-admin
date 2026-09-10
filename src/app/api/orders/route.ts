import { NextRequest, after } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { computeConsignmentPayout, writeConsignmentInLedgerEntryPg } from '@/lib/consignment-in';
import { revalidateStorefront } from '@/lib/revalidate';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { rowToOrder, resolveUniqueInvoiceNo, OrderRow } from '@/lib/orders-pg';

// `orders` dibaca dengan from=2000-01-01 (seluruh riwayat) oleh useWalletBalances di 7 tab
// berbeda (Kasir, Pesanan, Pemasukan, Pengeluaran, Modal, Bahan Baku, Mitra) SETIAP kali ada
// transaksi baru dimanapun, dan ditulis dari banyak endpoint (checkout kasir, edit/hapus/ubah
// status pesanan, impor massal, checkout storefront). Tidak di-cache sama sekali — tag cache
// gampang kelewat dipasang di salah satu titik tulis itu dan diam-diam jadi stale permanen,
// sedangkan cache TTL murni tetap punya jeda basi. Baca langsung dari database supaya selalu up
// to date. (Tahap 12 migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md.)
async function fetchOrders(from: string | null, to: string | null, limit: number) {
  const sql = getSql();
  let rows: OrderRow[];
  if (from && to) {
    rows = await sql<OrderRow[]>`select * from orders where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
  } else if (from) {
    rows = await sql<OrderRow[]>`select * from orders where created_at >= ${wibDayStart(from).toDate()} order by created_at desc`;
  } else if (to) {
    rows = await sql<OrderRow[]>`select * from orders where created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
  } else {
    rows = await sql<OrderRow[]>`select * from orders order by created_at desc limit ${limit}`;
  }
  return rows.map(rowToOrder);
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'orders', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');
  const limit = parseInt(searchParams.get('limit') ?? '50');

  const orders = await fetchOrders(from, to, limit);
  return Response.json({ orders });
}

interface OrderItemInput { productId?: string; qty: number; [key: string]: unknown }
interface OrderCreateBody {
  date?: string; customerName?: string; customerPhone?: string; customerId?: string;
  subtotal?: number; discount?: { amount: number; label: string } | null; total?: number;
  deliveryMethod?: 'pickup' | 'delivery'; address?: string; note?: string;
  paymentMethod?: string; paymentStatus?: string; amountPaid?: number; changeAmount?: number;
  transferBank?: string; transferAmount?: number; transferProofUrl?: string;
  warehouseId?: string; warehouseName?: string; walletId?: string | null; shiftId?: string;
  invoiceNo?: string; transactionAt?: string; items?: OrderItemInput[]; isPreOrder?: boolean;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'orders', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as OrderCreateBody;
  const db = getDb();
  // Kasir bisa mengedit tanggal & jam transaksi (mis. transaksi baru sempat diinput belakangan) —
  // kalau dikirim, itu yang jadi created_at (dipakai buat urutan & filter periode di Pesanan/
  // Laporan Keuangan). Kalau tidak dikirim, pakai waktu server seperti biasa.
  const createdAt = data.transactionAt ? new Date(data.transactionAt) : new Date();

  const deltas = new Map<string, number>();
  for (const item of data.items ?? []) {
    if (!item.productId || !item.qty) continue;
    deltas.set(item.productId, (deltas.get(item.productId) ?? 0) - item.qty);
  }

  const sql = getSql();
  let isPreOrder = false;
  let itemsWithCost: OrderItemInput[] = [];
  let finalInvoiceNo: string | undefined;
  let orderId = '';

  // Stok DAN dokumen order sekarang sama-sama di Postgres (Tahap 9-12 Fase 2 — lihat plan
  // gleaming-wondering-quokka.md), jadi bisa digabung jadi SATU transaksi atomic — tidak ada lagi
  // kompensasi cross-database seperti versi sebelumnya (order Firestore + stok Postgres terpisah).
  try {
    orderId = await sql.begin(async pgTx => {
      const { products, shortageDetails } = await readProductsForDeltasPg(pgTx, deltas);
      // "Jual sebagai PO" adalah pilihan manual kasir (lihat checkbox di PosTab.tsx), lepas dari
      // stok saat ini — sengaja TIDAK otomatis dipicu oleh stok habis, supaya kasir yang menentukan
      // kapan suatu transaksi perlu jadi PO. Kalau dicentang, pesanan disimpan sebagai 'baru' tanpa
      // memotong stok sekarang (persis pesanan Website), baru dipotong begitu admin menandai
      // Selesai di menu Pesanan (lihat PUT /api/orders/[id]). Cek `hasOpenPOItem` di sini cuma
      // jaga-jaga kalau body dikirim manual (bukan lewat UI) tanpa produk "Buka PO" sama sekali.
      const hasOpenPOItem = [...deltas.keys()].some(pid => !!products.get(pid)?.openPO);
      isPreOrder = data.isPreOrder === true && hasOpenPOItem;
      if (!isPreOrder && shortageDetails.length > 0) throw new Error(`Stok tidak cukup: ${shortageDetails.map(s => s.message).join(', ')}`);

      // Snapshot HPP (costPrice) tiap item saat transaksi terjadi — costPrice produk adalah
      // rata-rata bergerak yang berubah tiap ada produksi baru, jadi HPP historis tidak bisa
      // direkonstruksi ulang secara akurat kalau tidak disimpan di sini (dipakai Laporan Keuangan).
      // Untuk produk "Titip Masuk" (konsinyasi masuk — lihat consignment-in.ts), costPrice diisi
      // dengan payout ke partner (bukan cost_price produk) supaya Laporan Keuangan/Produk yang
      // sudah membaca item.costPrice sebagai HPP otomatis dapat margin yang benar tanpa diubah.
      itemsWithCost = (data.items ?? []).map(item => {
        const product = item.productId ? products.get(item.productId) : undefined;
        if (product?.ownerType === 'consigned_in') {
          const qty = Number(item.qty) || 0;
          const unitPrice = Number(item.price) || 0;
          return { ...item, costPrice: qty > 0 ? computeConsignmentPayout(product, qty, unitPrice) / qty : 0 };
        }
        return { ...item, costPrice: product?.costPrice ?? 0 };
      });

      if (!isPreOrder) {
        for (const [productId, delta] of deltas) {
          const product = products.get(productId)!;
          await applyStockDeltaPg(pgTx, { productId, product, warehouseId: data.warehouseId, delta });
          await writeStockLedgerEntryPg(pgTx, {
            productId, productName: product.name, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
            type: 'out', qty: delta,
            note: `Penjualan Kasir - ${data.invoiceNo ?? ''}`,
          });
        }
      }

      finalInvoiceNo = await resolveUniqueInvoiceNo(pgTx, data.invoiceNo);
      const id = randomUUID();

      // Insert baris order DULU — consignment_in_ledger.order_id punya FK ke orders.id (constraint
      // di-cek langsung tiap statement, bukan di commit), jadi ledger konsinyasi-masuk harus
      // ditulis SETELAH baris order ini ada, bukan sebelumnya.
      await pgTx`
        insert into orders (
          id, invoice_no, date, customer_name, customer_phone, customer_id, items, subtotal, discount, total,
          status, source, delivery_method, address, note, payment_method, payment_status,
          amount_paid, change_amount, transfer_bank, transfer_amount, transfer_proof_url,
          stock_cut, warehouse_id, warehouse_name, wallet_id, shift_id, created_at
        ) values (
          ${id}, ${finalInvoiceNo ?? null}, ${data.date ?? null},
          ${data.customerName ?? ''}, ${data.customerPhone ?? null}, ${data.customerId ?? null},
          ${JSON.stringify(itemsWithCost)}, ${Number(data.subtotal) || 0}, ${data.discount ? JSON.stringify(data.discount) : null}, ${Number(data.total) || 0},
          ${isPreOrder ? 'baru' : 'selesai'}, 'kasir',
          ${data.deliveryMethod ?? null}, ${data.address ?? null}, ${data.note ?? null},
          ${data.paymentMethod ?? null}, ${data.paymentStatus ?? 'belum_lunas'},
          ${data.amountPaid ?? null}, ${data.changeAmount ?? null},
          ${data.transferBank ?? null}, ${data.transferAmount ?? null}, ${data.transferProofUrl ?? null},
          ${!isPreOrder}, ${data.warehouseId ?? null}, ${data.warehouseName ?? null},
          ${data.walletId ?? null}, ${data.shiftId ?? null}, ${createdAt}
        )
      `;

      if (!isPreOrder) {
        for (const [productId, delta] of deltas) {
          const product = products.get(productId)!;
          if (product.ownerType !== 'consigned_in' || !product.consignorId) continue;
          const qty = -delta; // delta stok negatif = qty yang terjual
          const item = (data.items ?? []).find(it => it.productId === productId);
          const unitPrice = Number(item?.price) || 0;
          const payoutAmount = computeConsignmentPayout(product, qty, unitPrice);
          await writeConsignmentInLedgerEntryPg(pgTx, {
            orderId: id, productId, productName: product.name,
            consignorId: product.consignorId, consignorName: product.consignorName ?? '',
            qty, payoutAmount,
          });
        }
      }

      return id;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan transaksi.' }, { status: 400 });
  }

  // History/notifikasi tetap Firestore (di luar cakupan Tahap 12) — best-effort setelah transaksi
  // Postgres commit, sama pola dengan logHistory di wallet-transfers/route.ts.
  try {
    await logHistory(db, {
      entity: 'orders', entityId: orderId, entityLabel: `Pesanan ${finalInvoiceNo ?? orderId}`,
      action: 'create', actor: guard, after: { ...data, invoiceNo: finalInvoiceNo, items: itemsWithCost },
    });
  } catch (err) {
    console.error('Failed to write history for order create', err);
  }
  try {
    await notify(db, {
      type: 'order_new',
      title: 'Pesanan baru',
      message: `Pesanan ${finalInvoiceNo ?? orderId} senilai Rp${(Number(data.total) || 0).toLocaleString('id-ID')} — oleh ${guard.username}.`,
      link: 'orders',
      entityCollection: 'orders', entityId: orderId,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to send notification for new order', err);
  }

  if (!isPreOrder && deltas.size > 0) after(() => revalidateStorefront('products'));

  return Response.json({ id: orderId });
}
