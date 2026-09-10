import { FieldValue, Firestore, Transaction } from 'firebase-admin/firestore';
import type { AuthUser } from '@/lib/admin-auth';
import { getFirebaseMessaging } from '@/lib/firebase-admin';

// Notifikasi in-app broadcast ke semua admin, dibaca realtime lewat Firestore client SDK
// (lihat src/lib/firebase-client.ts) — mengikuti konvensi src/lib/history.ts: writeNotification
// dipanggil di dalam transaksi milik caller tepat setelah mutasi bisnisnya, notify dipakai di
// route yang tidak membuka transaksi sendiri.

export type NotificationType =
  | 'order_new' | 'payment_proof' | 'stock_low' | 'pos_shift_open' | 'consignment_overdue' | 'consignment_recap' | 'consignment_send'
  | 'consignment_in_receive' | 'consignment_in_settle'
  | 'income_new' | 'expense_new' | 'capital_new' | 'system';

interface NotificationOpts {
  type: NotificationType;
  title: string;
  message: string;
  /** TabId admin (mis. 'orders', 'materials') — app ini SPA berbasis activeTab, bukan URL route. */
  link?: string;
  entityCollection?: string;
  entityId?: string;
  actor: AuthUser;
}

interface PushPayload { title: string; message: string }

function buildNotificationDoc(opts: NotificationOpts) {
  return {
    type: opts.type,
    title: opts.title,
    message: opts.message,
    link: opts.link ?? null,
    entityCollection: opts.entityCollection ?? null,
    entityId: opts.entityId ?? null,
    actorUsername: opts.actor.username,
    actorRole: opts.actor.role,
    readBy: [] as string[],
    createdAt: FieldValue.serverTimestamp(),
  };
}

// Return payload-nya (bukan void) supaya caller yang jalan di dalam db.runTransaction bisa
// kirim push SETELAH transaksi commit — jangan kirim push di dalam body transaksi, karena
// transaksi bisa retry kalau ada write conflict dan itu akan mengirim push dobel.
export function writeNotification(tx: Transaction, db: Firestore, opts: NotificationOpts): PushPayload {
  tx.set(db.collection('notifications').doc(), buildNotificationDoc(opts));
  return { title: opts.title, message: opts.message };
}

export async function notify(db: Firestore, opts: NotificationOpts): Promise<void> {
  await db.collection('notifications').add(buildNotificationDoc(opts));
  await sendPush(db, { title: opts.title, message: opts.message }).catch(err => {
    console.error('Failed to send push notification', err);
  });
}

// Fan-out ke semua device yang sudah "Aktifkan notifikasi HP" (koleksi `fcmTokens`, lihat
// /api/notifications/register-device). Token yang sudah tidak valid (uninstall/permission dicabut)
// dibersihkan otomatis dari error response — tidak butuh cron terpisah untuk itu.
//
// `usernames`, kalau diisi, membatasi pengiriman ke device milik user-user tsb saja (dipakai
// chat, yang harus japri — bukan broadcast ke semua admin seperti notifikasi order/stok).
// `data` diteruskan ke payload FCM data (string map) supaya sw.js bisa deep-link saat diklik.
export async function sendPush(db: Firestore, payload: PushPayload, opts?: { usernames?: string[]; data?: Record<string, string> }): Promise<void> {
  const snap = await db.collection('fcmTokens').get();
  if (snap.empty) return;
  const docs = opts?.usernames
    ? snap.docs.filter(d => opts.usernames!.includes((d.data() as { username?: string }).username ?? ''))
    : snap.docs;
  if (docs.length === 0) return;
  const tokens = docs.map(d => d.id);

  const res = await getFirebaseMessaging().sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.message },
    webpush: { notification: { icon: '/icon-192.png' } },
    data: opts?.data,
  });

  const stale: string[] = [];
  res.responses.forEach((r, i) => {
    if (!r.success && (r.error?.code === 'messaging/registration-token-not-registered' || r.error?.code === 'messaging/invalid-argument')) {
      stale.push(tokens[i]);
    }
  });
  await Promise.all(stale.map(t => db.collection('fcmTokens').doc(t).delete()));
}
