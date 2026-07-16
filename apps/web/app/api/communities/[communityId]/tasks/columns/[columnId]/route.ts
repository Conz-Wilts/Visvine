import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, failFromError } from '@/lib/tasks/api';
import { columnPatchSchema } from '@/lib/tasks/schema';
import { updateColumn, deleteColumn } from '@/lib/tasks/store';

/** PATCH: Rename or recolor a column. Community admins only. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; columnId: string }> },
) {
  const { communityId, columnId } = await params;
  const session = await requireAdmin(communityId);
  if (session instanceof Response) return session;
  try {
    const input = columnPatchSchema.parse(await req.json().catch(() => ({})));
    const column = await updateColumn(communityId, columnId, input);
    return NextResponse.json({ column });
  } catch (err) {
    return failFromError(err);
  }
}

/** DELETE: Remove a column and every task in it (FK cascade). Admins only. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string; columnId: string }> },
) {
  const { communityId, columnId } = await params;
  const session = await requireAdmin(communityId);
  if (session instanceof Response) return session;
  try {
    await deleteColumn(communityId, columnId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failFromError(err);
  }
}
