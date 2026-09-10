'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RotateCw, Check, X, Crop as CropIcon, Minus, Plus, RefreshCcw } from 'lucide-react';

interface ImageEditModalProps {
  /** URL/objectURL/dataURL gambar sumber. Boleh gambar remote (butuh CORS) atau blob lokal. */
  src: string;
  /** Rasio lebar/tinggi area crop, mis. 1 = persegi. */
  aspect?: number;
  title?: string;
  /** Lebar output dalam px (tinggi mengikuti aspect). */
  outputSize?: number;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

const VIEWPORT_W = 360;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed'));
    img.src = src;
  });
}

export default function ImageEditModal({
  src, aspect = 1, title = 'Edit Foto', outputSize = 1000, onCancel, onConfirm,
}: ImageEditModalProps) {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [working, setWorking] = useState<{ src: string; w: number; h: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const vw = VIEWPORT_W;
  const vh = Math.round(VIEWPORT_W / aspect);

  useEffect(() => {
    let cancelled = false;
    loadImage(src)
      .then(img => { if (!cancelled) setWorking({ src, w: img.naturalWidth, h: img.naturalHeight }); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [src]);

  const baseScale = working ? Math.max(vw / working.w, vh / working.h) : 1;
  const scale = baseScale * zoom;
  const dispW = working ? working.w * scale : 0;
  const dispH = working ? working.h * scale : 0;
  const maxOffX = Math.max(0, (dispW - vw) / 2);
  const maxOffY = Math.max(0, (dispH - vh) / 2);
  const isDefault = zoom === 1 && offset.x === 0 && offset.y === 0;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({
      x: Math.min(maxOffX, Math.max(-maxOffX, dragRef.current.origX + dx)),
      y: Math.min(maxOffY, Math.max(-maxOffY, dragRef.current.origY + dy)),
    });
  };
  const onPointerUp = () => { dragRef.current = null; setDragging(false); };

  const handleZoom = (z: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (!working) { setZoom(clamped); return; }
    const s = baseScale * clamped;
    const mx = Math.max(0, (working.w * s - vw) / 2);
    const my = Math.max(0, (working.h * s - vh) / 2);
    setZoom(clamped);
    setOffset(o => ({ x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) }));
  };

  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };

  const rotate90 = async () => {
    if (!working) return;
    try {
      const img = await loadImage(working.src);
      const canvas = document.createElement('canvas');
      canvas.width = working.h;
      canvas.height = working.w;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -working.w / 2, -working.h / 2);
      setWorking({ src: canvas.toDataURL(), w: working.h, h: working.w });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    } catch {
      setError(true);
    }
  };

  const confirm = async () => {
    if (!working) return;
    setBusy(true);
    try {
      const img = await loadImage(working.src);
      const outW = outputSize;
      const outH = Math.round(outputSize / aspect);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;
      const sWidth = vw / scale;
      const sHeight = vh / scale;
      const sx = working.w / 2 - sWidth / 2 - offset.x / scale;
      const sy = working.h / 2 - sHeight / 2 - offset.y / scale;
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, outW, outH);
      canvas.toBlob(blob => {
        setBusy(false);
        if (!blob) { setError(true); return; }
        onConfirm(new File([blob], 'photo.png', { type: 'image/png' }));
      }, 'image/png');
    } catch {
      setBusy(false);
      setError(true);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><CropIcon size={16} /></div>
            <div>
              <p className="modal-title">{title}</p>
              <p className="modal-subtitle">Geser untuk atur posisi, lalu zoom & putar sesuai kebutuhan</p>
            </div>
          </div>
          <button onClick={onCancel} className="modal-close"><X size={14} /></button>
        </div>
        <div className="modal-body">
          {error ? (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              Gagal memuat gambar untuk diedit. Coba upload ulang foto.
            </p>
          ) : !working ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : (
            <>
              <div
                className="relative mx-auto overflow-hidden rounded-2xl touch-none select-none"
                style={{
                  width: vw, height: vh, background: '#0a0a0a',
                  cursor: dragging ? 'grabbing' : 'grab',
                  boxShadow: '0 0 0 1px var(--border), 0 12px 32px rgba(0,0,0,0.14)',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={working.src}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute', left: '50%', top: '50%',
                    width: dispW, height: dispH, maxWidth: 'none',
                    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  }}
                />
                {/* Grid bantu komposisi (rule of thirds) */}
                <div className="absolute inset-0 pointer-events-none">
                  {[1, 2].map(i => (
                    <span key={`v${i}`} style={{ position: 'absolute', left: `${(i * 100) / 3}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)' }} />
                  ))}
                  {[1, 2].map(i => (
                    <span key={`h${i}`} style={{ position: 'absolute', top: `${(i * 100) / 3}%`, left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.3)' }} />
                  ))}
                </div>
              </div>

              <div
                className="flex items-center gap-2.5 mt-4 px-2.5 py-2 rounded-full"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}
              >
                <button
                  type="button" onClick={() => handleZoom(zoom - 0.25)} disabled={zoom <= MIN_ZOOM}
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-colors"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  <Minus size={12} />
                </button>
                <input
                  type="range" className="range-slider" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom}
                  onChange={e => handleZoom(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <button
                  type="button" onClick={() => handleZoom(zoom + 0.25)} disabled={zoom >= MAX_ZOOM}
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-colors"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  <Plus size={12} />
                </button>
                <span className="text-[11px] font-semibold tabular flex-shrink-0" style={{ color: 'var(--text-muted)', width: 34, textAlign: 'right' }}>
                  {Math.round(zoom * 100)}%
                </span>
              </div>

              <div className="flex items-center justify-between mt-3">
                <button type="button" onClick={rotate90} className="btn-ghost text-xs">
                  <RotateCw size={13} /> Putar 90°
                </button>
                {!isDefault && (
                  <button type="button" onClick={reset} className="btn-ghost text-xs" style={{ color: 'var(--text-muted)' }}>
                    <RefreshCcw size={12} /> Reset
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onCancel} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Batal
          </button>
          <button onClick={confirm} disabled={!working || busy || error} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {busy ? 'Memproses…' : 'Terapkan'}
          </button>
        </div>
      </div>
    </div>
  );
}
