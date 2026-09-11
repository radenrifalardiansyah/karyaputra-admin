export const BRAND_NAME = 'Karya Putra';

export const ADMIN_APP_NAME = 'Admin Karya Putra';

export const WHATSAPP_NUMBER = '6281212132014';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://karyaputra.vercel.app';
export const productUrl = (id: string) => `${SITE_URL}/products/${id}`;

export const THEME_COLOR = '#16A34A';
export const THEME_BACKGROUND_COLOR = '#0A0A0A';

export const DEVELOPER = {
  name: 'PT. Eleven Digital Indonesia',
  url: 'https://elevendigital-id.vercel.app',
  supportedBy: 'RMedia Solutions',
};
