import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, failFromError } from '@/lib/tasks/api';
import { columnCreateSchema } from '@/lib/tasks/schema';
import { createColumn } from '@/lib/tasks/store';

/** POST: Add a column to the board. Community admins only. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await params;
  const session = await requireAdmin(communityId);
  if (session instanceof Response) return session;
  try {
    const input = columnCreateSchema.parse(await req.json().catch(() => ({})));
    const column = await createColumn(communityId, input);
    return NextResponse.json({ column }, { status: 201 });
  } catch (err) {
    return failFromError(err);
  }
}
