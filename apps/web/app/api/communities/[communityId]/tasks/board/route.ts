import { NextRequest, NextResponse } from 'next/server';
import { requireMember, failFromError } from '@/lib/tasks/api';
import { getBoard } from '@/lib/tasks/store';

/**
 * GET: The community's whole kanban board — columns + tasks in display order
 * plus the active member list for the assignee picker. Seeds the default
 * columns on first fetch. Any active member may read.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await params;
  const session = await requireMember(communityId);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json(await getBoard(communityId));
  } catch (err) {
    return failFromError(err);
  }
}
