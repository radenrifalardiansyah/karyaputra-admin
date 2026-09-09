'use client';

import { useState, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Loader2, Globe, ShoppingCart, Store, Wallet, Package, Receipt, PieChart as PieIcon,
  Boxes, ArrowUpCircle, ArrowDownCircle, ChevronRight, AlertTriangle,
} from 'lucide-react';
import TopListChart from './TopListChart';
import { type PeriodKey, PERIOD_OPTIONS } from '@/lib/period';
import { SALDO_AWAL_KEY } from '@/lib/finance';

export interface BusinessAnalyticsData {
  period: { from: string; to: string };
  channels: { online: number; pos: number; consignment: number; incomeLain: number; total: number };
  finance: { pendapatan: number; hpp: number; labaKotor: number; bebanOperasional: number; labaBersih: number };
  cash: { allTimeTx: number };
  expenseByCategory: { category: string; amount: number }[];
  incomeByCategory: { category: string; amount: number }[];
  materials: {
    totalValue: number; count: number; lowStockCount: number;
    topByValue: { id: string; name: string; unit: string; stockQty: number; avgCost: number; value: number }[];
  };
  dailyTrend: { date: string; online: number; pos: number; consignment: number; incomeLain: number; expense: number; pendapatan: number }[];
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const formatQty = (n: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

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

// Sama seperti EXPENSE_CATEGORY_COLORS di FinanceReportTab — warna mengikuti identitas kategori
// (bukan urutan/rank), supaya kategori yang sama terlihat konsisten di Dashboard & Laporan Keuangan.
const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  'Bahan Baku': '#B45309', 'Produksi': '#15803D', 'Sewa': '#7C3AED', 'Gaji': '#0284C7',
  'Listrik & Air': '#0891B2', 'Transportasi': '#DB2777', 'Perlengkapan': '#65A30D',
};
const INCOME_CATEGORY_COLORS: Record<string, string> = {
  'Penjualan Lain': '#059669', 'Komisi': '#0284C7', 'Refund/Retur Diterima': '#0891B2',
  'Bunga Bank': '#65A30D', 'Klaim Asuransi': '#7C3AED',
};

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
    <div style={{
      background: 'var(--text-primary)', color: 'white', padding: '8px 12px', borderRadius: 8,
      fontSize: 11, fontWeight: 600, boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
    }}>
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

function CategoryTooltip({ active, payload }: {
  active?: boolean; payload?: { payload?: { category?: string; amount?: number } }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--text-primary)', color: 'white', padding: '8px 12px', borderRadius: 8,
      fontSize: 11, fontWeight: 600, boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
    }}>
      <div style={{ opacity: 0.65, marginBottom: 2, fontWeight: 700 }}>{d.category}</div>
      <div style={{ fontWeight: 800 }}>{formatRp(d.amount ?? 0)}</div>
    </div>
  );
}

interface Props {
  data: BusinessAnalyticsData | null;
  loading: boolean;
  period: PeriodKey;
  customFrom: string;
  customTo: string;
  onPeriodChange: (p: PeriodKey) => void;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  onNavigateFinance: () => void;
}

