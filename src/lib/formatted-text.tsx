import type { ReactNode } from 'react';

// Subset markdown ringan untuk field teks bebas (deskripsi produk, dst) — **tebal**, _miring_,
// ~~coret~~, dan baris berawalan "- " sebagai bullet list. Disimpan sebagai teks biasa (bukan
// HTML) supaya tidak perlu sanitasi apa pun terhadap XSS: parser ini cuma menyusun elemen React
// dari potongan teks (tetap di-escape otomatis oleh React seperti children biasa), tidak pernah
// lewat dangerouslySetInnerHTML. Dipakai bareng toolbar Bold/Italic/Coret/List di form input
// (lihat ProductsTab.tsx) yang membungkus teks terpilih dengan simbol yang sama.

interface InlineSegment { type: 'text' | 'bold' | 'italic' | 'strike'; content: string }

const INLINE_REGEX = /\*\*(.+?)\*\*|~~(.+?)~~|_(.+?)_/g;

function parseInline(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_REGEX.lastIndex = 0;
  while ((match = INLINE_REGEX.exec(line))) {
    if (match.index > lastIndex) segments.push({ type: 'text', content: line.slice(lastIndex, match.index) });
    if (match[1] !== undefined) segments.push({ type: 'bold', content: match[1] });
    else if (match[2] !== undefined) segments.push({ type: 'strike', content: match[2] });
    else if (match[3] !== undefined) segments.push({ type: 'italic', content: match[3] });
    lastIndex = INLINE_REGEX.lastIndex;
  }
  if (lastIndex < line.length) segments.push({ type: 'text', content: line.slice(lastIndex) });
  return segments;
}

function renderInline(line: string, keyPrefix: string): ReactNode[] {
  return parseInline(line).map((seg, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (seg.type) {
      case 'bold': return <strong key={key}>{seg.content}</strong>;
      case 'italic': return <em key={key}>{seg.content}</em>;
      case 'strike': return <s key={key}>{seg.content}</s>;
      default: return <span key={key}>{seg.content}</span>;
    }
  });
}

const BULLET_RE = /^[-•]\s+(.*)/;

// Render teks dengan subset markdown di atas jadi elemen React siap tampil — dipakai langsung
// menggantikan `<p>{text}</p>` biasa di mana pun deskripsi produk ditampilkan.
export function FormattedText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} style={{ listStyle: 'disc', paddingLeft: 18, margin: 0 }}>
        {listBuffer.map((item, i) => <li key={i}>{renderInline(item, `li-${blocks.length}-${i}`)}</li>)}
      </ul>,
    );
    listBuffer = [];
  };

  lines.forEach((line, i) => {
    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1]);
      return;
    }
    flushList();
    blocks.push(
      <span key={`line-${i}`}>
        {renderInline(line, `line-${i}`)}
        {i < lines.length - 1 && <br />}
      </span>,
    );
  });
  flushList();

  // <div>, bukan <p> — bisa berisi <ul> (bullet list) sebagai child, yang tidak valid di dalam <p>.
  return <div className={className} style={style}>{blocks}</div>;
}

// Versi teks polos (tanpa elemen React) — dipakai di konteks yang tidak bisa render React (mis.
// export Excel), supaya simbol markdown (**, ~~, _, "- ") tidak ikut tampil apa adanya di sana.
export function stripFormatting(text: string): string {
  if (!text) return text;
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/^[-•]\s+/gm, '• ');
}
