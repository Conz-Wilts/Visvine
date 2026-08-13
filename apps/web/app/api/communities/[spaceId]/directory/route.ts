/**
 * Directory data API — nodes only (no links).
 *
 * The grid/table directory views never render the link context, so they fetch this
 * lightweight endpoint instead of /context. Backed by the same `context-data-v2`
 * cache tag, so node/profile writes invalidate it automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSpaceNodes } from '@/lib/eventRepo';
import { normalizeNode } from '@/lib/notes/context/normalize';
import { isStructuralNodeType } from '@/lib/types/context';
import { visibleNodes } from '@/lib/notes/context/featureVisibility';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { spaceMemberForbidden, directoryAccessForbidden, getFeatureConfig } from '@/lib/auth';

type RouteContext = {
  params: Promise<{ spaceId: string }>;
};

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { spaceId } = await context.params;

    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (
      (await spaceMemberForbidden(session.userId, spaceId, session.email)) ||
      (await directoryAccessForbidden(session.userId, spaceId, session.email))
    ) {
      return forbiddenResponse();
    }

    // The directory is a roll of people, groups, events and resources. Spaces,
    // channels, notes and files are nodes too (so they're in the context graph),
    // but listing them here would drown the actual directory — they're reachable
    // from the channel rail and the context, where they belong.
    // …and a type whose tool has been switched off is gone from here too, the
    // same way it's gone from the create list and the console's Types tab.
    const featureConfig = await getFeatureConfig(spaceId);
    const nodes = visibleNodes(
      (await getSpaceNodes(spaceId)).filter((node) => !isStructuralNodeType(node.type)),
      featureConfig,
    ).map(normalizeNode);

    return NextResponse.json(
      { nodes },
      {
        headers: {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    return handleApiError(error, 'api.space.directory.failed');
  }
}
