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
import { peopleFlowingSubspacesOf } from '@/lib/spaces/subspaceAccess';
import { crossesPeopleFlow, mergePeopleFlow } from '@/lib/directory/peopleFlow';

type RouteContext = {
  params: Promise<{ spaceId: string }>;
};

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { spaceId } = await context.params;

    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    // Independent gates over the same request-memoized rows: one round trip.
    const [memberForbidden, featureForbidden] = await Promise.all([
      spaceMemberForbidden(session.userId, spaceId, session.email),
      directoryAccessForbidden(session.userId, spaceId, session.email),
    ]);
    if (memberForbidden || featureForbidden) {
      return forbiddenResponse();
    }

    // The directory is a roll of people, groups, events and resources. Spaces,
    // channels, notes and files are nodes too (so they're in the context graph),
    // but listing them here would drown the actual directory — they're reachable
    // from the channel rail and the context, where they belong.
    // …and a type whose tool has been switched off is gone from here too, the
    // same way it's gone from the create list and the console's Types tab.
    const featureConfig = await getFeatureConfig(spaceId);
    const own = visibleNodes(
      (await getSpaceNodes(spaceId)).filter((node) => !isStructuralNodeType(node.type)),
      featureConfig,
    ).map(normalizeNode);

    // The people flow (docs/sub-space-model.md): a room with `flowPeople` on
    // lends its roll of people and organisations to the house's directory,
    // each row stamped with the room and read-only here. Read as of now, one
    // cached read per flowing room, through the room's own tool switches —
    // a type the room has off is as absent here as it is there. Events have
    // their own flow, so they never come through this one.
    const rooms = await peopleFlowingSubspacesOf(spaceId);
    const flowed = await Promise.all(
      rooms.map(async (room) => {
        const roomConfig = await getFeatureConfig(room.id);
        const nodes = visibleNodes(
          (await getSpaceNodes(room.id)).filter((node) => crossesPeopleFlow(node, isStructuralNodeType)),
          roomConfig,
        ).map(normalizeNode);
        return { room, nodes };
      }),
    );
    const nodes = mergePeopleFlow(own, flowed);

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
