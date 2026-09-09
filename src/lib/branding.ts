export const BRAND_NAME = 'Cemilan Teh Risma';

export const ADMIN_APP_NAME = 'Admin Teh Risma';

export const WHATSAPP_NUMBER = '6281212132014';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://karyaputra.vercel.app';
export const productUrl = (id: string) => `${SITE_URL}/products/${id}`;

export const THEME_COLOR = '#D4691E';
export const THEME_BACKGROUND_COLOR = '#1C1917';

export const DEVELOPER = {
  name: 'PT. Eleven Digital Indonesia',
  url: 'https://www.eleven-digital.id',
  supportedBy: 'RMedia Solutions',
};
