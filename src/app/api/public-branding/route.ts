import { getCachedAdminBranding } from '@/lib/server/branding';

// Tanpa auth dengan sengaja — dipakai di layar login (sebelum ada sesi/creds sama sekali)
// supaya logo toko yang diupload di Settings ikut tampil di sana, bukan cuma di dashboard
// setelah login. Cuma expose logo (bukan seluruh dokumen settings), jadi aman diakses publik.
export async function GET() {
  const branding = await getCachedAdminBranding();
  return Response.json({ logo: branding.logo ?? null });
}
