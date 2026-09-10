'use client';

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import {
  Loader2, Users, PackagePlus, Wallet, TrendingDown,
  PieChart as PieIcon, Package, Receipt, ChevronRight,
} from 'lucide-react';
import TopListChart from './TopListChart';
import { type PeriodKey, PERIOD_OPTIONS } from '@/lib/period';

export interface ConsignmentInAnalyticsData {
  period: { from: string; to: string };
  summary: {
    totalPartners: number;
    totalReceivedQty: number; totalReturnedQty: number; totalSoldQty: number;
    totalPayout: number; totalSettled: number;
    totalOutstanding: number; outstandingCount: number;
    unsettled: { amount: number }; settled: { amount: number };
  };
  topPartners: { id: string; name: string; payout: number; qty: number; receivedQty: number; returnedQty: number; outstanding: number }[];
  topProducts: { productId: string; productName: string; qty: number; payout: number }[];
  paymentStatus: { status: 'settled' | 'unsettled'; label: string; amount: number }[];
  dailyTrend: { date: string; payout: number; settled: number }[];
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function compactRp(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}jt`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return `${n}`;
}

function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

// Peran warna sama seperti ConsignmentAnalyticsSection.tsx (arah keluar) supaya konsisten kalau
// dua section ini dilihat berdampingan: hijau = uang sudah keluar/lunas, merah = kewajiban belum
// dibayar, biru = aktivitas fisik (terima/retur), ungu = jumlah entitas.
const PAYMENT_STATUS_COLORS: Record<string, string> = { settled: '#059669', unsettled: '#DC2626' };

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block', flexShrink: 0 }} />
      {label}
    </span>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; label?: string; payload?: { name?: string; value?: number; color?: string }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background: 'var(--text-primary)', color: 'white', padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }}>
      {label && <div style={{ opacity: 0.65, marginBottom: 4, fontWeight: 700 }}>{shortDate(label)}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ opacity: 0.75 }}>{p.name}:</span>
          <span style={{ fontWeight: 800 }}>{formatRp(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

function ProductTooltip({ active, payload }: {
  active?: boolean; payload?: { payload?: { productName?: string; payout?: number; qty?: number } }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  if (!d) return null;
  return (
    <div style={{ background: 'var(--text-primary)', color: 'white', padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }}>
      <div style={{ opacity: 0.65, marginBottom: 2, fontWeight: 700 }}>{d.productName}</div>
      <div style={{ fontWeight: 800 }}>{formatRp(d.payout ?? 0)}</div>
      <div style={{ opacity: 0.65 }}>{d.qty} pcs terjual</div>
    </div>
  );
}

function PaymentStatusTooltip({ active, payload }: {
  active?: boolean; payload?: { payload?: { label?: string; amount?: number } }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  if (!d) return null;
  return (
    <div style={{ background: 'var(--text-primary)', color: 'white', padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }}>
      <div style={{ opacity: 0.65, marginBottom: 2, fontWeight: 700 }}>{d.label}</div>
      <div style={{ fontWeight: 800 }}>{formatRp(d.amount ?? 0)}</div>
    </div>
  );
}

interface Props {
  data: ConsignmentInAnalyticsData | null;
  loading: boolean;
  period: PeriodKey;
  customFrom: string;
  customTo: string;
  onPeriodChange: (p: PeriodKey) => void;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  onNavigatePartner?: (partnerId: string) => void;
}

export default function ConsignmentInAnalyticsSection({
  data, loading, period, customFrom, customTo,
  onPeriodChange, onCustomFromChange, onCustomToChange, onNavigatePartner,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2.5 pt-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            <PackagePlus size={16} />
          </div>
          <div>
            <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Analitik Titip Masuk</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Barang titipan partner — terima, terjual &amp; pelunasan</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIOD_OPTIONS.map(p => (
            <button key={p.id} onClick={() => onPeriodChange(p.id)} disabled={loading}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={period === p.id ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" value={customFrom} onChange={e => onCustomFromChange(e.target.value)} className="input" style={{ height: 36 }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
          <input type="date" value={customTo} onChange={e => onCustomToChange(e.target.value)} className="input" style={{ height: 36 }} />
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      )}

      {data && (
        <div className="space-y-5" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: <Users size={16} />, label: 'Total Partner', val: data.summary.totalPartners.toString(), color: '#7C3AED', bg: '#F5F3FF' },
              { icon: <PackagePlus size={16} />, label: 'Diterima (Periode)', val: `${data.summary.totalReceivedQty.toLocaleString('id-ID')} pcs`, color: '#0284C7', bg: '#EFF6FF' },
              { icon: <Wallet size={16} />, label: 'Terjual (Periode)', val: formatRp(data.summary.totalPayout), color: 'var(--success)', bg: 'var(--success-bg)' },
              { icon: <TrendingDown size={16} />, label: 'Belum Dibayar (Saat Ini)', val: formatRp(data.summary.totalOutstanding), color: 'var(--danger)', bg: 'var(--danger-bg)' },
            ].map((c, i) => (
              <div key={i} className="card relative p-4 overflow-hidden">
                <div style={{ width: 34, height: 34, borderRadius: 10, background: c.bg, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  {c.icon}
                </div>
                <p className="tabular" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1.15, marginBottom: 4 }}>
                  {c.val}
                </p>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{c.label}</p>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: '0 0 12px 12px', background: `linear-gradient(90deg, ${c.color}, ${c.color}88)` }} />
              </div>
            ))}
          </div>

          {/* Tren terjual vs dibayar */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tren Terjual vs Dibayar</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Payout yang timbul dari penjualan dibanding yang sudah dilunasi ke partner</p>
              </div>
              <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <LegendDot color="#0284C7" label="Terjual" />
                <LegendDot color="#059669" label="Dibayar" />
              </div>
            </div>
            {data.dailyTrend.every(d => d.payout + d.settled === 0) ? (
              <div className="py-8 text-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada aktivitas titip masuk di periode ini</p>
              </div>
            ) : (
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <AreaChart data={data.dailyTrend} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border-2)" />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border-2)' }} tickLine={false} />
                    <YAxis tickFormatter={compactRp} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)', strokeDasharray: '4 3' }} />
                    <Area type="monotone" dataKey="payout" name="Terjual" stroke="#0284C7" fill="#0284C7" fillOpacity={0.16} strokeWidth={2} />
                    <Area type="monotone" dataKey="settled" name="Dibayar" stroke="#059669" fill="#059669" fillOpacity={0.16} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Partner teratas (payout) */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users size={15} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Partner Teratas (Nilai Terjual)</p>
            </div>
            {data.topPartners.length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada aktivitas partner di periode ini.</p>
            ) : (
              <TopListChart color="var(--accent)" formatValue={formatRp} items={data.topPartners.slice(0, 8).map(p => ({ label: p.name, value: p.payout }))} />
            )}
          </div>

          {/* Status pembayaran (pie) */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <PieIcon size={15} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Status Pembayaran (Periode)</p>
            </div>
            {data.summary.unsettled.amount + data.summary.settled.amount === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada penjualan produk titipan di periode ini.</p>
            ) : (() => {
              const totalAmount = data.paymentStatus.reduce((sum, s) => sum + s.amount, 0);
              const pctOf = (amount: number) => totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0;
              const settledEntry = data.paymentStatus.find(s => s.status === 'settled');
              const settledPct = settledEntry ? pctOf(settledEntry.amount) : 0;
              return (
                <div className="flex items-center gap-4">
                  <div style={{ width: 140, height: 140, flexShrink: 0, position: 'relative' }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={data.paymentStatus} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} strokeWidth={0}>
                          {data.paymentStatus.map((entry, i) => <Cell key={i} fill={PAYMENT_STATUS_COLORS[entry.status]} />)}
                        </Pie>
                        <Tooltip content={<PaymentStatusTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ pointerEvents: 'none' }}>
                      <span className="text-base font-extrabold tabular" style={{ color: PAYMENT_STATUS_COLORS.settled }}>{settledPct}%</span>
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>Dibayar</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3 min-w-0">
                    {data.paymentStatus.map((s, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: PAYMENT_STATUS_COLORS[s.status], flexShrink: 0 }} />
                          {s.label}
                        </span>
                        <span className="text-xs font-bold tabular flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                          {formatRp(s.amount)} <span className="font-medium opacity-60">· {pctOf(s.amount)}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Produk terlaris */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Package size={15} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Produk Titipan Terlaris</p>
            </div>
            {data.topProducts.length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada produk titipan terjual di periode ini.</p>
            ) : (
              <div style={{ width: '100%', height: Math.max(120, data.topProducts.length * 34) }}>
                <ResponsiveContainer>
                  <BarChart data={data.topProducts} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={10}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="productName" width={110} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ProductTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="payout" fill="var(--accent)" radius={[0, 4, 4, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Rincian per partner */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border-2)' }}>
              <Receipt size={15} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-bold flex-1" style={{ color: 'var(--text-primary)' }}>Rincian per Partner</p>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Belum dibayar saat ini: <strong style={{ color: 'var(--danger)' }}>{formatRp(data.summary.totalOutstanding)}</strong>
              </span>
            </div>
            {data.topPartners.length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada aktivitas partner.</p>
            ) : (
              <div>
                {data.topPartners.map((p, idx) => (
                  <button key={p.id} onClick={() => onNavigatePartner?.(p.id)}
                    disabled={!onNavigatePartner}
                    className="w-full text-left px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 transition-colors disabled:cursor-default"
                    style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}
                    onMouseEnter={e => { if (onNavigatePartner) e.currentTarget.style.background = 'var(--surface-2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <div className="flex-1 flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-xs" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {p.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          Terima {p.receivedQty} · Retur {p.returnedQty} · Terjual {p.qty} pcs
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:contents pl-12 sm:pl-0">
                      <div className="text-left sm:text-right flex-shrink-0">
                        <p className="text-sm font-extrabold tabular" style={{ color: 'var(--success)' }}>{formatRp(p.payout)}</p>
                        {p.outstanding > 0 && (
                          <p className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>{formatRp(p.outstanding)} belum dibayar</p>
                        )}
                      </div>
                      {onNavigatePartner && <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
