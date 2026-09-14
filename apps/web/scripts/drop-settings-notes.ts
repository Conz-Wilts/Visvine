/**
 * One-shot cleanup: remove the `settings/` config notes every space collected
 * while its configuration was mirrored into context.
 *
 * A space's configuration is the `spaces` row — `nodeTypes`, `linkTypes`,
 * `aliases`, `featureConfig`, `designConfig` — and for a while it was also
 * written out as `settings/types.md`, `settings/features.md` and
 * `settings/design.md`, kept in step by a hook in both directions. That mirror
 * is gone: the columns are the only copy, and `settings/` is reserved
 * (lib/notes/shared/namespaces.ts) so nothing can write there again.
 *
 * What is left behind is the reason for this script. Every shared space that
 * ever saved its config holds those three notes plus the `settings/index.md`
 * the write path minted for them — notes that LOOK like configuration and are
 * not, that would still show the folder in the tree, and that would quietly do
 * nothing if somebody edited one. Worse than absent.
 *
 * Deleted properly, not hidden: the notes are trashed through `deleteFolder`
 * (so links, publications and grants are reconciled like any folder delete) and
 * then purged, because a restore would land in a path writes are refused at.
 * Re-running is a no-op.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/drop-settings-notes.ts            # every space
 *   pnpm --filter @visvine/web exec tsx scripts/drop-settings-notes.ts <spaceId>  # one space
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { deleteFolder, type Context } from '../lib/notes/store';

const SETTINGS_DIR = 'settings';

async function main() {
  const only = process.argv[2];

  // Live notes only decide WHERE to run; the delete below takes the folder
  // whole, index note included.
  const holders = await prisma.contextNote.findMany({
    where: {
      ...(only ? { spaceId: only } : {}),
      deletedAt: null,
      OR: [{ path: `${SETTINGS_DIR}/index.md` }, { path: { startsWith: `${SETTINGS_DIR}/` } }],
    },
    select: { spaceId: true, ownerKey: true },
    distinct: ['spaceId', 'ownerKey'],
  });

  if (holders.length === 0) {
    console.log('no settings/ notes found — nothing to do');
    return;
  }

  let purged = 0;
  for (const holder of holders) {
    const context: Context = { spaceId: holder.spaceId, ownerKey: holder.ownerKey };
    await deleteFolder(context, SETTINGS_DIR);
    // Trashed, not gone: a settings note in the bin is a note somebody can try
    // to restore into a path that refuses writes, so take it the rest of the way.
    const { count } = await prisma.contextNote.deleteMany({
      where: {
        spaceId: holder.spaceId,
        ownerKey: holder.ownerKey,
        deletedAt: { not: null },
        OR: [
          { deletedPath: `${SETTINGS_DIR}/index.md` },
          { deletedPath: { startsWith: `${SETTINGS_DIR}/` } },
        ],
      },
    });
    purged += count;
    console.log(`  ${holder.spaceId} [${holder.ownerKey}] — ${count} note(s) removed`);
  }

  console.log(`${purged} note(s) removed across ${holders.length} context(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
