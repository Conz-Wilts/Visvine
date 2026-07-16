import { NextRequest, NextResponse } from 'next/server';
import { requireMember, failFromError } from '@/lib/tasks/api';
import { taskPatchSchema } from '@/lib/tasks/schema';
import { updateTask, deleteTask } from '@/lib/tasks/store';

/** PATCH: Edit a task's fields. Any active member. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; taskId: string }> },
) {
  const { communityId, taskId } = await params;
  const session = await requireMember(communityId);
  if (session instanceof Response) return session;
  try {
    const input = taskPatchSchema.parse(await req.json().catch(() => ({})));
    const task = await updateTask(communityId, taskId, input);
    return NextResponse.json({ task });
  } catch (err) {
    return failFromError(err);
  }
}

/** DELETE: Remove a task. Any active member. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string; taskId: string }> },
) {
  const { communityId, taskId } = await params;
  const session = await requireMember(communityId);
  if (session instanceof Response) return session;
  try {
    await deleteTask(communityId, taskId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failFromError(err);
  }
}
