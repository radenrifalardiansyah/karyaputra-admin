import type { MetadataRoute } from 'next';
import { getCachedAdminBranding } from '@/lib/server/branding';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getCachedAdminBranding();
  return {
    name: branding.appName,
    short_name: branding.appName,
    description: `Dashboard Admin ${branding.storeName} — kelola produk, pesanan, stok, dan analitik toko.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: branding.themeBackgroundColor,
    theme_color: branding.themeColor,
    // Logo custom dari Settings > Info Toko dipakai untuk ikon "any" (tampilan normal).
    // Varian "maskable" tetap pakai file statis — logo upload user belum tentu punya safe-zone
    // padding yang cukup untuk adaptive icon Android, jadi bisa terpotong kalau dipaksa maskable.
    icons: branding.logo
      ? [
          { src: branding.logo, sizes: '1000x1000', type: 'image/png', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      : [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
  };
}
