'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Trash2, Smartphone, Globe, RefreshCw, Check, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useViewMode } from '@/lib/useViewMode';

interface StorefrontCustomer {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  authProvider?: 'google';
  createdAt?: { seconds: number };
}

function formatDate(c: StorefrontCustomer) {
  if (c.createdAt?.seconds)
    return new Date(c.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return '-';
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

// Akun yang customer buat sendiri di storefront untuk checkout — beda dengan tab
// "Pelanggan" (kontak CRM yang diinput admin secara manual). Read-only kecuali
// hapus akun (mis. spam/duplikat); admin tidak pernah membuat/mengedit akun ini.
export default function StorefrontCustomersTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<StorefrontCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useViewMode('storefront-customers');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/storefront-customers', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then(d => setCustomers(d.customers ?? []))
      .catch(() => toast.error('Gagal memuat akun storefront.'))
      .finally(() => setLoading(false));
  }, [creds, toast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (c: StorefrontCustomer) => {
    if (!await confirm({ message: `Hapus akun "${c.name || c.phone}"? Pemilik akun tidak akan bisa login lagi.`, danger: true })) return;
    try {
      const res = await fetch(`/api/storefront-customers/${c.id}`, { method: 'DELETE', headers: { 'x-admin-auth': creds } });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal menghapus akun.'); return; }
      toast.success('Akun berhasil dihapus.');
      load();
    } catch {
      toast.error('Gagal menghapus akun.');
    }
  };

  const filtered = customers.filter(c =>
    !search
    || c.name?.toLowerCase().includes(search.toLowerCase())
    || c.phone?.includes(search)
    || c.email?.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const resetPage = () => setPage(1);

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const togglePageAll = () => {
    const pageIds     = paginated.map(c => c.id);
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
    if (!await confirm({ message: `Hapus ${selected.size} akun yang dipilih? Pemilik akun tidak akan bisa login lagi.`, danger: true })) return;
    setBulkDeleting(true);
    const count = selected.size;
    const results = await Promise.all([...selected].map(id =>
      fetch(`/api/storefront-customers/${id}`, { method: 'DELETE', headers: { 'x-admin-auth': creds } })
    ));
    const failed = results.filter(r => !r.ok).length;
    setSelected(new Set());
    setBulkDeleting(false);
    load();
    if (failed === 0) toast.success(`${count} akun berhasil dihapus.`);
    else toast.error(`${count - failed} akun terhapus, ${failed} gagal.`);
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
              Akun yang customer buat sendiri di website untuk checkout — {customers.length} akun terdaftar.
            </p>
          </div>

          {customers.length > 0 && (
            <div className="flex flex-row items-center gap-2 sm:gap-3">
              <div className="relative flex-1 min-w-0">
                <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); resetPage(); }}
                  className="input text-sm w-full"
                  style={{ paddingLeft: 38, height: 34 }}
                  placeholder="Cari nama, nomor HP, atau email…"
                />
              </div>
              <ViewToggle mode={view} onChange={setView} height={34} />
            </div>
          )}

          {loading ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Memuat akun…</p>
            </div>
          ) : customers.length === 0 ? (
            <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
                <Globe size={28} style={{ color: 'var(--accent)' }} />
              </div>
              <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada akun terdaftar</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Akun yang dibuat customer sendiri di website untuk checkout akan muncul di sini.</p>
            </div>
          ) : paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada akun yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                <Checkbox
                  checked={paginated.every(c => selected.has(c.id))}
                  indeterminate={paginated.some(c => selected.has(c.id)) && !paginated.every(c => selected.has(c.id))}
                  onChange={togglePageAll}
                />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} akun di halaman ini`}
                </span>
              </div>
              <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                {paginated.map((c, idx) => {
                  const isSelected = selected.has(c.id);
                  const rowNum = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3" style={{ background: isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(c.id)} />
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                        {rowNum}
                      </span>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                        {c.authProvider === 'google' ? <Globe size={16} /> : <Smartphone size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.name || '(tanpa nama)'}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{c.phone}{c.email ? ` · ${c.email}` : ''}</p>
                      </div>
                      <span className="text-[11px] hidden sm:block flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {c.authProvider === 'google' ? 'Google' : 'HP + Password'} · {formatDate(c)}
                      </span>
                      <Tooltip label="Hapus akun">
                        <button onClick={() => handleDelete(c)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                          <Trash2 size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(c => (
                <div key={c.id} className="card p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                      {c.authProvider === 'google' ? <Globe size={16} /> : <Smartphone size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.name || '(tanpa nama)'}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{c.phone}{c.email ? ` · ${c.email}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {c.authProvider === 'google' ? 'Google' : 'HP + Password'} · {formatDate(c)}
                    </span>
                    <button onClick={() => handleDelete(c)} className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} akun · halaman {safePage} dari {totalPages}
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
