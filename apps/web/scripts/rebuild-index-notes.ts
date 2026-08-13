/**
 * Rebuild: refresh EVERY folder's index.md — the managed child block listing the
 * folder's current direct notes and subfolders (see lib/notes/shared/indexNote.ts).
 * Missing indexes are created whole, from the folder-name convention.
 *
 * An EXISTING index keeps everything somebody wrote: its frontmatter (title
 * especially — that is the folder's display name, shown in the sidebar and the
 * tree) and every line of prose. Only the block between the `index:children`
 * markers is rewritten; an index that has never carried one gets it appended.
 * The brain root is treated like any other folder here — a root index that has
 * no block is left alone, which keeps a curated home note curated.
 *
 * Writes go through writeNote, so each rewritten index keeps its previous
 * content as a baseline revision — restorable from note history. Re-running is
 * a no-op (unchanged saves record nothing).
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/rebuild-index-notes.ts                 # all brains
 *   pnpm --filter @visvine/web exec tsx scripts/rebuild-index-notes.ts <spaceId>   # one space
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { createFolder, refreshFolderIndex, type Actor, type Brain } from '../lib/notes/store';
import { ancestorFolders, indexPathOf } from '../lib/notes/shared/indexNote';

const INDEX_ACTOR: Actor = { id: 'system', name: 'Index maintenance' };

async function main() {
  const only = process.argv[2];
  const where = only ? { spaceId: only } : {};

  const noteBrains = await prisma.spaceNote.groupBy({
    by: ['spaceId', 'ownerKey'],
    where: { ...where, deletedAt: null },
  });
  const folderBrains = await prisma.spaceNoteFolder.groupBy({
    by: ['spaceId', 'ownerKey'],
    where,
  });
  const brains = new Map<string, Brain>();
  for (const b of [...noteBrains, ...folderBrains]) {
    brains.set(`${b.spaceId} ${b.ownerKey}`, { spaceId: b.spaceId, ownerKey: b.ownerKey });
  }
  if (only && brains.size === 0) throw new Error(`No notes found for space: ${only}`);

  for (const brain of brains.values()) {
    const notes = await prisma.spaceNote.findMany({
      where: { spaceId: brain.spaceId, ownerKey: brain.ownerKey, deletedAt: null },
      select: { path: true, content: true },
    });
    const explicit = await prisma.spaceNoteFolder.findMany({
      where: { spaceId: brain.spaceId, ownerKey: brain.ownerKey },
      select: { path: true },
    });
    const folders = new Set<string>();
    for (const n of notes) for (const f of ancestorFolders(n.path)) folders.add(f);
    for (const f of explicit) for (const a of ancestorFolders(indexPathOf(f.path))) folders.add(a);

    const live = new Set(notes.map((n) => n.path));
    // Deepest first, so a subfolder's index exists (and carries its title) before
    // the parent's block is built from it.
    const ordered = [...folders].sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b));
    let created = 0;
    for (const folder of ordered) {
      if (live.has(indexPathOf(folder))) continue;
      // createFolder writes the folder row AND the missing index stub.
      await createFolder(brain, folder, INDEX_ACTOR);
      created += 1;
      console.log(`  created ${indexPathOf(folder)}`);
    }
    // Then refresh every managed block — including the ones just created, whose
    // children may have arrived out of order above.
    for (const folder of ordered) await refreshFolderIndex(brain, folder);
    // '' is the brain root: refreshed only if its index opted in with a block.
    await refreshFolderIndex(brain, '');
    console.log(
      `${brain.spaceId} [${brain.ownerKey}]: ${folders.size} folders, ${created} indexes created`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
