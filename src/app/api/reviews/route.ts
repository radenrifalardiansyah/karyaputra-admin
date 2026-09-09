import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

interface ReviewRow { id: string; customer_id: string | null; customer_name: string | null; rating: number | null; comment: string | null; approved: boolean; created_at: Date; updated_at: Date | null }
function rowToReview(r: ReviewRow) {
  return {
    id: r.id, customerId: r.customer_id, customerName: r.customer_name ?? '', rating: r.rating ?? 0,
    comment: r.comment ?? '', approved: r.approved,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}

// Ulasan bintang dari akun storefront (tabel Postgres `reviews`, dibuat lewat halaman
// /pesanan storefront). Baru dihitung ke rating publik di beranda storefront
// setelah di-approve di sini — lihat PATCH [id] untuk logika approve/reject.
const getCachedReviews = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<ReviewRow[]>`select * from reviews order by created_at desc`;
    return rows.map(rowToReview);
  },
  ['admin-reviews'],
  { revalidate: 15, tags: ['admin-reviews'] }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'reviews', 'view');
  if (guard instanceof Response) return guard;
  const reviews = await getCachedReviews();
  return Response.json({ reviews });
}
