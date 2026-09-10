'use client';

import { X } from 'lucide-react';
import { TYPE_ICON, type NotificationDoc } from '@/components/NotificationBell';

export const TYPE_LABEL: Record<NotificationDoc['type'], string> = {
  order_new: 'Pesanan',
  payment_proof: 'Bukti Pembayaran',
  stock_low: 'Bahan Baku',
  pos_shift_open: 'Shift Kasir',
  consignment_overdue: 'Rekap Konsinyasi',
  consignment_recap: 'Rekap Konsinyasi',
  consignment_send: 'Pengiriman Konsinyasi',
  consignment_in_receive: 'Terima Titipan',
  consignment_in_settle: 'Pembayaran Titipan',
  income_new: 'Pemasukan',
  expense_new: 'Pengeluaran',
  capital_new: 'Modal & Prive',
  system: 'Sistem',
};

export function fullTime(n: NotificationDoc): string {
  if (!n.createdAt) return '';
  return n.createdAt.toDate().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

interface Props {
  notification: NotificationDoc | null;
  onClose: () => void;
  onOpen: (n: NotificationDoc) => void;
}

export default function NotificationDetailModal({ notification, onClose, onOpen }: Props) {
  if (!notification) return null;
  const Icon = TYPE_ICON[notification.type] ?? TYPE_ICON.order_new;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />

        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Icon size={17} /></div>
            <div>
              <p className="modal-title">{notification.title}</p>
              <p className="modal-subtitle">{TYPE_LABEL[notification.type] ?? 'Notifikasi'}</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              {notification.message}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 14, background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Dibuat oleh</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {notification.actorUsername} ({notification.actorRole})
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Waktu</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>{fullTime(notification)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost">Tutup</button>
          {notification.link && (
            <button onClick={() => onOpen(notification)} className="btn-primary">
              Lihat {TYPE_LABEL[notification.type] ?? ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