export default function BusinessAnalyticsSection({
  data, loading, period, customFrom, customTo,
  onPeriodChange, onCustomFromChange, onCustomToChange, onNavigateFinance,
}: Props) {
  // "Saldo Awal" (kas sebelum mulai pakai aplikasi ini) diisi manual di tab Jurnal Kas Laporan
  // Keuangan, disimpan di localStorage browser yang sama — dibaca ulang di sini supaya "Saldo Kas
  // Saat Ini" konsisten persis dengan yang ada di Laporan Keuangan, bukan cuma sebagian (allTimeTx).
  const [saldoAwal, setSaldoAwal] = useState(0);
  useEffect(() => {
    const saved = localStorage.getItem(SALDO_AWAL_KEY);
    if (saved) setSaldoAwal(parseFloat(saved) || 0);
  }, []);

  return (
    <div className="space-y-5">
      {data && (
        <div className="card p-5 flex items-center justify-between gap-4 flex-wrap" style={{ background: 'linear-gradient(135deg, var(--accent-bg), var(--surface-2))' }}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,105,30,0.15)', color: 'var(--accent)' }}>
              <Wallet size={20} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Saldo Kas Saat Ini</p>
              <p className="text-2xl font-extrabold tabular leading-tight" style={{ color: (saldoAwal + data.cash.allTimeTx) >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>
                {formatRp(saldoAwal + data.cash.allTimeTx)}
              </p>
            </div>
          </div>
          <button onClick={onNavigateFinance}
            className="flex items-center gap-1 text-xs font-bold flex-shrink-0"
            style={{ color: 'var(--accent)' }}>
            Lihat Laporan Keuangan <ChevronRight size={13} />
          </button>
        </div>
      )}
      {/* Header + pemilih periode — satu baris filter yang menaungi semua chart di bawahnya */}
      <div className="flex items-center justify-between gap-2.5 pt-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            <PieIcon size={16} />
          </div>
          <div>
            <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Analitik Bisnis</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Online, Kasir, Konsinyasi, Keuangan &amp; Bahan Baku</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIOD_OPTIONS.map(p => (
            <button key={p.id} onClick={() => onPeriodChange(p.id)} disabled={loading}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={period === p.id
                ? { background: 'linear-gradient(135deg,#16A34A,#15803D)', color: 'white' }
                : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
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
          {/* Channel stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: <Globe size={16} />, label: 'Penjualan Online', val: data.channels.online, color: '#0284C7', bg: '#EFF6FF' },
              { icon: <ShoppingCart size={16} />, label: 'Penjualan Kasir (POS)', val: data.channels.pos, color: 'var(--accent)', bg: 'var(--accent-bg)' },
              { icon: <Store size={16} />, label: 'Konsinyasi', val: data.channels.consignment, color: '#7C3AED', bg: '#F5F3FF' },
              { icon: <Wallet size={16} />, label: 'Total Pendapatan', val: data.channels.total, color: 'var(--success)', bg: 'var(--success-bg)' },
            ].map((c, i) => (
              <div key={i} className="card relative p-4 overflow-hidden">
                <div style={{ width: 34, height: 34, borderRadius: 10, background: c.bg, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  {c.icon}
                </div>
                <p className="tabular" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1.15, marginBottom: 4 }}>
                  {formatRp(c.val)}
                </p>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{c.label}</p>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: '0 0 12px 12px', background: `linear-gradient(90deg, ${c.color}, ${c.color}88)` }} />
              </div>
            ))}
          </div>

          {/* Tren penjualan per channel */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tren Penjualan per Channel</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Perbandingan Online vs Kasir vs Konsinyasi</p>
              </div>
              <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <LegendDot color="#0284C7" label="Online" />
                <LegendDot color="var(--accent)" label="Kasir" />
                <LegendDot color="#7C3AED" label="Konsinyasi" />
              </div>
            </div>
            {data.dailyTrend.every(d => d.online + d.pos + d.consignment === 0) ? (
              <div className="py-8 text-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada transaksi di periode ini</p>
              </div>
            ) : (
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <AreaChart data={data.dailyTrend} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border-2)" />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border-2)' }} tickLine={false} />
                    <YAxis tickFormatter={compactRp} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)', strokeDasharray: '4 3' }} />
                    <Area type="monotone" dataKey="online" name="Online" stackId="ch" stroke="#0284C7" fill="#0284C7" fillOpacity={0.16} strokeWidth={2} />
                    <Area type="monotone" dataKey="pos" name="Kasir" stackId="ch" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.16} strokeWidth={2} />
                    <Area type="monotone" dataKey="consignment" name="Konsinyasi" stackId="ch" stroke="#7C3AED" fill="#7C3AED" fillOpacity={0.16} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Ringkasan Laba Rugi */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ringkasan Laba Rugi</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Basis akrual — HPP dihitung saat barang terjual</p>
              </div>
              <button onClick={onNavigateFinance}
                className="flex items-center gap-1 text-xs font-bold flex-shrink-0"
                style={{ color: 'var(--accent)' }}>
                Lihat detail <ChevronRight size={13} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              {[
                { icon: <Receipt size={14} />, label: 'Pendapatan', val: data.finance.pendapatan, color: 'var(--success)' },
                { icon: <Package size={14} />, label: 'HPP', val: data.finance.hpp, color: '#B45309' },
                { icon: <PieIcon size={14} />, label: 'Laba Kotor', val: data.finance.labaKotor, color: 'var(--accent)' },
                { icon: <ArrowDownCircle size={14} />, label: 'Beban Operasional', val: data.finance.bebanOperasional, color: 'var(--danger)' },
                { icon: <Wallet size={14} />, label: data.finance.labaBersih >= 0 ? 'Laba Bersih' : 'Rugi Bersih', val: data.finance.labaBersih, color: data.finance.labaBersih >= 0 ? 'var(--accent)' : 'var(--danger)' },
              ].map((c, i) => (
                <div key={i} className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-1.5 mb-1.5" style={{ color: c.color }}>{c.icon}</div>
                  <p className="tabular font-extrabold truncate" style={{ fontSize: 14, color: c.color }}>{formatRp(c.val)}</p>
                  <p className="text-[10px] font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                </div>
              ))}
            </div>

            {data.dailyTrend.some(d => d.pendapatan > 0 || d.expense > 0) && (
              <>
                <div className="flex items-center gap-3 text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                  <LegendDot color="#15803D" label="Pendapatan" />
                  <LegendDot color="#DC2626" label="Pengeluaran" />
                </div>
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={data.dailyTrend} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--border-2)" />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border-2)' }} tickLine={false} />
                      <YAxis tickFormatter={compactRp} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={44} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)', strokeDasharray: '4 3' }} />
                      <Line type="monotone" dataKey="pendapatan" name="Pendapatan" stroke="#15803D" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="expense" name="Pengeluaran" stroke="#DC2626" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>

          {/* Rincian Pengeluaran & Pemasukan */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <ArrowDownCircle size={15} style={{ color: 'var(--danger)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Rincian Pengeluaran</p>
              </div>
              {data.expenseByCategory.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Tidak ada pengeluaran di periode ini.</p>
              ) : (
                <div style={{ width: '100%', height: Math.max(120, data.expenseByCategory.slice(0, 7).length * 34) }}>
                  <ResponsiveContainer>
                    <BarChart data={data.expenseByCategory.slice(0, 7)} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={10}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="category" width={100} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CategoryTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                      <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={18}>
                        {data.expenseByCategory.slice(0, 7).map((entry, i) => (
                          <Cell key={i} fill={EXPENSE_CATEGORY_COLORS[entry.category] ?? '#9CA3AF'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <ArrowUpCircle size={15} style={{ color: 'var(--success)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Rincian Pemasukan Lain-lain</p>
              </div>
              {data.incomeByCategory.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Tidak ada pemasukan lain-lain di periode ini.</p>
              ) : (
                <div style={{ width: '100%', height: Math.max(120, data.incomeByCategory.slice(0, 7).length * 34) }}>
                  <ResponsiveContainer>
                    <BarChart data={data.incomeByCategory.slice(0, 7)} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={10}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="category" width={100} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CategoryTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                      <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={18}>
                        {data.incomeByCategory.slice(0, 7).map((entry, i) => (
                          <Cell key={i} fill={INCOME_CATEGORY_COLORS[entry.category] ?? '#059669'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Bahan Baku */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border-2)' }}>
              <Boxes size={15} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-bold flex-1" style={{ color: 'var(--text-primary)' }}>Nilai Stok Bahan Baku</p>
              {data.materials.lowStockCount > 0 && (
                <span className="badge badge-amber flex items-center gap-1">
                  <AlertTriangle size={11} /> {data.materials.lowStockCount} menipis
                </span>
              )}
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <p className="tabular font-extrabold" style={{ fontSize: 18, color: 'var(--text-primary)' }}>{formatRp(data.materials.totalValue)}</p>
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Total nilai stok ({data.materials.count} item)</p>
                </div>
              </div>
              {data.materials.topByValue.length === 0 ? (
                <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Belum ada data bahan baku.</p>
              ) : (
                <TopListChart
                  color="var(--accent)"
                  formatValue={formatRp}
                  items={data.materials.topByValue.map(m => ({ label: m.name, value: m.value, sub: m.unit ? `· stok ${formatQty(m.stockQty)} ${m.unit}` : undefined }))}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
