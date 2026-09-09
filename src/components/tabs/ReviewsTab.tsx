'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Trash2, Star, Check, X, RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';

interface StorefrontReview {
  id: string;
  customerId?: string;
  customerName?: string;
  rating?: number;
  comment?: string;
  approved?: boolean;
  createdAt?: { seconds: number };
}

type StatusFilter = 'all' | 'pending' | 'approved';

function formatDate(r: StorefrontReview) {
  if (r.createdAt?.seconds)
    return new Date(r.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return '-';
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={13} style={{ color: 'var(--warning, #F59E0B)' }} fill={i <= rating ? 'currentColor' : 'none'} />
      ))}
    </div>
  );
}

function Checkbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(); }}
      className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors"
      style={{
        background:  checked || indeterminate ? 'var(--accent)' : 'transparent',
        borderColor: checked || indeterminate ? 'var(--accent)' : 'var(--border)',
      }}
    >
      {indeterminate && !checked
        ? <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />
        : checked
          ? <Check size={11} color="#fff" strokeWidth={3} />
          : null}
    </button>
  );
}

// Ulasan bintang dari akun storefront (halaman /pesanan) — hanya customer dengan
// pesanan "selesai" yang bisa mengirim. Baru dihitung ke rating publik di beranda
// storefront setelah di-approve di sini (lihat storefront's /api/stats/public).
export default function ReviewsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [reviews, setReviews] = useState<StorefrontReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [view, setView] = useViewMode('reviews');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/reviews', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then(d => setReviews(d.reviews ?? []))
      .catch(() => toast.error('Gagal memuat ulasan.'))
      .finally(() => setLoading(false));
  }, [creds, toast]);

  useEffect(() => { load(); }, [load]);

  const setApproved = async (r: StorefrontReview, approved: boolean) => {
    try {
      const res = await fetch(`/api/reviews/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({ approved }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal memperbarui ulasan.'); return; }
      toast.success(approved ? 'Ulasan disetujui & tayang di beranda.' : 'Ulasan disembunyikan dari beranda.');
      load();
    } catch {
      toast.error('Gagal memperbarui ulasan.');
    }
  };

  const handleDelete = async (r: StorefrontReview) => {
    if (!await confirm({ message: `Hapus ulasan dari "${r.customerName}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    try {
      const res = await fetch(`/api/reviews/${r.id}`, { method: 'DELETE', headers: { 'x-admin-auth': creds } });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal menghapus ulasan.'); return; }
      toast.success('Ulasan berhasil dihapus.');
      load();
    } catch {
      toast.error('Gagal menghapus ulasan.');
    }
  };

  const filtered = reviews
    .filter(r => status === 'all' || (status === 'approved' ? r.approved : !r.approved))
    .filter(r =>
      !search || r.customerName?.toLowerCase().includes(search.toLowerCase()) || r.comment?.toLowerCase().includes(search.toLowerCase())
    );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const resetPage = () => setPage(1);
  const pendingCount = reviews.filter(r => !r.approved).length;

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const togglePageAll = () => {
    const pageIds     = paginated.map(r => r.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} ulasan yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const count = selected.size;
    const results = await Promise.all([...selected].map(id =>
      fetch(`/api/reviews/${id}`, { method: 'DELETE', headers: { 'x-admin-auth': creds } })
    ));
    const failed = results.filter(r => !r.ok).length;
    setSelected(new Set());
    setBulkDeleting(false);
    load();
    if (failed === 0) toast.success(`${count} ulasan berhasil dihapus.`);
    else toast.error(`${count - failed} ulasan terhapus, ${failed} gagal.`);
  };

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Muat ulang">
          <button onClick={load} className="btn-ghost p-2"><RefreshCw size={15} /></button>
        </Tooltip>
      </TopbarPortal>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 animate-fade-up space-y-4">
          <div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {pendingCount > 0 ? `${pendingCount} ulasan menunggu persetujuan` : 'Semua ulasan sudah ditinjau'}
            </p>
          </div>

          {reviews.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <div className="relative flex-1 min-w-0">
                <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); resetPage(); }}
                  className="input text-sm w-full"
                  style={{ paddingLeft: 38, height: 34 }}
                  placeholder="Cari nama atau isi ulasan…"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {(['all', 'pending', 'approved'] as StatusFilter[]).map(s => (
                  <button
                    key={s}
                    onClick={() => { setStatus(s); resetPage(); }}
                    className="h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors"
                    style={status === s ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}
                  >
                    {s === 'all' ? 'Semua' : s === 'pending' ? 'Menunggu' : 'Disetujui'}
                  </button>
                ))}
              </div>
              <ViewToggle mode={view} onChange={setView} height={34} />
            </div>
          )}

          {loading ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Memuat ulasan…</p>
            </div>
          ) : reviews.length === 0 ? (
            <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
                <Star size={28} style={{ color: 'var(--accent)' }} />
              </div>
              <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada ulasan masuk</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Ulasan dari pelanggan akan muncul di sini.</p>
            </div>
          ) : paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada ulasan yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                <Checkbox
                  checked={paginated.every(r => selected.has(r.id))}
                  indeterminate={paginated.some(r => selected.has(r.id)) && !paginated.every(r => selected.has(r.id))}
                  onChange={togglePageAll}
                />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} ulasan di halaman ini`}
                </span>
              </div>
              <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((r, idx) => {
                const isSelected = selected.has(r.id);
                const actionButtons = (
                  <>
                    {r.approved ? (
                      <button onClick={() => setApproved(r, false)} className="btn-ghost h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
                        <X size={13} /> Sembunyikan
                      </button>
                    ) : (
                      <button onClick={() => setApproved(r, true)} className="btn-primary h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
                        <Check size={13} /> Setujui
                      </button>
                    )}
                    <Tooltip label="Hapus ulasan">
                      <button onClick={() => handleDelete(r)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                        <Trash2 size={14} />
                      </button>
                    </Tooltip>
                  </>
                );
                return (
                  <div key={r.id} className="flex flex-col gap-2 px-4 py-3.5" style={{ background: isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                    <div className="flex items-start gap-3">
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(r.id)} />
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {(safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{r.customerName || '(tanpa nama)'}</p>
                          <Stars rating={r.rating ?? 0} />
                        </div>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatDate(r)}</span>
                        {r.comment && (
                          <p className="text-xs leading-relaxed mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>{r.comment}</p>
                        )}
                      </div>
                      <span
                        className="px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0"
                        style={r.approved
                          ? { background: 'var(--success-bg, #DCFCE7)', color: 'var(--success, #16A34A)' }
                          : { background: 'var(--warning-bg, #FEF3C7)', color: 'var(--warning, #D97706)' }}
                      >
                        {r.approved ? 'Disetujui' : 'Menunggu'}
                      </span>
                      <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                        {actionButtons}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-8 sm:hidden">
                      {actionButtons}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {paginated.map(r => (
                <div key={r.id} className="card p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{r.customerName || '(tanpa nama)'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Stars rating={r.rating ?? 0} />
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatDate(r)}</span>
                      </div>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0"
                      style={r.approved
                        ? { background: 'var(--success-bg, #DCFCE7)', color: 'var(--success, #16A34A)' }
                        : { background: 'var(--warning-bg, #FEF3C7)', color: 'var(--warning, #D97706)' }}
                    >
                      {r.approved ? 'Disetujui' : 'Menunggu'}
                    </span>
                  </div>
                  {r.comment && (
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{r.comment}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {r.approved ? (
                      <button onClick={() => setApproved(r, false)} className="btn-ghost h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
                        <X size={13} /> Sembunyikan
                      </button>
                    ) : (
                      <button onClick={() => setApproved(r, true)} className="btn-primary h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
                        <Check size={13} /> Setujui
                      </button>
                    )}
                    <Tooltip label="Hapus ulasan">
                      <button onClick={() => handleDelete(r)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                        <Trash2 size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} ulasan · halaman {safePage} dari {totalPages}
                </p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); resetPage(); }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={bulkDelete} disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setSelected(new Set())}
              className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
