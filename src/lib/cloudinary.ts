import crypto from 'crypto';

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME ?? '';
const KEY   = process.env.CLOUDINARY_API_KEY   ?? '';
const SEC   = process.env.CLOUDINARY_API_SECRET ?? '';

export function cloudinaryConfigured() {
  return Boolean(CLOUD && KEY && SEC);
}

export async function uploadToCloudinary(
  buffer: Buffer,
  filename: string,
  folder = 'products',
  mimeType = 'image/jpeg',
): Promise<string> {
  if (!cloudinaryConfigured()) {
    throw new Error('Cloudinary belum dikonfigurasi. Tambahkan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, dan CLOUDINARY_API_SECRET ke .env.local');
  }

  // Cloudinary punya endpoint terpisah untuk gambar dan video (resource_type di URL,
  // bukan parameter form) — video yang dikirim ke /image/upload akan ditolak.
  const resourceType = mimeType.startsWith('video/') ? 'video' : 'image';

  const timestamp = Math.round(Date.now() / 1000);

  // Signature: sha1 of sorted params + api_secret
  const paramStr = `folder=${folder}&timestamp=${timestamp}${SEC}`;
  const signature = crypto.createHash('sha1').update(paramStr).digest('hex');

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  form.append('folder',    folder);
  form.append('timestamp', String(timestamp));
  form.append('api_key',   KEY);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/${resourceType}/upload`, {
    method: 'POST',
    body:   form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cloudinary upload gagal (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json() as { secure_url: string };
  return data.secure_url;
}
