import { NextRequest, NextResponse } from 'next/server';
import { requireMember, failFromError } from '@/lib/tasks/api';
import { taskMoveSchema } from '@/lib/tasks/schema';
import { moveTask } from '@/lib/tasks/store';

/**
 * POST: Move a task into a column between the neighbors the client observed
 * after the drop. Any active member. Returns the task with its authoritative
 * server-computed position.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; taskId: string }> },
) {
  const { communityId, taskId } = await params;
  const session = await requireMember(communityId);
  if (session instanceof Response) return session;
  try {
    const input = taskMoveSchema.parse(await req.json().catch(() => ({})));
    const task = await moveTask(communityId, taskId, input);
    return NextResponse.json({ task });
  } catch (err) {
    return failFromError(err);
  }
}
