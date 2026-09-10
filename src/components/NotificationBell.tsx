'use client';

import { useEffect, useRef, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';
import { Bell, ShoppingCart, PackageX, Wallet, ReceiptText, Receipt, Truck, ClipboardList, TrendingUp, TrendingDown, Landmark, Activity, PackagePlus, HandCoins } from 'lucide-react';
import { getClientMessaging, isFirebaseClientConfigured } from '@/lib/firebase-client';
import { usePwaInstall } from '@/lib/usePwaInstall';
import { useNotifications } from '@/components/NotificationsProvider';
import NotificationDetailModal from '@/components/NotificationDetailModal';

export interface NotificationDoc {
  id: string;
  type: 'order_new' | 'payment_proof' | 'stock_low' | 'pos_shift_open' | 'consignment_overdue' | 'consignment_recap' | 'consignment_send'
    | 'consignment_in_receive' | 'consignment_in_settle'
    | 'income_new' | 'expense_new' | 'capital_new' | 'system';
  title: string;
  message: string;
  link: string | null;
  entityCollection: string | null;
  entityId: string | null;
  actorUsername: string;
  actorRole: string;
  readBy: string[];
  createdAt: Timestamp | null;
}

export const TYPE_ICON: Record<NotificationDoc['type'], typeof Bell> = {
  order_new: ShoppingCart,
  payment_proof: Receipt,
  stock_low: PackageX,
  pos_shift_open: Wallet,
  consignment_overdue: ReceiptText,
  consignment_recap: ClipboardList,
  consignment_send: Truck,
  consignment_in_receive: PackagePlus,
  consignment_in_settle: HandCoins,
  income_new: TrendingUp,
  expense_new: TrendingDown,
  capital_new: Landmark,
  system: Activity,
};

export function timeAgo(ts: Timestamp | null): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts.toMillis();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Baru saja';
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  return `${Math.floor(hr / 24)} hari lalu`;
}

interface NotificationBellProps {
  creds: string;
  username: string;
  onOpen: (n: NotificationDoc) => void;
  onViewAll: () => void;
}

type PushStatus = 'idle' | 'enabling' | 'granted' | 'denied';

export default function NotificationBell({ creds, username, onOpen, onViewAll }: NotificationBellProps) {
  const { notifications } = useNotifications();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<NotificationDoc | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus>(() =>
    typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted' : 'idle'
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const { isIOS, installed } = usePwaInstall();

  const enablePush = async () => {
    setPushStatus('enabling');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setPushStatus('denied'); return; }

      const messaging = await getClientMessaging();
      if (!messaging) { setPushStatus('denied'); return; }

      const registration = await navigator.serviceWorker.ready;
      const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (!token) { setPushStatus('denied'); return; }

      await fetch('/api/notifications/register-device', {
        method: 'POST',
        headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setPushStatus('granted');
    } catch (err) {
      console.error('Gagal aktifkan notifikasi HP', err);
      setPushStatus('denied');
    }
  };

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const unread = notifications.filter(n => !n.readBy?.includes(username));
  // Dropdown only ever showed the latest 50 — the shared listener now carries more
  // (see NotificationsProvider), so trim for display here rather than render all of it.
  const visible = notifications.slice(0, 50);

  const markRead = (id: string) => {
    fetch(`/api/notifications/${id}/read`, { method: 'PATCH', headers: { 'x-admin-auth': creds } }).catch(() => {});
  };

  const markAllRead = () => {
    fetch('/api/notifications/read-all', { method: 'PATCH', headers: { 'x-admin-auth': creds } }).catch(() => {});
  };

  const handleClick = (n: NotificationDoc) => {
    if (!n.readBy?.includes(username)) markRead(n.id);
    setOpen(false);
    setDetail(n);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifikasi"
        className="relative flex items-center justify-center h-9 w-9 rounded-lg transition-colors"
        style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
      >
        <Bell size={16} />
        {unread.length > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[9px] font-black text-white"
            style={{ minWidth: 16, height: 16, padding: '0 3px', background: 'var(--danger)' }}
          >
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 rounded-xl shadow-lg overflow-hidden z-50"
          style={{ width: 340, maxWidth: '90vw', background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Notifikasi</span>
            {unread.length > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                Tandai semua dibaca
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto thin-scrollbar">
            {visible.length === 0 && (
              <p className="px-3.5 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                Belum ada notifikasi.
              </p>
            )}
            {visible.map(n => {
              const Icon = TYPE_ICON[n.type] ?? Bell;
              const isRead = n.readBy?.includes(username);
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="w-full flex items-start gap-2.5 px-3.5 py-3 text-left transition-colors"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: isRead ? 'transparent' : 'var(--accent-bg)',
                  }}
                >
                  <Icon size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                    <span className="block text-xs leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.message}</span>
                    <span className="block text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</span>
                  </span>
                  {!isRead && <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: 'var(--accent)' }} />}
                </button>
              );
            })}
          </div>
          {isFirebaseClientConfigured && (
            <div className="px-3.5 py-2.5 text-center" style={{ borderTop: '1px solid var(--border)' }}>
              {isIOS && !installed ? (
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Install ke Home Screen dulu untuk notifikasi HP
                </span>
              ) : pushStatus === 'granted' ? (
                <span className="text-[11px] font-semibold" style={{ color: 'var(--success)' }}>
                  Notifikasi HP aktif
                </span>
              ) : (
                <button
                  onClick={enablePush}
                  disabled={pushStatus === 'enabling'}
                  className="text-[11px] font-semibold disabled:opacity-60"
                  style={{ color: 'var(--accent)' }}
                >
                  {pushStatus === 'enabling' ? 'Mengaktifkan…' : pushStatus === 'denied' ? 'Izin ditolak — coba lagi' : 'Aktifkan notifikasi HP'}
                </button>
              )}
            </div>
          )}
          <div className="px-3.5 py-2.5 text-center" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => { setOpen(false); onViewAll(); }}
              className="text-[11px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              Lihat semua notifikasi
            </button>
          </div>
        </div>
      )}

      <NotificationDetailModal
        notification={detail}
        onClose={() => setDetail(null)}
        onOpen={n => { onOpen(n); setDetail(null); }}
      />
    </div>
  );
}
