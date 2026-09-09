'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { X, Download, RotateCcw, QrCode as QrCodeIcon, Loader2, Check } from 'lucide-react';
import { productUrl } from '@/lib/branding';
import { useToast } from '@/components/Toast';

interface Props {
  product: { id: string; name: string; qrUrl?: string };
  headers: Record<string, string>;
  onClose: () => void;
  onSaved: (id: string, qrUrl: string) => void;
}

export default function QRCodeModal({ product, headers, onClose, onSaved }: Props) {
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const defaultUrl = productUrl(product.id);
  const savedUrl = product.qrUrl?.trim() || '';
  const [url, setUrl] = useState(savedUrl || defaultUrl);
  const [saving, setSaving] = useState(false);

  const dirty = !savedUrl || url.trim() !== savedUrl;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url.trim()) return;
    QRCode.toCanvas(canvas, url.trim(), { width: 220, margin: 1, color: { dark: '#0A0A0A', light: '#ffffff' } }).catch(() => {});
  }, [url]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `qr-${product.id}.png`;
    a.click();
  };

  const save = async () => {
    const value = url.trim();
    if (!value) return;
    setSaving(true);
    const r = await fetch(`/api/products/${product.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrUrl: value }),
    });
    if (r.ok) {
      toast.success('QR Code berhasil disimpan.');
      onSaved(product.id, value);
      onClose();
    } else {
      toast.error('Gagal menyimpan QR Code.');
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />

        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><QrCodeIcon size={17} /></div>
            <div>
              <p className="modal-title">QR Code Produk</p>
              <p className="modal-subtitle">{product.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ padding: 12, borderRadius: 16, background: '#fff', border: '1px solid var(--border)' }}>
              <canvas ref={canvasRef} width={220} height={220} style={{ display: 'block', width: 220, height: 220 }} />
            </div>

            <div style={{ width: '100%' }}>
              <label className="field-label">Arah QR Code (URL)</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="input"
                placeholder={defaultUrl}
                style={{ fontSize: 12.5 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 }}>
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                  Default: link ke halaman detail produk di portal
                </p>
                {url.trim() !== defaultUrl && (
                  <button onClick={() => setUrl(defaultUrl)} type="button"
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    <RotateCcw size={11} /> Reset
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={download} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            <Download size={14} /> Unduh PNG
          </button>
          <button onClick={save} disabled={saving || !dirty || !url.trim()} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
