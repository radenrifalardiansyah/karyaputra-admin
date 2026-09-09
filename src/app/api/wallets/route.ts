import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToWallet, type WalletRow } from '@/lib/wallets-pg';

const getCachedWallets = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<WalletRow[]>`select * from wallets order by sort_order asc`;
    return rows.map(rowToWallet);
  },
  ['admin-wallets'],
  { revalidate: 15, tags: ['admin-wallets'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;
  const wallets = await getCachedWallets();
  return Response.json({ wallets });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();
  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    return Response.json({ error: 'Nama dompet wajib diisi.' }, { status: 400 });
  }

  const [{ max_order }] = await sql<{ max_order: number | null }[]>`select max(sort_order) as max_order from wallets`;
  const nextOrder = (max_order ?? -1) + 1;

  const payload = {
    name: data.name.trim(),
    type: ['cash', 'bank', 'ewallet', 'other'].includes(data.type as string) ? data.type as string : 'cash',
    icon: typeof data.icon === 'string' && data.icon ? data.icon : 'Wallet',
    color: typeof data.color === 'string' && data.color ? data.color : '#16A34A',
    initialBalance: Number(data.initialBalance) || 0,
    isActive: true,
    order: nextOrder,
    bankName: typeof data.bankName === 'string' && data.bankName.trim() ? data.bankName.trim() : null,
  };
  const id = randomUUID();
  await sql`
    insert into wallets (id, name, type, icon, color, initial_balance, is_active, sort_order, bank_name, created_at, updated_at)
    values (${id}, ${payload.name}, ${payload.type}, ${payload.icon}, ${payload.color}, ${payload.initialBalance}, ${payload.isActive}, ${payload.order}, ${payload.bankName}, now(), now())
  `;
  try {
    await logHistory(db, {
      entity: 'wallets',
      entityId: id,
      entityLabel: payload.name,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for wallets create', err);
  }
  revalidateTag('admin-wallets', { expire: 0 });
  return Response.json({ id });
}
