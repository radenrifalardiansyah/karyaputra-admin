// Banner kategori (dan kolom media serupa lainnya) menyimpan URL Cloudinary, bukan Content-Type,
// jadi tipe media ditebak dari ekstensi file di URL.
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|og[gv])(\?|#|$)/i;

export function isVideoUrl(url?: string | null): boolean {
  return !!url && VIDEO_EXT_RE.test(url);
}
