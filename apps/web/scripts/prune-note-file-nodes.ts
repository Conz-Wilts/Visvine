/**
 * One-off cleanup: delete the `note:` and `file:` graph nodes left over from
 * when Note and File were node types.
 *
 * A note is content in a space brain and an uploaded file is a ContextSource
 * — neither is a thing in the context graph any more, so nothing syncs a node
 * for them. The rows already written keep drawing on the canvas until this runs.
 *
 * Only nodes go: the notes and the uploaded files themselves are untouched.
 * Deleting a node takes its Links with it (the FK cascades), which is exactly
 * what should happen to the `contains` and `mentioned` edges those nodes owned.
 * Links whose `originRef` is a plain note path are cleaned up too — those are
 * the mention edges a note used to own between two other entities' nodes, which
 * no longer have an owner that can maintain them.
 *
 * Idempotent: re-running finds nothing and reports zeros.
 *
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/prune-note-file-nodes.ts
 *   pnpm --filter @visvine/web exec tsx scripts/prune-note-file-nodes.ts --dry-run
 *   pnpm --filter @visvine/web exec tsx scripts/prune-note-file-nodes.ts --space=<id>
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { CONTEXT_ORIGIN } from '../lib/notes/entityLinks';

const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((a) => a.startsWith('--space='));
const only = onlyArg ? onlyArg.slice('--space='.length) : null;

// Stored `type` casing has drifted over the life of the graph ('note' vs
// 'Note'), so match case-insensitively rather than on the exact spelling.
const RETIRED_TYPES = ['note', 'file'];

async function main() {
  const where = {
    type: { in: RETIRED_TYPES, mode: 'insensitive' as const },
    ...(only ? { spaceId: only } : {}),
  };

  const nodes = await prisma.node.findMany({
    where,
    select: { id: true, spaceId: true, type: true, name: true },
    orderBy: { id: 'asc' },
  });

  // The mention edges a note node owned are cascaded away with the node itself.
  // These are the other kind: edges between two entity nodes whose `originRef`
  // is a plain note's path, written back when a plain note could own an edge.
  const deletedIds = new Set(nodes.map((n) => n.id));
  const orphanedLinks = await prisma.link.findMany({
    where: {
      origin: CONTEXT_ORIGIN,
      ...(only ? { spaceId: only } : {}),
    },
    select: { id: true, originRef: true, sourceId: true, targetId: true },
  });
  // An edge owned by a note path that isn't an entity note's path has no owner
  // left. Entity notes (people/…, communities/…) keep theirs — their node still
  // exists and still maintains them on save.
  const entityDirs = ['people/', 'communities/', 'resources/', 'events/', 'spaces/', 'channels/', 'connectors/'];
  const staleLinks = orphanedLinks.filter(
    (l) =>
      l.originRef !== null &&
      l.originRef.endsWith('.md') &&
      !entityDirs.some((dir) => l.originRef!.startsWith(dir)) &&
      !deletedIds.has(l.sourceId) && // the rest cascade with their node
      !deletedIds.has(l.targetId),
  );

  console.log(
    `${dryRun ? '[dry run] ' : ''}${nodes.length} note/file nodes, ` +
      `${staleLinks.length} orphaned context links` +
      (only ? ` in ${only}` : ' across every space'),
  );
  for (const node of nodes) console.log(`  ${node.spaceId}  ${node.type}  ${node.id}  ${node.name}`);

  if (dryRun) {
    console.log('\nNothing was deleted — re-run without --dry-run to apply.');
    return;
  }

  if (staleLinks.length > 0) {
    await prisma.link.deleteMany({ where: { id: { in: staleLinks.map((l) => l.id) } } });
  }
  if (nodes.length > 0) {
    await prisma.node.deleteMany({ where: { id: { in: nodes.map((n) => n.id) } } });
  }
  console.log(`Deleted ${nodes.length} nodes and ${staleLinks.length} links.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
