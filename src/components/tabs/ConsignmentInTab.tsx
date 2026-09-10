'use client';

import { useState, useEffect } from 'react';
import {
  Users, PackagePlus, Undo2, Wallet as WalletIcon,
  Plus, Pencil, Trash2, X, Check, Loader2, Trash,
} from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';
import type { PosProduct } from '@/lib/pos-types';

// Fitur "Titip Masuk" (konsinyasi MASUK — partner luar menitip barang ke toko kita untuk dijual,
// kebalikan arah dari tab "Mitra"/ConsignmentTab yang menitip KELUAR). Barang titipan adalah row
// `products` biasa (owner_type='consigned_in') — stoknya ikut logic products/warehouse_stock
// existing, jadi langsung bisa dijual di Kasir. Lihat plan snug-sparking-ocean.md.

const API = '';

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function formatDate(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type SubTab = 'partner' | 'terima' | 'retur' | 'settlement';
const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'partner',    label: 'Partner',        Icon: Users },
  { id: 'terima',     label: 'Terima Titipan', Icon: PackagePlus },
  { id: 'retur',      label: 'Retur ke Partner', Icon: Undo2 },
  { id: 'settlement', label: 'Settlement',     Icon: WalletIcon },
];

interface Partner {
  id: string; name: string; code: string; contactName: string; contactPhone: string; address: string; note: string;
  defaultSettlementType: 'fixed' | 'percentage'; defaultPayoutPrice: number | null; defaultCommissionPct: number | null;
}
type PartnerForm = Omit<Partner, 'id' | 'code'>;
const EMPTY_PARTNER: PartnerForm = {
  name: '', contactName: '', contactPhone: '', address: '', note: '',
  defaultSettlementType: 'fixed', defaultPayoutPrice: null, defaultCommissionPct: null,
};

interface Warehouse { id: string; name: string }

interface ShipmentItem { productId: string; productName: string; qty: number }
interface Shipment {
  id: string; partnerId: string; partnerName: string; warehouseId?: string; warehouseName?: string;
  direction: 'in' | 'out'; items: ShipmentItem[]; note?: string; createdAt?: { seconds: number };
}

interface LedgerEntry {
  id: string; orderId: string | null; productId: string; productName: string;
  consignorId: string; consignorName: string; qty: number; payoutAmount: number;
  status: 'unsettled' | 'settled' | 'voided'; createdAt?: { seconds: number };
}
interface LedgerSummaryRow { productId: string; productName: string; qty: number; payoutAmount: number }

interface Settlement {
  id: string; partnerId: string; partnerName: string;
  items: { productId: string; productName: string; qty: number; payoutAmount: number }[];
  totalPayable: number; walletId: string | null; note?: string; createdAt?: { seconds: number };
}

interface Row { productId: string; qty: string }
const EMPTY_ROW: Row = { productId: '', qty: '' };

