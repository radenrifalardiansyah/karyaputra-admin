import { NextRequest } from 'next/server';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { uploadToCloudinary, cloudinaryConfigured } from '@/lib/cloudinary';

// Browser compresses before sending (max ~1200px, quality 0.82) so typical upload is 80–200 KB.
// 900 KB is a hard guard in case someone uploads without the client-side compress path.
const MAX_IMAGE_BYTES = 900_000;
// Video tidak dikompres di browser (butuh encoder, bukan cuma canvas), jadi batasnya jauh lebih
// longgar. 20 MB cukup untuk banner pendek (beberapa detik) tanpa bikin halaman toko berat.
const MAX_VIDEO_BYTES = 20_000_000;
// Margin di atas batas terbesar untuk overhead multipart (boundary, header tiap field) — dicek dari
// Content-Length SEBELUM body dibaca ke memori lewat req.formData(), supaya payload yang jelas
// kelewat besar ditolak tanpa perlu dibuffer penuh dulu. Content-Length dikontrol klien (bisa
// tidak akurat/absen), jadi ini pemeriksaan awal murah, bukan pengganti cek buffer.byteLength di
// bawah yang tetap jadi batas sebenarnya (yang baru bisa tahu tipe file setelah form-data dibaca).
const MAX_BODY_BYTES = MAX_VIDEO_BYTES + 50_000;

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();

  if (!cloudinaryConfigured()) {
    return Response.json(
      { error: 'Cloudinary belum dikonfigurasi. Tambahkan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, dan CLOUDINARY_API_SECRET ke environment variables.' },
      { status: 500 },
    );
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: `Payload terlalu besar (${(contentLength / 1024 / 1024).toFixed(1)} MB). Maks ${MAX_VIDEO_BYTES / 1_000_000} MB untuk video, 900 KB untuk gambar.` },
      { status: 413 },
    );
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return Response.json({ error: 'No file' }, { status: 400 });
  const isVideo = file.type.startsWith('video/');
  if (!file.type || (!file.type.startsWith('image/') && !isVideo)) {
    return Response.json({ error: 'Hanya file gambar atau video yang bisa diunggah.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  if (buffer.byteLength > maxBytes) {
    return Response.json(
      {
        error: isVideo
          ? `Video terlalu besar (${(buffer.byteLength / 1_000_000).toFixed(1)} MB). Maks ${MAX_VIDEO_BYTES / 1_000_000} MB.`
          : `Gambar terlalu besar (${(buffer.byteLength / 1024).toFixed(0)} KB). Maks 900 KB. Kompres gambar di browser gagal — coba pilih file yang lebih kecil.`,
      },
      { status: 413 },
    );
  }

  try {
    const url = await uploadToCloudinary(buffer, file.name, 'uploads', file.type || 'image/jpeg');
    return Response.json({ url });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Upload ke Cloudinary gagal.' }, { status: 502 });
  }
}
