import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';

/**
 * PUT: Approve or reject a content submission (admin only)
 * Note: Content submission system not implemented yet
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; submissionId: string }> }
) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Content submission system not implemented yet
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}