export default function ConsignmentInTab({ creds, products }: { creds: string; products: PosProduct[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const wallets = useWallets(creds);
  const [walletBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

  const [subTab, setSubTab] = useState<SubTab>('partner');

  const consignedInProducts = products.filter(p => p.ownerType === 'consigned_in');

  // ── Partner ──────────────────────────────────────────────────────
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [showPForm, setShowPForm] = useState(false);
  const [editingP, setEditingP] = useState<Partner | null>(null);
  const [pForm, setPForm] = useState<PartnerForm>(EMPTY_PARTNER);
  const [savingP, setSavingP] = useState(false);
  const [deletingPId, setDeletingPId] = useState<string | null>(null);

  const loadPartners = async () => {
    setPartnersLoading(true);
    const r = await fetch(`${API}/api/consignment-in/partners`, { headers });
    if (r.ok) setPartners((await r.json() as { partners: Partner[] }).partners);
    setPartnersLoading(false);
  };
  useEffect(() => { loadPartners(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateP = () => { setEditingP(null); setPForm(EMPTY_PARTNER); setShowPForm(true); };
  const openEditP = (p: Partner) => {
    setEditingP(p);
    setPForm({
      name: p.name, contactName: p.contactName, contactPhone: p.contactPhone, address: p.address, note: p.note,
      defaultSettlementType: p.defaultSettlementType, defaultPayoutPrice: p.defaultPayoutPrice, defaultCommissionPct: p.defaultCommissionPct,
    });
    setShowPForm(true);
  };
  const savePartner = async () => {
    if (!pForm.name.trim()) return;
    setSavingP(true);
    const r = editingP
      ? await fetch(`${API}/api/consignment-in/partners/${editingP.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(pForm) })
      : await fetch(`${API}/api/consignment-in/partners`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(pForm) });
    if (r.ok) { await loadPartners(); setShowPForm(false); toast.success(editingP ? 'Partner berhasil diperbarui.' : 'Partner berhasil ditambahkan.'); }
    else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan partner.'); }
    setSavingP(false);
  };
  const deletePartner = async (p: Partner) => {
    if (!await confirm({ message: `Hapus partner "${p.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingPId(p.id);
    const r = await fetch(`${API}/api/consignment-in/partners/${p.id}`, { method: 'DELETE', headers });
    if (r.ok) { setPartners(prev => prev.filter(x => x.id !== p.id)); toast.success(`"${p.name}" berhasil dihapus.`); }
    else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menghapus partner.'); }
    setDeletingPId(null);
  };

  // ── Gudang ───────────────────────────────────────────────────────
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  useEffect(() => {
    fetch(`${API}/api/warehouses`, { headers }).then(async r => {
      if (r.ok) setWarehouses((await r.json() as { warehouses: Warehouse[] }).warehouses);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Terima Titipan ───────────────────────────────────────────────
  const [receivePartnerId, setReceivePartnerId] = useState('');
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');
  const [receiveNote, setReceiveNote] = useState('');
  const [receiveRows, setReceiveRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [savingReceive, setSavingReceive] = useState(false);
  const receivePartnerProducts = consignedInProducts.filter(p => p.consignorId === receivePartnerId);

  const submitReceive = async () => {
    if (!receivePartnerId) { toast.error('Pilih partner dulu.'); return; }
    if (!receiveWarehouseId) { toast.error('Pilih gudang tujuan.'); return; }
    const items = receiveRows
      .filter(r => r.productId && Number(r.qty) > 0)
      .map(r => ({ productId: r.productId, productName: receivePartnerProducts.find(p => p.id === r.productId)?.name ?? '', qty: Number(r.qty) }));
    if (items.length === 0) { toast.error('Isi minimal 1 produk & qty.'); return; }
    setSavingReceive(true);
    const partner = partners.find(p => p.id === receivePartnerId);
    const warehouse = warehouses.find(w => w.id === receiveWarehouseId);
    const r = await fetch(`${API}/api/consignment-in/receive`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partnerId: receivePartnerId, partnerName: partner?.name ?? '',
        warehouseId: receiveWarehouseId, warehouseName: warehouse?.name ?? '',
        note: receiveNote, items,
      }),
    });
    if (r.ok) {
      toast.success('Penerimaan titipan berhasil disimpan.');
      setReceiveRows([{ ...EMPTY_ROW }]); setReceiveNote('');
    } else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan.'); }
    setSavingReceive(false);
  };

  // ── Retur ke Partner ─────────────────────────────────────────────
  const [returnPartnerId, setReturnPartnerId] = useState('');
  const [returnWarehouseId, setReturnWarehouseId] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [returnRows, setReturnRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [savingReturn, setSavingReturn] = useState(false);
  const returnPartnerProducts = consignedInProducts.filter(p => p.consignorId === returnPartnerId);

  const submitReturn = async () => {
    if (!returnPartnerId) { toast.error('Pilih partner dulu.'); return; }
    if (!returnWarehouseId) { toast.error('Pilih gudang asal.'); return; }
    const items = returnRows
      .filter(r => r.productId && Number(r.qty) > 0)
      .map(r => ({ productId: r.productId, productName: returnPartnerProducts.find(p => p.id === r.productId)?.name ?? '', qty: Number(r.qty) }));
    if (items.length === 0) { toast.error('Isi minimal 1 produk & qty.'); return; }
    setSavingReturn(true);
    const partner = partners.find(p => p.id === returnPartnerId);
    const warehouse = warehouses.find(w => w.id === returnWarehouseId);
    const r = await fetch(`${API}/api/consignment-in/return`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partnerId: returnPartnerId, partnerName: partner?.name ?? '',
        warehouseId: returnWarehouseId, warehouseName: warehouse?.name ?? '',
        note: returnNote, items,
      }),
    });
    if (r.ok) {
      toast.success('Retur ke partner berhasil disimpan.');
      setReturnRows([{ ...EMPTY_ROW }]); setReturnNote('');
    } else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan.'); }
    setSavingReturn(false);
  };

  // ── Riwayat Terima/Retur ─────────────────────────────────────────
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const loadShipments = async () => {
    const r = await fetch(`${API}/api/consignment-in/shipments`, { headers });
    if (r.ok) setShipments((await r.json() as { shipments: Shipment[] }).shipments);
  };
  useEffect(() => { loadShipments(); }, [subTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Settlement ───────────────────────────────────────────────────
  const [settlePartnerId, setSettlePartnerId] = useState('');
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummaryRow[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [settleWalletId, setSettleWalletId] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [savingSettle, setSavingSettle] = useState(false);
  const [settlements, setSettlements] = useState<Settlement[]>([]);

  const loadLedger = async (partnerId: string) => {
    if (!partnerId) { setLedgerSummary([]); setLedgerEntries([]); setLedgerTotal(0); return; }
    setLedgerLoading(true);
    const r = await fetch(`${API}/api/consignment-in/ledger?partnerId=${partnerId}&status=unsettled`, { headers });
    if (r.ok) {
      const d = await r.json() as { entries: LedgerEntry[]; summary: LedgerSummaryRow[]; total: number };
      setLedgerEntries(d.entries); setLedgerSummary(d.summary); setLedgerTotal(d.total);
    }
    setLedgerLoading(false);
  };
  const loadSettlements = async (partnerId: string) => {
    const qs = partnerId ? `?partnerId=${partnerId}` : '';
    const r = await fetch(`${API}/api/consignment-in/settle${qs}`, { headers });
    if (r.ok) setSettlements((await r.json() as { settlements: Settlement[] }).settlements);
  };
  useEffect(() => {
    if (subTab !== 'settlement') return;
    loadLedger(settlePartnerId);
    loadSettlements(settlePartnerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, settlePartnerId]);

  const submitSettle = async () => {
    if (!settlePartnerId) { toast.error('Pilih partner dulu.'); return; }
    if (ledgerEntries.length === 0) { toast.error('Tidak ada tagihan yang belum dibayar.'); return; }
    if (!await confirm({ message: `Bayar tagihan sebesar ${formatRp(ledgerTotal)} ke "${partners.find(p => p.id === settlePartnerId)?.name}"?` })) return;
    setSavingSettle(true);
    const partner = partners.find(p => p.id === settlePartnerId);
    const r = await fetch(`${API}/api/consignment-in/settle`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ partnerId: settlePartnerId, partnerName: partner?.name ?? '', walletId: settleWalletId || null, note: settleNote }),
    });
    if (r.ok) {
      toast.success('Settlement berhasil disimpan.');
      setSettleNote(''); setSettleWalletId('');
      await loadLedger(settlePartnerId); await loadSettlements(settlePartnerId);
    } else { const d = await r.json().catch(() => ({ error: undefined })) as { error?: string }; toast.error(d.error ?? 'Gagal menyimpan settlement.'); }
    setSavingSettle(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: 'var(--surface-2)', width: 'fit-content' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors"
            style={subTab === t.id ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)' }}>
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {subTab === 'partner' && (
        <div className="flex flex-col gap-3">
          <div className="flex justify-end">
            <button onClick={openCreateP} className="btn-primary flex items-center gap-1.5 text-xs font-semibold" style={{ height: 34, padding: '0 12px' }}>
              <Plus size={14} /> Tambah Partner
            </button>
          </div>
          {partnersLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin" size={20} /></div>
          ) : partners.length === 0 ? (
            <p className="text-sm text-center py-10" style={{ color: 'var(--text-muted)' }}>Belum ada partner titip masuk.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {partners.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                      <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{p.code}</span>
                      <span className="badge badge-gray">{p.defaultSettlementType === 'fixed' ? `Tetap ${formatRp(p.defaultPayoutPrice ?? 0)}` : `Komisi toko ${p.defaultCommissionPct ?? 0}%`}</span>
                    </div>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{p.contactPhone || '–'} · {p.address || '–'}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEditP(p)} className="btn-ghost p-2"><Pencil size={14} /></button>
                    <button onClick={() => deletePartner(p)} disabled={deletingPId === p.id} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                      {deletingPId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showPForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowPForm(false)}>
              <div className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold">{editingP ? 'Edit Partner' : 'Tambah Partner'}</p>
                  <button onClick={() => setShowPForm(false)} className="btn-ghost p-1.5"><X size={16} /></button>
                </div>
                <div>
                  <label className="field-label">Nama Partner *</label>
                  <input value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })} className="input" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Nama Kontak</label>
                    <input value={pForm.contactName} onChange={e => setPForm({ ...pForm, contactName: e.target.value })} className="input" />
                  </div>
                  <div>
                    <label className="field-label">Telepon</label>
                    <input value={pForm.contactPhone} onChange={e => setPForm({ ...pForm, contactPhone: e.target.value })} className="input" />
                  </div>
                </div>
                <div>
                  <label className="field-label">Alamat</label>
                  <input value={pForm.address} onChange={e => setPForm({ ...pForm, address: e.target.value })} className="input" />
                </div>
                <div className="flex items-center justify-between">
                  <label className="field-label" style={{ marginBottom: 0 }}>Model Settlement Default</label>
                  <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    {(['fixed', 'percentage'] as const).map(st => (
                      <button key={st} type="button" onClick={() => setPForm({ ...pForm, defaultSettlementType: st })}
                        className="text-xs font-semibold" style={{ padding: '5px 10px', background: pForm.defaultSettlementType === st ? 'var(--accent)' : 'transparent', color: pForm.defaultSettlementType === st ? '#fff' : 'var(--text-secondary)' }}>
                        {st === 'fixed' ? 'Harga Tetap' : 'Bagi Hasil %'}
                      </button>
                    ))}
                  </div>
                </div>
                {pForm.defaultSettlementType === 'fixed' ? (
                  <div>
                    <label className="field-label">Harga Beli Titip Default (Rp/pcs)</label>
                    <NumberInput value={pForm.defaultPayoutPrice ?? ''} onChange={raw => setPForm({ ...pForm, defaultPayoutPrice: raw ? Number(raw) : null })} />
                  </div>
                ) : (
                  <div>
                    <label className="field-label">Komisi Toko Default (%)</label>
                    <NumberInput value={pForm.defaultCommissionPct ?? ''} onChange={raw => setPForm({ ...pForm, defaultCommissionPct: raw ? Number(raw) : null })} />
                  </div>
                )}
                <div>
                  <label className="field-label">Catatan</label>
                  <input value={pForm.note} onChange={e => setPForm({ ...pForm, note: e.target.value })} className="input" />
                </div>
                <button onClick={savePartner} disabled={savingP || !pForm.name.trim()} className="btn-primary flex items-center justify-center gap-1.5 text-sm font-semibold" style={{ height: 38 }}>
                  {savingP ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Simpan
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(subTab === 'terima' || subTab === 'retur') && (() => {
        const isReceive = subTab === 'terima';
        const partnerId = isReceive ? receivePartnerId : returnPartnerId;
        const setPartnerId = isReceive ? setReceivePartnerId : setReturnPartnerId;
        const warehouseId = isReceive ? receiveWarehouseId : returnWarehouseId;
        const setWarehouseId = isReceive ? setReceiveWarehouseId : setReturnWarehouseId;
        const note = isReceive ? receiveNote : returnNote;
        const setNote = isReceive ? setReceiveNote : setReturnNote;
        const rows = isReceive ? receiveRows : returnRows;
        const setRows = isReceive ? setReceiveRows : setReturnRows;
        const partnerProducts = isReceive ? receivePartnerProducts : returnPartnerProducts;
        const saving = isReceive ? savingReceive : savingReturn;
        const submit = isReceive ? submitReceive : submitReturn;
        const directionShipments = shipments.filter(s => s.direction === (isReceive ? 'in' : 'out'));

        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Partner</label>
                  <SearchSelect value={partnerId} onChange={setPartnerId}
                    options={partners.map(p => ({ value: p.id, label: p.name }))}
                    placeholder="— Pilih partner —" searchPlaceholder="Cari partner…" />
                </div>
                <div>
                  <label className="field-label">Gudang {isReceive ? 'Tujuan' : 'Asal'}</label>
                  <SearchSelect value={warehouseId} onChange={setWarehouseId}
                    options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                    placeholder="— Pilih gudang —" searchPlaceholder="Cari gudang…" />
                </div>
              </div>

              {partnerId && partnerProducts.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--warning)' }}>
                  Partner ini belum punya produk titipan terdaftar. Tambahkan dulu lewat menu Produk (Kepemilikan → Titipan, pilih partner ini).
                </p>
              )}

              <div className="flex flex-col gap-2">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1">
                      <SearchSelect value={row.productId}
                        onChange={v => setRows(rs => rs.map((r, ri) => ri === i ? { ...r, productId: v } : r))}
                        options={partnerProducts.map(p => ({ value: p.id, label: p.name }))}
                        placeholder="— Pilih produk —" searchPlaceholder="Cari produk…" />
                    </div>
                    <div style={{ width: 100 }}>
                      <NumberInput value={row.qty} placeholder="Qty"
                        onChange={raw => setRows(rs => rs.map((r, ri) => ri === i ? { ...r, qty: raw } : r))} />
                    </div>
                    <button onClick={() => setRows(rs => rs.filter((_, ri) => ri !== i))} disabled={rows.length === 1} className="btn-ghost p-2 disabled:opacity-30">
                      <Trash size={14} />
                    </button>
                  </div>
                ))}
                <button onClick={() => setRows(rs => [...rs, { ...EMPTY_ROW }])} className="btn-ghost text-xs font-semibold self-start flex items-center gap-1" style={{ height: 30, padding: '0 10px' }}>
                  <Plus size={12} /> Tambah Baris
                </button>
              </div>

              <div>
                <label className="field-label">Catatan</label>
                <input value={note} onChange={e => setNote(e.target.value)} className="input" />
              </div>

              <button onClick={submit} disabled={saving} className="btn-primary flex items-center justify-center gap-1.5 text-sm font-semibold self-end" style={{ height: 38, padding: '0 16px' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {isReceive ? 'Simpan Penerimaan' : 'Simpan Retur'}
              </button>
            </div>

            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Riwayat {isReceive ? 'Terima Titipan' : 'Retur ke Partner'}</p>
              {directionShipments.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {directionShipments.map(s => (
                    <div key={s.id} className="p-3 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold">{s.partnerName}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)}</p>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.warehouseName} {s.note ? `· ${s.note}` : ''}</p>
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        {s.items.map((it, i) => (
                          <p key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>{it.productName} × {it.qty}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {subTab === 'settlement' && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="field-label">Partner</label>
            <SearchSelect value={settlePartnerId} onChange={setSettlePartnerId}
              options={partners.map(p => ({ value: p.id, label: p.name }))}
              placeholder="— Pilih partner —" searchPlaceholder="Cari partner…" />
          </div>

          {settlePartnerId && (
            <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Belum Dibayar</p>
              {ledgerLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="animate-spin" size={18} /></div>
              ) : ledgerSummary.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>Tidak ada tagihan belum dibayar untuk partner ini.</p>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    {ledgerSummary.map(row => (
                      <div key={row.productId} className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-secondary)' }}>{row.productName} × {row.qty}</span>
                        <span className="font-semibold tabular">{formatRp(row.payoutAmount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <span className="text-sm font-bold">Total</span>
                    <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>{formatRp(ledgerTotal)}</span>
                  </div>

                  <div>
                    <label className="field-label">Dompet Pembayaran</label>
                    <SearchSelect value={settleWalletId} onChange={setSettleWalletId}
                      options={walletOptions} placeholder="— Pilih dompet —" searchPlaceholder="Cari dompet…" />
                  </div>
                  <div>
                    <label className="field-label">Catatan</label>
                    <input value={settleNote} onChange={e => setSettleNote(e.target.value)} className="input" />
                  </div>
                  <button onClick={submitSettle} disabled={savingSettle} className="btn-primary flex items-center justify-center gap-1.5 text-sm font-semibold self-end" style={{ height: 38, padding: '0 16px' }}>
                    {savingSettle ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Bayar {formatRp(ledgerTotal)}
                  </button>
                </>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Riwayat Settlement</p>
            {settlements.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat settlement.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {settlements.map(s => (
                  <div key={s.id} className="p-3 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold">{s.partnerName}</p>
                      <p className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>{formatRp(s.totalPayable)}</p>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)} {s.note ? `· ${s.note}` : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
