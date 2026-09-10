'use client';

import { useState } from 'react';
import { Bell, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useNotifications } from '@/components/NotificationsProvider';
import { useViewMode } from '@/lib/useViewMode';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { TYPE_LABEL, fullTime } from '@/components/NotificationDetailModal';
import { TYPE_ICON, timeAgo, type NotificationDoc } from '@/components/NotificationBell';

const HEADER_BTN_H = 34;

// Riwayat lengkap notifikasi — beda dengan dropdown lonceng (NotificationBell) yang cuma
// menampilkan 50 terakhir tanpa pagination. Tab ini dipaginasi di client, pola yang sama
// dengan tab-tab lain (Materials, Consignment, dst). Data dari listener yang sama dengan
// NotificationBell (lihat NotificationsProvider) — bukan onSnapshot terpisah.
interface NotificationsTabProps {
  creds: string;
  username: string;
  onOpenNotification: (n: NotificationDoc) => void;
}

export default function NotificationsTab({ creds, username, onOpenNotification }: NotificationsTabProps) {
  const { notifications, loading } = useNotifications();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useViewMode('notifications');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const unread = notifications.filter(n => !n.readBy?.includes(username));

  const markRead = (id: string) => {
    fetch(`/api/notifications/${id}/read`, { method: 'PATCH', headers: { 'x-admin-auth': creds } }).catch(() => {});
  };

  const markAllRead = () => {
    fetch('/api/notifications/read-all', { method: 'PATCH', headers: { 'x-admin-auth': creds } }).catch(() => {});
  };

  const filtered = notifications.filter(n =>
    !search || n.title.toLowerCase().includes(search.toLowerCase()) || n.message.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  const handleClick = (n: NotificationDoc) => {
    if (!n.readBy?.includes(username)) markRead(n.id);
    setExpandedId(cur => (cur === n.id ? null : n.id));
  };

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        {unread.length > 0 && (
          <button onClick={markAllRead} className="btn-ghost h-9 px-3 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
            Tandai semua dibaca
          </button>
        )}
      </TopbarPortal>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 animate-fade-up space-y-4">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Notifikasi</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {unread.length > 0 ? `${unread.length} belum dibaca` : 'Semua sudah dibaca'}
            </p>
          </div>

          {/* Header: search + view toggle */}
          <div className="flex flex-row items-center gap-2 sm:gap-3">
            {notifications.length > 0 && (
              <div className="relative flex-1 min-w-0">
                <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); resetPage(); }}
                  className="input text-sm w-full"
                  style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                  placeholder="Cari judul atau pesan notifikasi…"
                />
              </div>
            )}
            {notifications.length > 0 && (
              <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
                <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
              </div>
            )}
          </div>

          {loading ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Memuat notifikasi…</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
              <div className="text-5xl mb-4">🔔</div>
              <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada notifikasi</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Notifikasi akan muncul di sini setiap kali ada aktivitas baru.</p>
            </div>
          ) : paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada notifikasi yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((n, idx) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isRead = n.readBy?.includes(username);
                const rowNum = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
                const expanded = expandedId === n.id;
                return (
                  <div key={n.id}>
                    <div
                      className="flex items-start gap-3 px-4 py-3"
                      style={{ background: isRead ? 'transparent' : 'var(--accent-bg)' }}
                    >
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-2" style={{ color: 'var(--text-muted)' }}>
                        {rowNum}
                      </span>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                        <Icon size={16} />
                      </div>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                        <span className="block text-xs leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.message}</span>
                        <span className="block text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</span>
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0 pt-1">
                        {!isRead && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />}
                        <Tooltip label={expanded ? 'Tutup detail' : 'Lihat detail'}>
                          <button onClick={() => handleClick(n)} className="btn-ghost p-2">
                            <ChevronRight size={13} style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                    {expanded && <NotificationRowDetail n={n} onOpen={onOpenNotification} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(n => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isRead = n.readBy?.includes(username);
                const expanded = expandedId === n.id;
                return (
                  <div key={n.id} className="card overflow-hidden" style={{ background: isRead ? undefined : 'var(--accent-bg)' }}>
                    <div className="p-4 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                          <Icon size={16} />
                        </div>
                        <span className="text-sm font-bold truncate flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                        {!isRead && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />}
                      </div>
                      <p className="text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>{n.message}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</p>
                    </div>
                    <div className="flex items-center justify-end px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <button onClick={() => handleClick(n)}
                        className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                        Detail <ChevronRight size={12} style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                      </button>
                    </div>
                    {expanded && <NotificationRowDetail n={n} onOpen={onOpenNotification} />}
                  </div>
                );
              })}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} notifikasi · halaman {safePage} dari {totalPages}
                </p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); resetPage(); }} />
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Tooltip label="Halaman sebelumnya">
                    <button onClick={() => goPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronLeft size={14} />
                    </button>
                  </Tooltip>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                    .reduce<(number | '…')[]>((acc, n, i, arr) => {
                      if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(n); return acc;
                    }, [])
                    .map((n, i) =>
                      n === '…'
                        ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                        : <button key={n} onClick={() => goPage(n as number)}
                            className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                            style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                            {n}
                          </button>
                    )
                  }
                  <Tooltip label="Halaman berikutnya">
                    <button onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronRight size={14} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationRowDetail({ n, onOpen }: { n: NotificationDoc; onOpen: (n: NotificationDoc) => void }) {
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{n.message}</p>
      <div className="grid grid-cols-2 gap-y-1 gap-x-3">
        <p className="text-[11px] min-w-0" style={{ color: 'var(--text-muted)' }}>Dibuat oleh</p>
        <p className="text-[11px] font-semibold text-right min-w-0 break-words" style={{ color: 'var(--text-primary)' }}>{n.actorUsername} ({n.actorRole})</p>
        <p className="text-[11px] min-w-0" style={{ color: 'var(--text-muted)' }}>Waktu</p>
        <p className="text-[11px] font-semibold text-right min-w-0 break-words" style={{ color: 'var(--text-primary)' }}>{fullTime(n)}</p>
      </div>
      {n.link && (
        <button onClick={() => onOpen(n)} className="btn-primary text-xs h-8 px-3">
          Lihat {TYPE_LABEL[n.type] ?? ''}
        </button>
      )}
    </div>
  );
}
