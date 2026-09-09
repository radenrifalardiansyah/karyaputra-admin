'use client';

import { CSSProperties, ReactNode } from 'react';
import { Loader2, Image as ImageIcon, Pencil, X } from 'lucide-react';
import Tooltip from '@/components/Tooltip';

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
}

export default function ImageUploadBox({
  src, alt, uploading = false, onSelect, onRemove, onView,
  accept = 'image/*', capture, aspect = '1 / 1', fit = 'cover',
  icon, emptyText = 'Upload', changeText = 'Ganti',
  size, className = '',
}: ImageUploadBoxProps) {
  const boxStyle: CSSProperties = size ? { width: size, height: size } : { width: '100%', aspectRatio: aspect };

  const input = (
    <input
      type="file" accept={accept} capture={capture} className="hidden" disabled={uploading}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onSelect(f); }}
    />
  );

  if (!src) {
    return (
      <label
        className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl flex-shrink-0 cursor-pointer transition-colors ${className}`}
        style={{ ...boxStyle, border: '1.5px dashed var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', opacity: uploading ? 0.6 : 1 }}
      >
        {input}
        {uploading ? <Loader2 size={18} className="animate-spin" /> : (icon ?? <ImageIcon size={18} />)}
        <span className="text-[11px] font-semibold text-center px-1.5 leading-tight">{uploading ? 'Mengunggah…' : emptyText}</span>
      </label>
    );
  }

  return (
    <div
      className={`relative rounded-xl overflow-hidden flex-shrink-0 group ${className}`}
      style={{ ...boxStyle, border: '1px solid var(--border)', background: 'var(--surface-2)' }}
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

      {!uploading && (
        <>
          <Tooltip label={changeText}>
            <label
              className="absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-opacity"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {input}
              <Pencil size={11} />
            </label>
          </Tooltip>
          {onRemove && (
            <Tooltip label="Hapus">
              <button
                type="button" onClick={onRemove}
                className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center transition-opacity"
                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
              >
                <X size={11} />
              </button>
            </Tooltip>
          )}
        </>
      )}
    </div>
  );
}
