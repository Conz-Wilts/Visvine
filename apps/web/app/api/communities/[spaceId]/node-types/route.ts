// Space-wide node type vocabulary. Any active member may add a type when
// they first name one on the draft-context surface (matches who can add a tag
// to a note); the type then colours and labels consistently everywhere. This
// narrowly appends one entry to nodeTypes — it never touches the rest of the
// space record, which is what keeps it out of the admin-only PUT.

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { spaceReadForbidden } from '@/lib/auth';
import { mergeNodeType, type MergeNodeTypeResult } from '@/lib/types';
import {
  updateSpaceConfig,
  bustSpaceConfigCache,
  UnknownSpaceError,
} from '@/lib/spaces/spaceConfig';

/**
 * PATCH: add a node type, or resolve the one already serving that name.
 * Body: { name, color? }. First writer wins on the colour — recolouring is the
 * console's job, not a side effect of somebody else creating a note.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json().catch(() => ({}));
  const { name, color } = body as { name?: string; color?: string };
  if (typeof name !== 'string') return NextResponse.json({ error: 'name is required' }, { status: 400 });

  if (await spaceReadForbidden(session.userId, spaceId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const membership = await prisma.spaceMember.findFirst({
    where: { userId: session.userId, spaceId, status: 'active' },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // "First writer wins" only means anything if the read that decides it and the
  // write that acts on it can't be interleaved — two members naming the same
  // type at once used to both see it missing and both create it.
  let merged: MergeNodeTypeResult;
  try {
    await updateSpaceConfig(
      spaceId,
      (stored) => {
        merged = mergeNodeType(stored.nodeTypes, { name, color });
        // Nothing to write when the name was already served — including the case
        // where mergeNodeType only seeded the defaults it would have written anyway.
        return merged.ok && merged.created ? { nodeTypes: merged.types } : {};
      },
      { skipRevalidate: true },
    );
  } catch (err) {
    if (err instanceof UnknownSpaceError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }

  if (!merged!.ok) return NextResponse.json({ error: merged!.error }, { status: 400 });
  if (merged!.created) bustSpaceConfigCache();

  return NextResponse.json({ type: merged!.type, created: merged!.created });
}
