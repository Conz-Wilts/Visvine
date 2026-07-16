import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, failFromError } from '@/lib/tasks/api';
import { columnReorderSchema } from '@/lib/tasks/schema';
import { reorderColumns } from '@/lib/tasks/store';

/**
 * PUT: Reorder the board's columns from the full ordered id list (must contain
 * each column exactly once). Community admins only.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await params;
  const session = await requireAdmin(communityId);
  if (session instanceof Response) return session;
  try {
    const input = columnReorderSchema.parse(await req.json().catch(() => ({})));
    const columns = await reorderColumns(communityId, input.orderedIds);
    return NextResponse.json({ columns });
  } catch (err) {
    return failFromError(err);
  }
}
