/**
 * One-off backfill: give every existing thing its context.
 *
 * Spaces, spaces and channels became graph nodes (and gained a canonical
 * context note) — but only on the create path. Everything that already existed
 * is invisible in the context graph until this runs. It also fills the gap
 * events have always had: they were nodes from day one but never got their
 * events/<slug>.md note.
 *
 * Notes and uploaded files are NOT nodes — they are content in a context — so
 * nothing here creates one for them; the last step rebuilds only the mention
 * edges that entity notes and connectors own.
 *
 * Order matters. The space node goes first because every other node hangs a
 * `contains` edge off it, and `Link.sourceId` is a foreign key — a child synced
 * before its parent silently loses its edge (syncEntityNode skips a missing
 * parent rather than failing). Channels come after spaces for the same reason.
 *
 * Idempotent: nodes are found by their record id and updated in place, notes are
 * create-only, and edges dedup on (space, pair, relationship). Re-running
 * reports the same counts and changes nothing.
 *
 * Personal spaces (`me:<userId>` spaces) are skipped: a personal context has
 * no context graph to join, so a `space:` node there would be furniture.
 *
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-entity-context.ts
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-entity-context.ts --dry-run
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-entity-context.ts --space=<id>
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { ConversationType } from '@prisma/client';
import prisma from '../lib/prisma';
import {
  spaceNodeId,
  ensureEntityNote,
  syncEntityNode,
} from '../lib/notes/context/entityNodes';
import { backfillContextLinks } from '../lib/notes/entityLinks';
import { SHARED_OWNER_KEY } from '../lib/notes/store';

const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((a) => a.startsWith('--space='));
const only = onlyArg ? onlyArg.slice('--space='.length) : null;

interface Counts {
  space: number;
  spaces: number;
  channels: number;
  notes: number;
  eventNotes: number;
  entityNotes: number;
}

async function backfillSpace(space: { id: string; name: string; description: string | null; location: string | null }): Promise<Counts> {
  const counts: Counts = {
    space: 0,
    spaces: 0,
    channels: 0,
    notes: 0,
    eventNotes: 0,
    entityNotes: 0,
  };
  const spaceNode = spaceNodeId(space.id);

  // ── 1. The space itself ────────────────────────────────────────────────
  // Refreshed only when the node is already there. Spaces are no longer given a
  // node for themselves at create time (app/api/communities/route.ts) — it would
  // put the space in its own directory and write a `communities/<slug>.md` page
  // about it — so this backfill must not reintroduce one. Spaces that
  // predate that keep theirs, and everything below still parents to it; the rest
  // skip the parent edge the same way a freshly created space does.
  const hasSpaceNode = (await prisma.node.count({ where: { id: spaceNode } })) > 0;
  if (hasSpaceNode) {
    if (!dryRun) {
      await syncEntityNode({
        spaceId: space.id,
        type: 'space',
        nodeId: spaceNode,
        name: space.name,
        subtitle: space.description,
        location: space.location,
        body: space.description ?? '',
        revalidate: false,
      });
    }
    counts.space = 1;
  }

  // ── 2. Spaces ──────────────────────────────────────────────────────────────
  const spaces = await prisma.channelSection.findMany({
    where: { spaceId: space.id },
    select: { id: true, name: true, emoji: true },
  });
  for (const space of spaces) {
    if (!dryRun) {
      await syncEntityNode({
        spaceId: space.id,
        type: 'section',
        name: space.name,
        recordId: space.id,
        metadata: { emoji: space.emoji },
        parentNodeId: spaceNode,
        revalidate: false,
      });
    }
    counts.spaces++;
  }

  // ── 3. Channels (after spaces, so their parent edge lands on the space) ─────
  const channels = await prisma.conversation.findMany({
    where: { spaceId: space.id, type: ConversationType.CHANNEL },
    select: { id: true, name: true, description: true, icon: true, viewMode: true, sectionId: true },
  });
  for (const channel of channels) {
    if (!dryRun) {
      const parent = channel.sectionId
        ? (
            await prisma.node.findFirst({
              where: {
                spaceId: space.id,
                type: 'section',
                metadata: { path: ['sectionId'], equals: channel.sectionId },
              },
              select: { id: true },
            })
          )?.id ?? spaceNode
        : spaceNode;
      await syncEntityNode({
        spaceId: space.id,
        type: 'channel',
        name: channel.name?.trim() || 'Channel',
        recordId: channel.id,
        subtitle: channel.description,
        metadata: { viewMode: channel.viewMode, icon: channel.icon },
        parentNodeId: parent,
        revalidate: false,
      });
    }
    counts.channels++;
  }

  // ── 4. Existing nodes missing their canonical note (events especially) ──────
  const nodes = await prisma.node.findMany({
    where: { spaceId: space.id },
    select: { id: true, type: true, name: true, subtitle: true, tags: true },
  });
  for (const node of nodes) {
    // 'space' here is the space's own root node; 'section' is the channel
    // container.
    if (node.type === 'space' || node.type === 'section' || node.type === 'channel') continue;
    // A connector's note came first, and any leftover note:/file: row from when
    // those types existed has no note to write either (scripts/prune-note-file-nodes.ts).
    if (node.type === 'connector' || node.type === 'note' || node.type === 'file') continue;
    // Counts are notes actually written — an entity that already had its note is
    // the common case, and reporting it as work done would hide what changed.
    if (!dryRun) {
      const { created } = await ensureEntityNote(space.id, node, { tags: node.tags });
      if (!created) continue;
    }
    if (node.type === 'event') counts.eventNotes++;
    else counts.entityNotes++;
  }

  // ── 5. Connector nodes + every mention edge, now the rest of the graph exists ─
  if (!dryRun) {
    counts.notes = await backfillContextLinks(space.id);
  } else {
    counts.notes = await prisma.contextNote.count({
      where: { spaceId: space.id, ownerKey: SHARED_OWNER_KEY, deletedAt: null },
    });
  }

  return counts;
}

async function main() {
  const spaces = await prisma.space.findMany({
    where: {
      // Personal spaces have no context graph of their own — skip them.
      personalOwnerId: null,
      ...(only ? { id: only } : {}),
    },
    select: { id: true, name: true, description: true, location: true },
    orderBy: { id: 'asc' },
  });
  if (only && spaces.length === 0) {
    throw new Error(`Space not found (or it's a personal space): ${only}`);
  }

  console.log(`${dryRun ? '[dry run] ' : ''}Backfilling context for ${spaces.length} spaces…`);
  for (const space of spaces) {
    const c = await backfillSpace(space);
    console.log(
      `${space.name} (${space.id}): ` +
        `${c.spaces} spaces, ${c.channels} channels, ${c.notes} notes, ` +
        `${c.eventNotes} event notes, ${c.entityNotes} other entity notes`,
    );
  }
  if (dryRun) console.log('\nNothing was written — re-run without --dry-run to apply.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
