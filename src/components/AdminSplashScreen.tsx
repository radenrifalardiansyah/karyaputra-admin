'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import staticLogo from '@/assets/images/logo-karyaputra.jpeg';
import { BRAND_NAME } from '@/lib/branding';

export default function AdminSplashScreen() {
  const [visible, setVisible] = useState<boolean | null>(null);
  // Logo custom dari Settings > Info Toko — sama seperti layar login (lihat api/public-branding),
  // splash ini dirender sebelum sesi/creds ada jadi tidak bisa lewat /api/settings langsung.
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch('/api/public-branding')
      .then(r => r.ok ? r.json() : null)
      .then((data: { logo?: string | null } | null) => { if (data?.logo) setLogoUrl(data.logo); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true);

    const shown = sessionStorage.getItem('admin_splash_shown');
    if (isStandalone && !shown) {
      setVisible(true);
      sessionStorage.setItem('admin_splash_shown', '1');
      setTimeout(() => setVisible(false), 2400);
    } else {
      setVisible(false);
    }
  }, []);

  if (visible === null) {
    return <div className="fixed inset-0 z-[999]" style={{ background: '#0A0A0A' }} />;
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          className="fixed inset-0 z-[999] flex flex-col items-center justify-center"
          style={{ background: '#0A0A0A' }}
        >
          {/* Logo — sudah tampil di splash native Android, jadi di sini diam saja (tidak animasi ulang) supaya menyatu, tidak terasa "muncul dua kali" */}
          <div
            className="relative w-24 h-24 rounded-2xl overflow-hidden shadow-2xl mb-6"
            style={{ border: '2px solid rgba(146,64,14,0.6)' }}
          >
            <Image src={logoUrl || staticLogo} alt="Admin Panel" fill className="object-cover" priority />
          </div>

          {/* Label admin */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.4 }}
            className="mb-1 px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase"
            style={{ background: 'rgba(146,64,14,0.3)', color: '#FCD34D' }}
          >
            Admin Panel
          </motion.div>

          {/* Brand name */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.45 }}
            className="text-center mt-2"
          >
            <p className="font-display text-2xl font-bold" style={{ color: '#FEF3C7' }}>
              {BRAND_NAME}
            </p>
            <p className="text-sm mt-1" style={{ color: 'rgba(253,230,138,0.5)' }}>
              Dashboard Analytics
            </p>
          </motion.div>

          {/* Loading dots */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex gap-1.5 mt-10"
          >
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--accent)' }}
                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
