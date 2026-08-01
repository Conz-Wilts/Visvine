/**
 * One-off backfill: give every existing thing its context.
 *
 * Communities, spaces, channels, notes and uploaded files became graph nodes
 * (and, for the container kinds, gained a canonical context note) — but only on
 * the create path. Everything that already existed is invisible in the context
 * graph until this runs. It also fills the gap events have always had: they were
 * nodes from day one but never got their events/<slug>.md note.
 *
 * Order matters. The community node goes first because every other node hangs a
 * `contains` edge off it, and `Link.sourceId` is a foreign key — a child synced
 * before its parent silently loses its edge (syncEntityNode skips a missing
 * parent rather than failing). Channels come after spaces for the same reason.
 *
 * Idempotent: nodes are found by their record id and updated in place, notes are
 * create-only, and edges dedup on (community, pair, relationship). Re-running
 * reports the same counts and changes nothing.
 *
 * Personal spaces (`me:<userId>` communities) are skipped: a personal brain has
 * no context graph to join, so a `community:` node there would be furniture.
 *
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-entity-context.ts
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-entity-context.ts --dry-run
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-entity-context.ts --community=<id>
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { ConversationType } from '@prisma/client';
import prisma from '../lib/prisma';
import {
  communityNodeId,
  ensureEntityNote,
  syncEntityNode,
} from '../lib/context/entityNodes';
import { backfillContextLinks } from '../lib/notes/entityLinks';
import { SHARED_OWNER_KEY } from '../lib/notes/store';

const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((a) => a.startsWith('--community='));
const only = onlyArg ? onlyArg.slice('--community='.length) : null;

interface Counts {
  community: number;
  spaces: number;
  channels: number;
  notes: number;
  files: number;
  eventNotes: number;
  entityNotes: number;
  staleConnectorNodes: number;
}

async function backfillCommunity(community: { id: string; name: string; description: string | null; location: string | null }): Promise<Counts> {
  const counts: Counts = {
    community: 0,
    spaces: 0,
    channels: 0,
    notes: 0,
    files: 0,
    eventNotes: 0,
    entityNotes: 0,
    staleConnectorNodes: 0,
  };
  const communityNode = communityNodeId(community.id);

  // ── 1. The community itself ────────────────────────────────────────────────
  if (!dryRun) {
    await syncEntityNode({
      communityId: community.id,
      type: 'community',
      nodeId: communityNode,
      name: community.name,
      subtitle: community.description,
      location: community.location,
      body: community.description ?? '',
      revalidate: false,
    });
  }
  counts.community = 1;

  // ── 2. Spaces ──────────────────────────────────────────────────────────────
  const spaces = await prisma.channelSpace.findMany({
    where: { communityId: community.id },
    select: { id: true, name: true, emoji: true },
  });
  for (const space of spaces) {
    if (!dryRun) {
      await syncEntityNode({
        communityId: community.id,
        type: 'space',
        name: space.name,
        recordId: space.id,
        metadata: { emoji: space.emoji },
        parentNodeId: communityNode,
        revalidate: false,
      });
    }
    counts.spaces++;
  }

  // ── 3. Channels (after spaces, so their parent edge lands on the space) ─────
  const channels = await prisma.conversation.findMany({
    where: { communityId: community.id, type: ConversationType.CHANNEL },
    select: { id: true, name: true, description: true, icon: true, viewMode: true, spaceId: true },
  });
  for (const channel of channels) {
    if (!dryRun) {
      const parent = channel.spaceId
        ? (
            await prisma.node.findFirst({
              where: {
                communityId: community.id,
                type: 'space',
                metadata: { path: ['spaceId'], equals: channel.spaceId },
              },
              select: { id: true },
            })
          )?.id ?? communityNode
        : communityNode;
      await syncEntityNode({
        communityId: community.id,
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

  // ── 4. Uploaded files ──────────────────────────────────────────────────────
  const sources = await prisma.contextSource.findMany({
    where: { communityId: community.id, ownerKey: SHARED_OWNER_KEY },
    select: { id: true, name: true, path: true, kind: true, mimeType: true },
  });
  for (const source of sources) {
    if (!dryRun) {
      await syncEntityNode({
        communityId: community.id,
        type: 'file',
        name: source.name,
        recordId: source.id,
        slugSource: source.path.replace(/\.[^./]+$/, ''),
        subtitle: source.kind.toUpperCase(),
        metadata: { sourcePath: source.path, kind: source.kind, mimeType: source.mimeType },
        parentNodeId: communityNode,
        revalidate: false,
      });
    }
    counts.files++;
  }

  // ── 5. Existing nodes missing their canonical note (events especially) ──────
  const nodes = await prisma.node.findMany({
    where: { communityId: community.id },
    select: { id: true, type: true, name: true, subtitle: true, tags: true },
  });
  for (const node of nodes) {
    if (node.type === 'community' || node.type === 'space' || node.type === 'channel') continue;
    if (node.type === 'note' || node.type === 'file' || node.type === 'connector') continue;
    // Counts are notes actually written — an entity that already had its note is
    // the common case, and reporting it as work done would hide what changed.
    if (!dryRun) {
      const { created } = await ensureEntityNote(community.id, node, { tags: node.tags });
      if (!created) continue;
    }
    if (node.type === 'event') counts.eventNotes++;
    else counts.entityNotes++;
  }

  // ── 6. Retire pre-Connector-type nodes ─────────────────────────────────────
  // connectors/<name>.md used to sync as a plain `note:` node. Now it has its
  // own `connector:` type, so the old row would sit beside the new one drawing
  // a duplicate. Deleting it takes its `contains`/`mentioned` edges with it
  // (Link cascades), and step 7 immediately re-creates them off the new node.
  const staleConnectorNotes = await prisma.node.findMany({
    where: {
      communityId: community.id,
      type: 'note',
      metadata: { path: ['notePath'], string_starts_with: 'connectors/' },
    },
    select: { id: true },
  });
  if (!dryRun && staleConnectorNotes.length > 0) {
    await prisma.node.deleteMany({ where: { id: { in: staleConnectorNotes.map((n) => n.id) } } });
  }
  counts.staleConnectorNodes = staleConnectorNotes.length;

  // ── 7. Note nodes + every mention edge, now that the rest of the graph exists ─
  if (!dryRun) {
    counts.notes = await backfillContextLinks(community.id);
  } else {
    counts.notes = await prisma.communityNote.count({
      where: { communityId: community.id, ownerKey: SHARED_OWNER_KEY, deletedAt: null },
    });
  }

  return counts;
}

async function main() {
  const communities = await prisma.community.findMany({
    where: {
      // Personal spaces have no context graph of their own — skip them.
      personalOwnerId: null,
      ...(only ? { id: only } : {}),
    },
    select: { id: true, name: true, description: true, location: true },
    orderBy: { id: 'asc' },
  });
  if (only && communities.length === 0) {
    throw new Error(`Community not found (or it's a personal space): ${only}`);
  }

  console.log(`${dryRun ? '[dry run] ' : ''}Backfilling context for ${communities.length} communities…`);
  for (const community of communities) {
    const c = await backfillCommunity(community);
    console.log(
      `${community.name} (${community.id}): ` +
        `${c.spaces} spaces, ${c.channels} channels, ${c.files} files, ${c.notes} notes, ` +
        `${c.eventNotes} event notes, ${c.entityNotes} other entity notes` +
        (c.staleConnectorNodes > 0 ? `, ${c.staleConnectorNodes} stale connector note-nodes retired` : ''),
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
