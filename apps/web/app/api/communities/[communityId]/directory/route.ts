/**
 * Directory data API — nodes only (no links).
 *
 * The grid/table directory views never render the link context, so they fetch this
 * lightweight endpoint instead of /context. Backed by the same `context-data-v2`
 * cache tag, so node/profile writes invalidate it automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCommunityNodes } from '@/lib/eventRepo';
import { normalizeNode } from '@/lib/contextUtils';
import { isStructuralNodeType } from '@/lib/types/context';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { communityReadForbidden, directoryAccessForbidden } from '@/lib/auth';

type RouteContext = {
  params: Promise<{ communityId: string }>;
};

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { communityId } = await context.params;

    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (
      (await communityReadForbidden(session.userId, communityId)) ||
      (await directoryAccessForbidden(session.userId, communityId, session.email))
    ) {
      return forbiddenResponse();
    }

    // The directory is a roll of people, groups, events and resources. Spaces,
    // channels, notes and files are nodes too (so they're in the context graph),
    // but listing them here would drown the actual directory — they're reachable
    // from the channel rail and the brain, where they belong.
    const nodes = (await getCommunityNodes(communityId))
      .filter((node) => !isStructuralNodeType(node.type))
      .map(normalizeNode);

    return NextResponse.json(
      { nodes },
      {
        headers: {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    return handleApiError(error, 'api.community.directory.failed');
  }
}
