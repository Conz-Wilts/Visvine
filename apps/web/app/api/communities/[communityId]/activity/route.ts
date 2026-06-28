import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';

/**
 * GET: Fetch recent activity log entries for a community (admin only)
 * Note: Activity logging not implemented yet - returns empty array
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Activity logging not implemented - return empty
  return NextResponse.json({ logs: [] });
}
