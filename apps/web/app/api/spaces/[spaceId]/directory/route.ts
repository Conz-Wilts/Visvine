/**
 * Directory data API — nodes only (no links).
 *
 * The grid/table directory views never render the link context, so they fetch this
 * lightweight endpoint instead of /context. Backed by the same `context-data-v2`
 * cache tag, so node/profile writes invalidate it automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSpaceNodes } from '@/lib/eventRepo';
import { visibleNodesFor } from '@/lib/notes/context/entityVisibility';
import { normalizeNode } from '@/lib/notes/context/normalize';
import { isStructuralNodeType } from '@/lib/types/context';
import { visibleNodes } from '@/lib/notes/context/featureVisibility';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { spaceMemberForbidden, directoryAccessForbidden, getFeatureConfig } from '@/lib/auth';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { recordFactsFor } from '@/lib/directory/recordFacts';

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
    // …and only THIS space's. A room's people are the room's records, reached
    // in the room; the house's roll is what the house knows. The one join
    // across the family is the identity, drawn on the person's page
    // (lib/directory/samePerson.ts), never as a card here.
    const featureConfig = await getFeatureConfig(spaceId);
    const nodes = visibleNodes(
      await visibleNodesFor(
        spaceId,
        session.userId,
        session.email,
        (await getSpaceNodes(spaceId)).filter((node) => !isStructuralNodeType(node.type)),
      ),
      featureConfig,
    ).map(normalizeNode);

    // What every record has — last edit, who — read through the
    // viewer's own lens, so it rides beside the cached nodes, never in them.
    const resolved = await resolveContext(session, spaceId);
    const facts = resolved instanceof Response ? new Map() : await recordFactsFor(spaceId, nodes, await principalOf(resolved));

    return NextResponse.json(
      { nodes: nodes.map((node) => ({ ...node, ...facts.get(node.id) })) },
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
