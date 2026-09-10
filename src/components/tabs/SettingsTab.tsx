'use client';

import { useState, useEffect } from 'react';
import { Loader2, Check, Store, Phone, Shield, Clock, Save, Database, RefreshCw, Landmark, Warehouse, Wallet, Palette, Plus, Pencil, Trash2, X, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import ScrollChips from '@/components/ScrollChips';
import SearchSelect from '@/components/SearchSelect';
import ImageUploadBox from '@/components/ImageUploadBox';
import ColorPicker from '@/components/ColorPicker';
import Tooltip from '@/components/Tooltip';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useViewMode } from '@/lib/useViewMode';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';

interface StoreSettings {
  storeName?: string; storeTagline?: string; storeDescription?: string; logo?: string;
  legalName?: string;
  ownerName?: string; ownerSignature?: string; ownerStamp?: string;
  whatsapp?: string; instagramUrl?: string; tiktokUrl?: string; shopeeUrl?: string; mapsUrl?: string;
  address?: string; city?: string;
  privacyPolicy?: string; termsOfService?: string; returnPolicy?: string;
  minOrderWhatsapp?: string; openHours?: string;
  freeShippingMin?: number; resellerDiscount?: number;
  announcementBanner?: string; announcementActive?: boolean;
  posWarehouseId?: string; posWarehouseName?: string;
  // Rekening & QRIS toko sendiri — tempat customer transfer saat checkout online
  // (beda dari rekening reseller/adminFeeSettings, lihat komentar di api/settings/route.ts).
  storeBankName?: string; storeBankAccountNumber?: string; storeBankAccountHolder?: string;
  storeQrisImageUrl?: string;
  // Tema visual — storefront (publik) dan dashboard admin ini punya warna sendiri-sendiri.
  storefrontThemeColor?: string; storefrontThemeBackgroundColor?: string;
  adminAppName?: string; adminThemeColor?: string; adminThemeBackgroundColor?: string;
}

interface SettingsWarehouse { id: string; name: string }
interface MasterBank { id: string; code: string; name: string; bankCode?: string; ewallet: boolean; logoUrl?: string }
type BankForm = { code: string | null; name: string; bankCode: string; ewallet: boolean; logoUrl: string };
const emptyBankForm = (): BankForm => ({ code: null, name: '', bankCode: '', ewallet: false, logoUrl: '' });

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

