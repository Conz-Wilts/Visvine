import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import { quotaFor, usageFor } from '@/lib/vm/quota';
import { usdFor } from '@/lib/vm/shared/limits';

/**
 * What this space's machines have cost this month, and what is left.
 *
 * Cost is a product surface rather than an invoice surprise: an admin can see
 * the hours, the money they represent and the cap they count against before a
 * refusal tells them. Admin-only, because it is the space's spending.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [quota, usage] = await Promise.all([quotaFor(spaceId), usageFor(spaceId)]);
  const hours = usage.seconds / 3_600;

  return NextResponse.json({
    month: new Date().toISOString().slice(0, 7),
    hours: Number(hours.toFixed(2)),
    usd: Number(usdFor(usage.seconds).toFixed(2)),
    commands: usage.execs,
    capHours: quota.monthlyHours,
    remainingHours:
      quota.monthlyHours === null ? null : Number(Math.max(0, quota.monthlyHours - hours).toFixed(2)),
  });
}
