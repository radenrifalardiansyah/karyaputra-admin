'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, ChevronLeft, ChevronRight, Loader2, User as UserIcon } from 'lucide-react';
import FilterSelect from '@/components/FilterSelect';
import PageSizeSelect from '@/components/PageSizeSelect';
import Tooltip from '@/components/Tooltip';
import ViewToggle from '@/components/ViewToggle';
import { useViewMode } from '@/lib/useViewMode';
import { HISTORY_ENTITIES, historyEntityLabel } from '@/lib/history-entities';
import {
  type AuditEntry, ACTION_META, DIRECTION_COLOR, directionFor, avatarIconFor,
  formatDateTime, HistoryEntryDetail,
} from '@/lib/history-format';

const API = '';
const HEADER_BTN_H = 34;

type PeriodKey = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
const PERIOD_OPTIONS: { id: PeriodKey; label: string }[] = [
  { id: 'today', label: 'Hari Ini' },
  { id: '7d',    label: '7 Hari' },
  { id: '30d',   label: '30 Hari' },
  { id: 'month', label: 'Bulan Ini' },
  { id: 'year',  label: 'Tahun Ini' },
  { id: 'custom', label: 'Custom' },
];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodRange(period: PeriodKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = toISO(now);
  switch (period) {
    case 'today': return { from: today, to: today };
    case '7d': { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: toISO(d), to: today }; }
    case '30d': { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: toISO(d), to: today }; }
    case 'month': { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { from: toISO(d), to: today }; }
    case 'year': { const d = new Date(now.getFullYear(), 0, 1); return { from: toISO(d), to: today }; }
    case 'custom': return { from: customFrom || today, to: customTo || today };
  }
}

export default function HistoryTab({ creds }: { creds: string }) {
  const headers = { 'x-admin-auth': creds };

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('semua');
  const [actionFilter, setActionFilter] = useState('semua');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useViewMode('history');

  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const { from, to } = periodRange(period, customFrom, customTo);

  // Generasi request — cegah respons filter LAMA yang datang belakangan menimpa data filter BARU
  // yang sudah lebih dulu tampil (fetch bisa tumpang tindih kalau filter diganti cepat).
  const loadIdRef = useRef(0);
  const load = async () => {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    const qs = new URLSearchParams({ from, to });
    if (entityFilter !== 'semua') qs.set('entity', entityFilter);
    const r = await fetch(`${API}/api/history?${qs.toString()}`, { headers });
    if (myLoadId !== loadIdRef.current) return;
    if (r.ok) { const { entries: e } = await r.json() as { entries: AuditEntry[] }; setEntries(e); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [period, customFrom, customTo, entityFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetPage = () => setPage(1);
  const toggleExpanded = (id: string) => setExpandedId(cur => cur === id ? null : id);

  const entityOptions = [
    { value: 'semua', label: 'Semua Modul' },
    ...HISTORY_ENTITIES.map(f => ({ value: f.key, label: f.label })),
  ];
  const actionOptions = [
    { value: 'semua', label: 'Semua Aksi' },
    { value: 'create', label: 'Dibuat' },
    { value: 'update', label: 'Diubah' },
    { value: 'delete', label: 'Dihapus' },
  ];

  const filtered = entries
    .filter(e => {
      const matchAction = actionFilter === 'semua' || e.action === actionFilter;
      const q = search.trim().toLowerCase();
      const matchQ = !q
        || e.entityLabel.toLowerCase().includes(q)
        || e.actorUsername.toLowerCase().includes(q)
        || e.actorRole.toLowerCase().includes(q);
      return matchAction && matchQ;
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const rowNumber = (i: number) => (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + i + 1;

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Pemilih periode */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map(p => (
          <button key={p.id} onClick={() => { setPeriod(p.id); resetPage(); }}
            className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={period === p.id ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); resetPage(); }} className="input" style={{ height: 36 }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); resetPage(); }} className="input" style={{ height: 36 }} />
          </div>
        )}
      </div>

      {/* Filter modul + aksi */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-[200px] flex-shrink-0">
          <FilterSelect value={entityFilter} onChange={v => { setEntityFilter(v); resetPage(); }} height={HEADER_BTN_H} options={entityOptions} searchPlaceholder="Cari modul…" />
        </div>
        <div className="w-full sm:w-[160px] flex-shrink-0">
          <FilterSelect value={actionFilter} onChange={v => { setActionFilter(v); resetPage(); }} height={HEADER_BTN_H} options={actionOptions} searchPlaceholder="Cari aksi…" />
        </div>
      </div>

      {/* Pencarian + toggle tampilan */}
      <div className="flex flex-row items-center gap-2 sm:gap-3">
        {entries.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari nama data, user, atau role…"
            />
          </div>
        )}
        {entries.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="text-5xl mb-4">🕒</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada riwayat pada periode ini</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Riwayat akan tercatat otomatis setiap kali ada transaksi dibuat, diubah, atau dihapus.</p>
        </div>
      ) : paginated.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada riwayat yang cocok.</p>
        </div>
      ) : view === 'table' ? (
        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
          {paginated.map((e, idx) => {
            const actionMeta = ACTION_META[e.action];
            const avatarColor = DIRECTION_COLOR[directionFor(e)];
            const expanded = expandedId === e.id;
            return (
              <div key={e.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>
                    {rowNumber(idx)}
                  </span>
                  <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: avatarColor.bg, color: avatarColor.color }}>
                    {avatarIconFor(e)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{e.entityLabel}</p>
                      <span className={`badge ${actionMeta.badge} text-[10px]`}>{actionMeta.label}</span>
                      <span className="badge badge-gray text-[10px]">{historyEntityLabel(e.entity)}</span>
                    </div>
                    <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <UserIcon size={11} /> {e.actorUsername} ({e.actorRole}) · {formatDateTime(e)}
                    </p>
                  </div>
                  <Tooltip label={expanded ? 'Tutup detail' : 'Lihat detail'}>
                    <button onClick={() => toggleExpanded(e.id)} className="btn-ghost p-2 flex-shrink-0">
                      <ChevronRight size={13} style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                    </button>
                  </Tooltip>
                </div>
                {expanded && <HistoryEntryDetail entry={e} />}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginated.map((e, idx) => {
            const actionMeta = ACTION_META[e.action];
            const avatarColor = DIRECTION_COLOR[directionFor(e)];
            const expanded = expandedId === e.id;
            return (
              <div key={e.id} className="card overflow-hidden relative">
                <span className="absolute top-3 left-3 text-[11px] font-bold tabular-nums rounded-md px-1.5 py-0.5" style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}>
                  {rowNumber(idx)}
                </span>
                <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                  <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: avatarColor.bg, color: avatarColor.color }}>
                    {avatarIconFor(e)}
                  </div>
                  <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{e.entityLabel}</p>
                  <div className="flex items-center gap-1">
                    <span className={`badge ${actionMeta.badge} text-[10px]`}>{actionMeta.label}</span>
                    <span className="badge badge-gray text-[10px]">{historyEntityLabel(e.entity)}</span>
                  </div>
                  <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <UserIcon size={11} /> {e.actorUsername} ({e.actorRole})
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateTime(e)}</p>
                </div>
                <div className="flex items-center justify-center px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <button onClick={() => toggleExpanded(e.id)} className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1">
                    Detail <ChevronRight size={12} style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                  </button>
                </div>
                {expanded && <HistoryEntryDetail entry={e} />}
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {filtered.length} riwayat · halaman {safePage} dari {totalPages}
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
  );
}
