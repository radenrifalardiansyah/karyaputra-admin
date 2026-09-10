import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import AdminSplashScreen from "@/components/AdminSplashScreen";
import ToastProvider from "@/components/Toast";
import ConfirmProvider from "@/components/Confirm";
import { getCachedAdminBranding } from "@/lib/server/branding";
import { hexToShades } from "@/lib/color";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getCachedAdminBranding();
  return {
    title: `Dashboard Admin — ${branding.storeName}`,
    description: `Admin dashboard ${branding.storeName}`,
    robots: { index: false, follow: false },
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: branding.appName,
    },
    icons: {
      icon: branding.logo || "/icon-192.png",
      apple: branding.logo || "/apple-touch-icon.png",
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getCachedAdminBranding();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: branding.themeColor,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await getCachedAdminBranding();
  const shades = hexToShades(branding.themeColor);

  return (
    <html
      lang="id"
      className={jakarta.variable}
      style={{
        '--accent': shades.accent,
        '--accent-dark': shades.dark,
        '--accent-light': shades.light,
        '--accent-bg': shades.bg,
      } as React.CSSProperties}
    >
      <body>
        <AdminSplashScreen />
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
