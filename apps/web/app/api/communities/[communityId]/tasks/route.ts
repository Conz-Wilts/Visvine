import { NextRequest, NextResponse } from 'next/server';
import { requireMember, failFromError } from '@/lib/tasks/api';
import { taskCreateSchema } from '@/lib/tasks/schema';
import { createTask } from '@/lib/tasks/store';

/** POST: Create a task in a column. Any active member. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await params;
  const session = await requireMember(communityId);
  if (session instanceof Response) return session;
  try {
    const input = taskCreateSchema.parse(await req.json().catch(() => ({})));
    const task = await createTask(communityId, session.userId, input);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return failFromError(err);
  }
}
