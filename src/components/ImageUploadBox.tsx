'use client';

import { CSSProperties, ReactNode, useState } from 'react';
import { Loader2, Image as ImageIcon, Pencil, X, Crop } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import ImageEditModal from '@/components/ImageEditModal';

interface ImageUploadBoxProps {
  src?: string;
  alt: string;
  uploading?: boolean;
  onSelect: (file: File) => void;
  onRemove?: () => void;
  onView?: () => void;
  accept?: string;
  capture?: 'environment';
  aspect?: string;
  fit?: 'contain' | 'cover';
  icon?: ReactNode;
  emptyText?: string;
  changeText?: string;
  size?: number;
  className?: string;
  /** Buka editor crop/zoom/putar sebelum file diunggah, dan tampilkan tombol "Edit" untuk mengedit ulang foto yang sudah ada. */
  editable?: boolean;
  /** Rasio lebar/tinggi area crop di editor. Default mengikuti `aspect` (mis. "1 / 1" → 1). */
  editAspect?: number;
}

function parseAspect(aspect: string, fallback?: number): number {
  if (fallback) return fallback;
  const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(aspect);
  return m ? Number(m[1]) / Number(m[2]) : 1;
}

function IconAction({ label, onClick, tone = 'default', children }: {
  label: string; onClick?: () => void; tone?: 'default' | 'danger'; children: ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button" onClick={onClick}
        className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/25"
        style={{
          background: 'rgba(255,255,255,0.14)',
          border: '1px solid rgba(255,255,255,0.28)',
          color: tone === 'danger' ? '#FCA5A5' : '#fff',
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export default function ImageUploadBox({
  src, alt, uploading = false, onSelect, onRemove, onView,
  accept = 'image/*', capture, aspect = '1 / 1', fit = 'cover',
  icon, emptyText = 'Upload', changeText = 'Ganti',
  size, className = '', editable = false, editAspect,
}: ImageUploadBoxProps) {
  const boxStyle: CSSProperties = size ? { width: size, height: size } : { width: '100%', aspectRatio: aspect };
  const [dragOver, setDragOver] = useState(false);
  const [editSrc, setEditSrc] = useState<string | null>(null);
  const showBadge = !size || size >= 72;

  const handleFile = (f: File) => {
    if (editable) setEditSrc(URL.createObjectURL(f));
    else onSelect(f);
  };

  const input = (
    <input
      type="file" accept={accept} capture={capture} className="hidden" disabled={uploading}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f); }}
    />
  );

  const dragHandlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!uploading) setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDragOver(false);
      if (uploading) return;
      const f = e.dataTransfer.files?.[0];
      if (f && f.type.startsWith('image/')) handleFile(f);
    },
  };

  const editModal = editSrc && (
    <ImageEditModal
      src={editSrc}
      aspect={parseAspect(aspect, editAspect)}
      title={`Edit ${alt}`}
      onCancel={() => { URL.revokeObjectURL(editSrc); setEditSrc(null); }}
      onConfirm={file => { URL.revokeObjectURL(editSrc); setEditSrc(null); onSelect(file); }}
    />
  );

  if (!src) {
    return (
      <>
        <label
          className={`relative flex flex-col items-center justify-center gap-1.5 rounded-2xl flex-shrink-0 cursor-pointer transition-all duration-150 ${className}`}
          style={{
            ...boxStyle,
            border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
            background: dragOver ? 'var(--accent-bg)' : 'var(--surface-2)',
            color: dragOver ? 'var(--accent)' : 'var(--text-muted)',
            opacity: uploading ? 0.6 : 1,
            transform: dragOver ? 'scale(1.015)' : 'scale(1)',
          }}
          {...dragHandlers}
        >
          {input}
          {showBadge ? (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
              style={{ background: dragOver ? 'var(--accent)' : 'var(--accent-bg)', color: dragOver ? '#fff' : 'var(--accent)' }}
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : (icon ?? <ImageIcon size={16} />)}
            </div>
          ) : (
            uploading ? <Loader2 size={16} className="animate-spin" /> : (icon ?? <ImageIcon size={16} />)
          )}
          <span className="text-[11px] font-semibold text-center px-1.5 leading-tight">{uploading ? 'Mengunggah…' : emptyText}</span>
        </label>
        {editModal}
      </>
    );
  }

  return (
    <>
      <div
        className={`relative rounded-2xl overflow-hidden flex-shrink-0 group ${className}`}
        style={{ ...boxStyle, border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', background: 'var(--surface-2)' }}
        {...dragHandlers}
      >
        {onView ? (
          <button type="button" onClick={onView} className="absolute inset-0 w-full h-full" style={{ border: 'none', padding: 0, cursor: 'pointer' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="w-full h-full" style={{ objectFit: fit }} />
          </button>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="w-full h-full" style={{ objectFit: fit }} />
        )}

        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <Loader2 size={18} className="animate-spin" style={{ color: '#fff' }} />
          </div>
        )}

        {dragOver && !uploading && (
          <div className="absolute inset-0 flex items-center justify-center text-center px-1" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <span className="text-[11px] font-semibold" style={{ color: '#fff' }}>Lepas untuk ganti</span>
          </div>
        )}

        {!uploading && !dragOver && (
          <div
            className="absolute inset-0 flex items-end justify-center pb-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.5) 100%)' }}
          >
            <div
              className="flex items-center gap-1 p-1 rounded-full"
              style={{ background: 'rgba(20,20,20,0.35)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            >
              {editable && (
                <IconAction label="Edit foto" onClick={() => setEditSrc(src)}>
                  <Crop size={12} />
                </IconAction>
              )}
              <Tooltip label={changeText}>
                <label
                  className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-colors hover:bg-white/25"
                  style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.28)', color: '#fff' }}
                >
                  {input}
                  <Pencil size={12} />
                </label>
              </Tooltip>
              {onRemove && (
                <IconAction label="Hapus" tone="danger" onClick={onRemove}>
                  <X size={12} />
                </IconAction>
              )}
            </div>
          </div>
        )}
      </div>
      {editModal}
    </>
  );
}