function BankLogo({ bank, size }: { bank: { name: string; logoUrl?: string }; size: number }) {
  if (bank.logoUrl) {
    return (
      <div className="rounded-lg overflow-hidden flex-shrink-0" style={{ width: size, height: size, background: 'var(--surface)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bank.logoUrl} alt={bank.name} className="w-full h-full" style={{ objectFit: 'contain' }} />
      </div>
    );
  }
  return (
    <div className="rounded-lg flex-shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
      <Landmark size={Math.round(size * 0.45)} />
    </div>
  );
}

const FIELD_GROUPS = [
  {
    id: 'store', icon: <Store size={15}/>, label: 'Info Toko',
    fields: [
      { key: 'storeName',        label: 'Nama Toko',       type: 'text',     placeholder: 'Cemilan Teh Risma' },
      { key: 'legalName',        label: 'Nama Usaha (Legal)', type: 'text',  placeholder: 'Warung Teh Risma' },
      { key: 'storeTagline',     label: 'Tagline',         type: 'text',     placeholder: 'Camilan khas rumahan...' },
      { key: 'storeDescription', label: 'Deskripsi Toko',  type: 'textarea', placeholder: 'Tentang toko Anda...' },
      { key: 'ownerName',        label: 'Nama Pemilik',    type: 'text',     placeholder: 'Nama pemilik untuk tanda tangan PDF' },
      { key: 'address',          label: 'Alamat',          type: 'text',     placeholder: 'Jl. ...' },
      { key: 'city',             label: 'Kota',            type: 'text',     placeholder: 'Kota / Kabupaten' },
    ],
  },
  {
    id: 'contact', icon: <Phone size={15}/>, label: 'Kontak & Sosial Media',
    fields: [
      { key: 'whatsapp',      label: 'WhatsApp',   type: 'text', placeholder: '628xxx' },
      { key: 'instagramUrl',  label: 'Instagram',  type: 'text', placeholder: 'https://instagram.com/...' },
      { key: 'tiktokUrl',     label: 'TikTok',     type: 'text', placeholder: 'https://tiktok.com/...' },
      { key: 'shopeeUrl',     label: 'Shopee',     type: 'text', placeholder: 'https://shopee.co.id/...' },
      { key: 'mapsUrl',       label: 'Google Maps', type: 'text', placeholder: 'https://maps.app.goo.gl/...' },
    ],
  },
  {
    id: 'payment', icon: <Wallet size={15}/>, label: 'Rekening Pembayaran',
    fields: [
      { key: 'storeBankName',           label: 'Nama Bank',              type: 'text', placeholder: 'BCA' },
      { key: 'storeBankAccountNumber',  label: 'Nomor Rekening',         type: 'text', placeholder: '1234567890' },
      { key: 'storeBankAccountHolder',  label: 'Nama Pemilik Rekening',  type: 'text', placeholder: 'Nama sesuai buku tabungan' },
    ],
  },
  {
    id: 'operational', icon: <Clock size={15}/>, label: 'Operasional & Reseller',
    fields: [
      { key: 'openHours',         label: 'Jam Buka',              type: 'text',   placeholder: 'Senin–Sabtu 08.00–17.00' },
      { key: 'minOrderWhatsapp',  label: 'Min. Order WhatsApp',   type: 'text',   placeholder: 'Rp 50.000' },
      { key: 'freeShippingMin',   label: 'Min. Gratis Ongkir (Rp)', type: 'number', placeholder: '100000' },
      { key: 'resellerDiscount',  label: 'Diskon Reseller (%)',   type: 'number', placeholder: '10' },
      { key: 'announcementBanner',label: 'Banner Pengumuman',     type: 'text',   placeholder: 'Promo spesial...' },
    ],
  },
  {
    id: 'legal', icon: <Shield size={15}/>, label: 'Kebijakan & Ketentuan',
    fields: [
      { key: 'privacyPolicy',  label: 'Kebijakan Privasi', type: 'textarea', placeholder: 'Isi kebijakan privasi...' },
      { key: 'termsOfService', label: 'Syarat & Ketentuan', type: 'textarea', placeholder: 'Isi syarat & ketentuan...' },
      { key: 'returnPolicy',   label: 'Kebijakan Pengembalian', type: 'textarea', placeholder: 'Isi kebijakan retur...' },
    ],
  },
  {
    id: 'branding', icon: <Palette size={15}/>, label: 'Tampilan & Tema',
    fields: [
      { key: 'storefrontThemeColor',           label: 'Warna Tema Toko (Storefront)', type: 'color', placeholder: '' },
      { key: 'storefrontThemeBackgroundColor', label: 'Warna Latar Toko (Storefront)', type: 'color', placeholder: '' },
      { key: 'adminAppName',                   label: 'Nama Aplikasi Admin',           type: 'text',  placeholder: 'Admin Teh Risma' },
      { key: 'adminThemeColor',                label: 'Warna Tema Admin',              type: 'color', placeholder: '' },
      { key: 'adminThemeBackgroundColor',       label: 'Warna Latar Admin',             type: 'color', placeholder: '' },
    ],
  },
  {
    id: 'sync', icon: <Database size={15}/>, label: 'Sinkronisasi Data',
    fields: [],
  },
];

export default function SettingsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [settings,  setSettings]  = useState<StoreSettings>({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [activeGrp, setActiveGrp] = useState('store');
  const [banks,        setBanks]        = useState<MasterBank[] | null>(null);
  const [bankSearch,    setBankSearch]  = useState('');
  const [bankView, setBankView] = useViewMode('master-banks');
  const [bankPage, setBankPage] = useState(1);
  const [bankPageSize, setBankPageSize] = useState(10);
  const [selectedBanks, setSelectedBanks] = useState<Set<string>>(new Set());
  const [bulkDeletingBanks, setBulkDeletingBanks] = useState(false);
  const [syncingBanks, setSyncingBanks] = useState(false);
  const [bankModal, setBankModal] = useState<BankForm | null>(null);
  const [savingBank, setSavingBank] = useState(false);
  const [bankError, setBankError] = useState('');
  const [deletingBankCode, setDeletingBankCode] = useState<string | null>(null);
  const [bankLogoUploading, setBankLogoUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [stampUploading, setStampUploading] = useState(false);
  const [qrisUploading, setQrisUploading] = useState(false);
  const [warehouses, setWarehouses] = useState<SettingsWarehouse[]>([]);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/api/settings`, { headers });
      if (r.ok) { const { settings: s } = await r.json() as { settings: StoreSettings }; setSettings(s ?? {}); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/api/warehouses`, { headers });
      if (r.ok) setWarehouses((await r.json() as { warehouses: SettingsWarehouse[] }).warehouses);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBanks = async () => {
    const r = await fetch(`${API}/api/master-banks`, { headers });
    if (r.ok) { const { banks: b } = await r.json() as { banks: MasterBank[] }; setBanks(b); }
  };
  useEffect(() => { loadBanks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncBanks = async () => {
    setSyncingBanks(true);
    const r = await fetch(`${API}/api/master-banks/sync`, { method: 'POST', headers });
    if (r.ok) {
      const d = await r.json() as { synced: number; total: number };
      await loadBanks();
      toast.success(d.synced > 0 ? `${d.synced} bank baru disinkronkan (${d.total} total tersedia).` : 'Semua data bank sudah tersinkron.');
    } else {
      toast.error('Gagal menyinkronkan data bank.');
    }
    setSyncingBanks(false);
  };

  const filteredBanks = (banks ?? []).filter(b => {
    const q = bankSearch.trim().toLowerCase();
    if (!q) return true;
    return b.name.toLowerCase().includes(q) || (b.bankCode ?? '').toLowerCase().includes(q);
  });
  const bankTotalPages = Math.max(1, Math.ceil(filteredBanks.length / bankPageSize));
  const bankSafePage   = Math.min(bankPage, bankTotalPages);
  const paginatedBanks = filteredBanks.slice((bankSafePage - 1) * bankPageSize, bankSafePage * bankPageSize);
  const goBankPage     = (p: number) => setBankPage(Math.max(1, Math.min(p, bankTotalPages)));
  const resetBankPage  = () => setBankPage(1);

  const toggleBankSelect = (code: string) =>
    setSelectedBanks(s => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });

  const toggleBankPageAll = () => {
    const pageCodes    = paginatedBanks.map(b => b.code);
    const allSelected  = pageCodes.length > 0 && pageCodes.every(c => selectedBanks.has(c));
    setSelectedBanks(s => {
      const n = new Set(s);
      if (allSelected) pageCodes.forEach(c => n.delete(c));
      else             pageCodes.forEach(c => n.add(c));
      return n;
    });
  };

  const bulkDeleteBanks = async () => {
    if (selectedBanks.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedBanks.size} bank yang dipilih dari master data? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeletingBanks(true);
    const r = await fetch(`${API}/api/master-banks/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: [...selectedBanks] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number };
      await loadBanks();
      setSelectedBanks(new Set());
      toast.success(`${d.deleted} bank berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus bank yang dipilih.');
    }
    setBulkDeletingBanks(false);
  };

  const openNewBank = () => { setBankModal(emptyBankForm()); setBankError(''); };
  const openEditBank = (b: MasterBank) => { setBankModal({ code: b.code, name: b.name, bankCode: b.bankCode ?? '', ewallet: b.ewallet, logoUrl: b.logoUrl ?? '' }); setBankError(''); };
  const closeBankModal = () => { setBankModal(null); setBankError(''); };

  const uploadBankLogo = async (file?: File) => {
    if (!file || !bankModal) return;
    setBankLogoUploading(true);
    try {
      const compressed = await compressLogo(file);
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers: { 'x-admin-auth': creds }, body: form });
      if (!r.ok) throw new Error('upload failed');
      const { url } = await r.json() as { url: string };
      setBankModal(m => m ? { ...m, logoUrl: url } : m);
    } catch {
      toast.error('Gagal mengunggah logo bank.');
    } finally {
      setBankLogoUploading(false);
    }
  };

  const saveBank = async () => {
    if (!bankModal) return;
    if (!bankModal.name.trim()) { setBankError('Nama bank wajib diisi.'); return; }
    setSavingBank(true); setBankError('');
    const payload = { name: bankModal.name.trim(), bankCode: bankModal.bankCode.trim(), ewallet: bankModal.ewallet, logoUrl: bankModal.logoUrl.trim() };
    const r = bankModal.code === null
      ? await fetch(`${API}/api/master-banks`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/master-banks/${bankModal.code}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) {
      await loadBanks();
      closeBankModal();
      toast.success(bankModal.code === null ? 'Bank berhasil ditambahkan.' : 'Bank berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setBankError(d.error ?? 'Gagal menyimpan bank.');
      toast.error(d.error ?? 'Gagal menyimpan bank.');
    }
    setSavingBank(false);
  };

  const deleteBank = async (b: MasterBank) => {
    if (!await confirm({ message: `Hapus bank "${b.name}" dari master data? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingBankCode(b.code);
    const r = await fetch(`${API}/api/master-banks/${b.code}`, { method: 'DELETE', headers });
    if (r.ok) {
      await loadBanks();
      toast.success(`Bank "${b.name}" berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus bank.');
    }
    setDeletingBankCode(null);
  };

  const save = async () => {
    setSaving(true);
    const r = await fetch(`${API}/api/settings`, {
      method: 'PUT', headers,
      body: JSON.stringify(settings),
    });
    setSaving(false);
    if (r.ok) {
      setSaved(true);
      toast.success('Pengaturan berhasil disimpan.');
      setTimeout(() => setSaved(false), 2500);
    } else {
      toast.error('Gagal menyimpan pengaturan.');
    }
  };

  const set = (key: string, val: string | number | boolean) =>
    setSettings(s => ({ ...s, [key]: val }));

  // keepAlpha (PNG) untuk ttd/cap supaya latar tetap transparan saat ditumpuk di PDF.
  const compressImage = async (file: File, maxPx: number, keepAlpha: boolean): Promise<File> => {
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const type = keepAlpha ? 'image/png' : 'image/jpeg';
    const ext  = keepAlpha ? '.png' : '.jpg';
    return new Promise(resolve =>
      canvas.toBlob(
        blob => resolve(new File([blob!], file.name.replace(/\.\w+$/, ext), { type })),
        type, keepAlpha ? undefined : 0.82,
      ),
    );
  };
  const compressLogo = (file: File) => compressImage(file, 1200, false);

  const uploadImage = async (
    file: File | undefined,
    key: 'logo' | 'ownerSignature' | 'ownerStamp' | 'storeQrisImageUrl',
    compress: (f: File) => Promise<File>,
    setUploading: (v: boolean) => void,
    errorLabel: string,
  ) => {
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compress(file);
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers: { 'x-admin-auth': creds }, body: form });
      if (!r.ok) throw new Error('upload failed');
      const { url } = await r.json() as { url: string };
      set(key, url);
    } catch {
      toast.error(`Gagal mengunggah ${errorLabel}.`);
    } finally {
      setUploading(false);
    }
  };

  const uploadLogo      = (file?: File) => uploadImage(file, 'logo', compressLogo, setLogoUploading, 'logo');
  const uploadSignature = (file?: File) => uploadImage(file, 'ownerSignature', f => compressImage(f, 800, true), setSignatureUploading, 'tanda tangan');
  const uploadStamp     = (file?: File) => uploadImage(file, 'ownerStamp', f => compressImage(f, 800, true), setStampUploading, 'cap/stempel');
  const uploadQris      = (file?: File) => uploadImage(file, 'storeQrisImageUrl', compressLogo, setQrisUploading, 'QRIS');

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  const activeGroup = FIELD_GROUPS.find(g => g.id === activeGrp)!;

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>

      {/* Sub-navigation */}
      <ScrollChips
        className="flex-shrink-0 px-4 pt-3.5 pb-3"
        style={{ borderBottom: '1px solid var(--border-2)' }}
      >
        {FIELD_GROUPS.map(g => (
          <button
            key={g.id}
            onClick={() => setActiveGrp(g.id)}
            className={`tab-chip${activeGrp === g.id ? ' active' : ''}`}
          >
            {g.icon}{g.label}
          </button>
        ))}
      </ScrollChips>

      {/* Content */}
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 space-y-5">

          <div className="card p-5">
            <div className="flex items-center gap-2.5 mb-5" style={{ borderBottom: '1px solid var(--border-2)', paddingBottom: '1rem' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                {activeGroup.icon}
              </div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{activeGroup.label}</p>
            </div>

            {activeGrp === 'sync' ? (
              <div className="space-y-3">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Daftar bank &amp; e-wallet yang muncul di dropdown pilihan bank (mis. form Dompet, Reseller, Biaya Admin).
                  Tombol &quot;Sinkronkan&quot; menambahkan/memperbarui daftar bank bawaan tanpa menghapus bank custom yang sudah ditambahkan.
                </p>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="relative flex-1" style={{ minWidth: 200 }}>
                    <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      value={bankSearch}
                      onChange={e => { setBankSearch(e.target.value); resetBankPage(); }}
                      placeholder="Cari nama atau kode bank…"
                      className="input"
                      style={{ paddingLeft: 30, fontSize: 12.5, height: 34 }}
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <ViewToggle mode={bankView} onChange={setBankView} height={34} />
                    <button onClick={syncBanks} disabled={syncingBanks} className="btn-ghost text-xs" style={{ height: 34 }}>
                      {syncingBanks ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      {syncingBanks ? 'Menyinkronkan…' : 'Sinkronkan'}
                    </button>
                    <button onClick={openNewBank} className="btn-primary text-xs" style={{ height: 34 }}>
                      <Plus size={13} /> Tambah Bank
                    </button>
                  </div>
                </div>

                {banks === null ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  </div>
                ) : filteredBanks.length === 0 ? (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>
                    {banks.length === 0 ? 'Belum ada data bank — klik "Sinkronkan" untuk memuat daftar bawaan.' : 'Tidak ada bank yang cocok dengan pencarian.'}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ border: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                      <Checkbox
                        checked={paginatedBanks.length > 0 && paginatedBanks.every(b => selectedBanks.has(b.code))}
                        indeterminate={paginatedBanks.some(b => selectedBanks.has(b.code)) && !paginatedBanks.every(b => selectedBanks.has(b.code))}
                        onChange={toggleBankPageAll}
                      />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {selectedBanks.size > 0 ? `${selectedBanks.size} dipilih` : `${paginatedBanks.length} bank di halaman ini`}
                      </span>
                    </div>

                    {bankView === 'table' ? (
                      <div className="space-y-1.5">
                        {paginatedBanks.map(b => (
                          <div key={b.code} className="flex items-center gap-3 p-3 rounded-xl"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
                            <Checkbox checked={selectedBanks.has(b.code)} onChange={() => toggleBankSelect(b.code)} />
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <BankLogo bank={b} size={36} />
                              <div className="min-w-0">
                                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{b.name}</p>
                                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                  {b.ewallet ? 'E-Wallet' : `Kode kliring: ${b.bankCode || '–'}`}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => openEditBank(b)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                                <Pencil size={14} />
                              </button>
                              <button onClick={() => deleteBank(b)} disabled={deletingBankCode === b.code} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                                {deletingBankCode === b.code ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {paginatedBanks.map(b => (
                          <div key={b.code} className="rounded-xl overflow-hidden relative"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
                            <div className="absolute top-2 left-2 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                              <Checkbox checked={selectedBanks.has(b.code)} onChange={() => toggleBankSelect(b.code)} />
                            </div>
                            <div className="pt-5 pb-3 px-3 flex flex-col items-center text-center gap-1.5">
                              <BankLogo bank={b} size={48} />
                              <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{b.name}</p>
                              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                {b.ewallet ? 'E-Wallet' : `Kode: ${b.bankCode || '–'}`}
                              </p>
                            </div>
                            <div className="flex items-center justify-center gap-1 px-3 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                              <button onClick={() => openEditBank(b)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                                <Pencil size={12} />
                              </button>
                              <button onClick={() => deleteBank(b)} disabled={deletingBankCode === b.code} className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }}>
                                {deletingBankCode === b.code ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {filteredBanks.length} bank · halaman {bankSafePage} dari {bankTotalPages}
                        </p>
                        <PageSizeSelect value={bankPageSize} onChange={n => { setBankPageSize(n); resetBankPage(); }} />
                      </div>
                      {bankTotalPages > 1 && (
                        <div className="flex items-center gap-1">
                          <Tooltip label="Halaman sebelumnya">
                            <button onClick={() => goBankPage(bankSafePage - 1)} disabled={bankSafePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                              <ChevronLeft size={14} />
                            </button>
                          </Tooltip>
                          {Array.from({ length: bankTotalPages }, (_, i) => i + 1)
                            .filter(n => n === 1 || n === bankTotalPages || Math.abs(n - bankSafePage) <= 1)
                            .reduce<(number | '…')[]>((acc, n, i, arr) => {
                              if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                              acc.push(n); return acc;
                            }, [])
                            .map((n, i) =>
                              n === '…'
                                ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                                : <button key={n} onClick={() => goBankPage(n as number)}
                                    className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                                    style={bankSafePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                                    {n}
                                  </button>
                            )
                          }
                          <Tooltip label="Halaman berikutnya">
                            <button onClick={() => goBankPage(bankSafePage + 1)} disabled={bankSafePage === bankTotalPages} className="btn-ghost p-2 disabled:opacity-30">
                              <ChevronRight size={14} />
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
            <div className="space-y-4">
              {activeGrp === 'store' && (
                <div className="flex items-center gap-4 p-3.5 rounded-2xl" style={{ border: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                  <ImageUploadBox
                    src={settings.logo}
                    alt="Logo toko"
                    uploading={logoUploading}
                    onSelect={f => uploadLogo(f)}
                    onRemove={() => set('logo', '')}
                    fit="contain"
                    size={96}
                    emptyText="Upload Logo"
                    editable
                    editAspect={1}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Logo Toko</p>
                    <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Tampil di struk cetak kasir. Sebaiknya gambar persegi & latar polos. Bisa di-crop & zoom setelah upload.
                    </p>
                  </div>
                </div>
              )}
              {activeGrp === 'store' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center gap-3 p-3.5 rounded-2xl" style={{ border: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                    <ImageUploadBox
                      src={settings.ownerSignature}
                      alt="Tanda tangan pemilik"
                      uploading={signatureUploading}
                      onSelect={f => uploadSignature(f)}
                      onRemove={() => set('ownerSignature', '')}
                      fit="contain"
                      size={72}
                      emptyText="Upload"
                      editable
                      editAspect={2}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Tanda Tangan Elektronik</p>
                      <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        Foto/scan tanda tangan pemilik, latar transparan (PNG) lebih rapi.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3.5 rounded-2xl" style={{ border: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                    <ImageUploadBox
                      src={settings.ownerStamp}
                      alt="Cap toko"
                      uploading={stampUploading}
                      onSelect={f => uploadStamp(f)}
                      onRemove={() => set('ownerStamp', '')}
                      fit="contain"
                      size={72}
                      emptyText="Upload"
                      editable
                      editAspect={1}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Cap / Stempel Elektronik</p>
                      <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        Foto cap/stempel toko, latar transparan (PNG) lebih rapi.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {activeGrp === 'operational' && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <Warehouse size={12} /> Gudang untuk Kasir
                  </label>
                  <SearchSelect value={settings.posWarehouseId ?? ''}
                    onChange={id => {
                      const w = warehouses.find(x => x.id === id);
                      setSettings(s => ({ ...s, posWarehouseId: id, posWarehouseName: w?.name ?? '' }));
                    }}
                    options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                    placeholder="– Pilih Gudang –" searchPlaceholder="Cari gudang…" />
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    Setiap transaksi kasir akan mengurangi stok gudang ini juga (selain stok toko). Kosongkan kalau kasir belum diambil dari gudang tertentu.
                  </p>
                </div>
              )}
              {activeGrp === 'payment' && (
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Gambar QRIS
                  </label>
                  <ImageUploadBox
                    src={settings.storeQrisImageUrl}
                    alt="QRIS toko"
                    uploading={qrisUploading}
                    onSelect={f => uploadQris(f)}
                    onRemove={() => set('storeQrisImageUrl', '')}
                    fit="contain"
                    size={140}
                    emptyText="Upload QRIS"
                  />
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    Ditampilkan ke customer di halaman pembayaran checkout online.
                  </p>
                </div>
              )}
              {activeGroup.fields.map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {f.label}
                  </label>
                  {f.key === 'storeBankName' ? (
                    <SearchSelect
                      value={(settings.storeBankName as string) ?? ''}
                      onChange={v => set('storeBankName', v)}
                      options={(banks ?? []).map(b => ({ value: b.name, label: b.name, sublabel: b.bankCode ? `Kode: ${b.bankCode}` : undefined, imageUrl: b.logoUrl }))}
                      placeholder="– Pilih Bank –"
                      searchPlaceholder="Cari bank…"
                    />
                  ) : f.type === 'textarea' ? (
                    <textarea
                      rows={4}
                      placeholder={f.placeholder}
                      value={(settings as Record<string, string>)[f.key] ?? ''}
                      onChange={e => set(f.key, e.target.value)}
                      className="input w-full text-sm resize-none"
                    />
                  ) : f.type === 'color' ? (
                    <ColorPicker
                      value={(settings as Record<string, string>)[f.key] ?? ''}
                      onChange={c => set(f.key, c)}
                    />
                  ) : (
                    <input
                      type={f.type}
                      min={f.type === 'number' ? 0 : undefined}
                      placeholder={f.placeholder}
                      value={(settings as Record<string, string | number>)[f.key] ?? ''}
                      // Math.max(0, ...) — min="0" tidak mencegah user mengetik tanda minus
                      // langsung; kedua field number di sini (Min. Gratis Ongkir, Diskon
                      // Reseller) tidak masuk akal bernilai negatif.
                      onChange={e => set(f.key, f.type === 'number' ? Math.max(0, Number(e.target.value) || 0) : e.target.value)}
                      className="input w-full text-sm"
                    />
                  )}
                </div>
              ))}

              {/* Announcement toggle — only in operational group */}
              {activeGrp === 'operational' && (
                <div className="flex items-center justify-between pt-2">
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Aktifkan Banner Pengumuman</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Tampilkan banner di halaman utama toko</p>
                  </div>
                  <button
                    onClick={() => set('announcementActive', !settings.announcementActive)}
                    className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
                    style={{ background: settings.announcementActive ? 'var(--accent)' : 'var(--border)' }}
                  >
                    <span
                      className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                      style={{ transform: settings.announcementActive ? 'translateX(20px)' : 'translateX(2px)' }}
                    />
                  </button>
                </div>
              )}
            </div>
            )}

            <div className="flex justify-end pt-4 mt-1" style={{ borderTop: '1px solid var(--border-2)' }}>
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 text-sm"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
                {saved ? 'Tersimpan' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk action bar — master bank */}
      {activeGrp === 'sync' && selectedBanks.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedBanks.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={bulkDeleteBanks} disabled={bulkDeletingBanks}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkDeletingBanks ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setSelectedBanks(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit master bank modal */}
      {bankModal && (
        <div className="modal-overlay" onClick={closeBankModal}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Landmark size={17} /></div>
                <div>
                  <p className="modal-title">{bankModal.code === null ? 'Tambah Bank' : 'Edit Bank'}</p>
                  <p className="modal-subtitle">{bankModal.code === null ? 'Tambah bank/e-wallet baru ke master data' : `Edit: ${bankModal.name}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeBankModal} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="flex items-center gap-3">
                  <ImageUploadBox
                    src={bankModal.logoUrl}
                    alt={bankModal.name || 'Logo bank'}
                    uploading={bankLogoUploading}
                    onSelect={f => uploadBankLogo(f)}
                    onRemove={() => setBankModal({ ...bankModal, logoUrl: '' })}
                    icon={<Landmark size={18} />}
                    fit="contain"
                    size={56}
                    emptyText="Logo"
                  />
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Nama Bank / E-Wallet <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input value={bankModal.name} onChange={e => setBankModal({ ...bankModal, name: e.target.value })}
                      className="input" placeholder="cth: Bank ABC, DanaKu" autoFocus />
                  </div>
                </div>

                <div>
                  <label className="field-label">Kode Kliring (opsional)</label>
                  <input value={bankModal.bankCode} onChange={e => setBankModal({ ...bankModal, bankCode: e.target.value })}
                    className="input" placeholder="cth: 014" />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>E-Wallet</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Dompet digital tanpa kode kliring baku</p>
                  </div>
                  <button
                    onClick={() => setBankModal({ ...bankModal, ewallet: !bankModal.ewallet })}
                    className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
                    style={{ background: bankModal.ewallet ? 'var(--accent)' : 'var(--border)' }}
                  >
                    <span
                      className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                      style={{ transform: bankModal.ewallet ? 'translateX(20px)' : 'translateX(2px)' }}
                    />
                  </button>
                </div>

                {bankError && (
                  <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {bankError}
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeBankModal} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={saveBank} disabled={savingBank} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingBank ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {savingBank ? 'Menyimpan…' : 'Simpan Bank'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
