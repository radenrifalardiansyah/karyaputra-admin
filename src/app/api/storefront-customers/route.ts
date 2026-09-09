import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Akun yang customer buat sendiri di storefront (register/login/Google) untuk bisa checkout —
// tabel `storefront_customers`, TERPISAH dari `customers` (kontak CRM yang diinput manual di
// tab Pelanggan). Jangan disatukan; keduanya sengaja punya bentuk data yang berbeda.
// (Tahap 22 migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md.)
const getCachedStorefrontCustomers = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<{
      id: string; name: string | null; phone: string | null; email: string | null;
      auth_provider: string | null; created_at: Date;
    }[]>`
      select id, name, phone, email, auth_provider, created_at from storefront_customers order by created_at desc
    `;
    return rows.map(r => ({
      id: r.id, name: r.name ?? '', phone: r.phone ?? r.id, email: r.email ?? undefined,
      authProvider: r.auth_provider ?? undefined,
      createdAt: { seconds: Math.floor(r.created_at.getTime() / 1000), nanoseconds: 0 },
    }));
  },
  ['admin-storefront-customers'],
  { revalidate: 15, tags: ['admin-storefront-customers'] }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'storefront-customers', 'view');
  if (guard instanceof Response) return guard;
  const customers = await getCachedStorefrontCustomers();
  return Response.json({ customers });
}
