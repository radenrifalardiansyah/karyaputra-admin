import { unstable_cache } from 'next/cache';
import { getSettings } from '@/lib/settings-pg';
import { ADMIN_APP_NAME, BRAND_NAME, THEME_COLOR, THEME_BACKGROUND_COLOR } from '@/lib/branding';

interface SettingsDoc {
  storeName?: string;
  adminAppName?: string;
  adminThemeColor?: string;
  adminThemeBackgroundColor?: string;
  logo?: string;
}

export interface AdminBranding {
  appName: string;
  storeName: string;
  themeColor: string;
  themeBackgroundColor: string;
  logo?: string;
}

// Admin's own app name/theme, editable via Settings > Tampilan & Tema (settings/main
// di Firestore). Cached 1 jam, tag 'settings' (sudah di-invalidate di setiap PUT
// /api/settings — lihat api/settings/route.ts) — tidak butuh tag baru karena ini
// baca dari repo yang sama, tidak lewat webhook cross-repo seperti storefront.
const DEFAULT_ADMIN_BRANDING: AdminBranding = {
  appName: ADMIN_APP_NAME,
  storeName: BRAND_NAME,
  themeColor: THEME_COLOR,
  themeBackgroundColor: THEME_BACKGROUND_COLOR,
};

export const getCachedAdminBranding = unstable_cache(
  async (): Promise<AdminBranding> => {
    try {
      const s = (await getSettings()) as SettingsDoc;
      return {
        appName: s.adminAppName || ADMIN_APP_NAME,
        storeName: s.storeName || BRAND_NAME,
        themeColor: s.adminThemeColor || THEME_COLOR,
        themeBackgroundColor: s.adminThemeBackgroundColor || THEME_BACKGROUND_COLOR,
        logo: s.logo || undefined,
      };
    } catch (err) {
      // Fail open with static defaults — a Firestore outage/quota issue must never
      // take down the build or every page's metadata/theme with it (see the
      // RESOURCE_EXHAUSTED incident this project already had once).
      console.error('[getCachedAdminBranding]', err);
      return DEFAULT_ADMIN_BRANDING;
    }
  },
  ['admin-branding'],
  { revalidate: 3600, tags: ['settings'] }
);
