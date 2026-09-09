'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

// Palet kurasi untuk badge warna dompet — cukup beragam untuk membedakan banyak dompet
// sekilas, tanpa membuka color-picker bebas yang bisa menghasilkan warna sulit dibaca.
export const COLOR_SWATCHES = [
  '#16A34A', '#DC2626', '#EA580C', '#D97706', '#CA8A04',
  '#65A30D', '#16A34A', '#059669', '#0D9488', '#0891B2',
  '#2563EB', '#4F46E5', '#7C3AED', '#9333EA', '#C026D3',
  '#DB2777', '#71717A', '#374151',
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  size?: number;
}

export default function ColorPicker({ value, onChange, size = 44 }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWidth = 216;
  const current = value || COLOR_SWATCHES[0];

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      let left = r.left;
      if (left + panelWidth > window.innerWidth - 12) left = Math.max(12, window.innerWidth - panelWidth - 12);
      let top = r.bottom + 6;
      if (top + 200 > window.innerHeight - 12) top = Math.max(12, r.top - 200 - 6);
      setPos({ top, left });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        style={{
          width: size, height: size, flexShrink: 0, boxSizing: 'border-box',
          borderRadius: 12, border: '1.5px solid var(--border)',
          background: current, cursor: 'pointer', transition: 'box-shadow 0.15s',
          boxShadow: open ? '0 0 0 3px rgba(212,105,30,0.12)' : undefined,
        }}
      />
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: panelWidth,
            zIndex: 10000, background: 'var(--surface)', border: '1.5px solid var(--border)',
            borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.22)', padding: 12,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
            {COLOR_SWATCHES.map(hex => {
              const active = hex.toLowerCase() === value?.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onClick={() => { onChange(hex); setOpen(false); }}
                  style={{
                    width: 26, height: 26, borderRadius: 8, background: hex,
                    border: active ? '2px solid var(--text-primary)' : '2px solid transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {active && <Check size={13} color="#fff" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
