/**
 * Rebuild: rewrite EVERY folder's index.md to the folder-name convention —
 * title = humanized folder name, body = a fresh linked list of the folder's
 * current direct-child notes (see lib/notes/shared/indexNote.ts). Missing
 * indexes are created. The brain root's index.md is a curated home note and is
 * left untouched.
 *
 * Writes go through writeNote, so each rewritten index keeps its previous
 * (possibly curated) content as a baseline revision — restorable from note
 * history. Re-running is a no-op (unchanged saves record nothing).
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/rebuild-index-notes.ts                 # all brains
 *   pnpm --filter @visvine/web exec tsx scripts/rebuild-index-notes.ts <communityId>   # one community
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { writeNote, type Actor, type Brain } from '../lib/notes/store';
import { ancestorFolders, buildIndexStub, indexPathOf } from '../lib/notes/shared/indexNote';
import { parseFrontmatter } from '../lib/notes/shared/markdown';

const INDEX_ACTOR: Actor = { id: 'system', name: 'Index maintenance' };

async function main() {
  const only = process.argv[2];
  const where = only ? { communityId: only } : {};

  const noteBrains = await prisma.communityNote.groupBy({
    by: ['communityId', 'ownerKey'],
    where: { ...where, deletedAt: null },
  });
  const folderBrains = await prisma.communityNoteFolder.groupBy({
    by: ['communityId', 'ownerKey'],
    where,
  });
  const brains = new Map<string, Brain>();
  for (const b of [...noteBrains, ...folderBrains]) {
    brains.set(`${b.communityId} ${b.ownerKey}`, { communityId: b.communityId, ownerKey: b.ownerKey });
  }
  if (only && brains.size === 0) throw new Error(`No notes found for community: ${only}`);

  for (const brain of brains.values()) {
    const notes = await prisma.communityNote.findMany({
      where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: null },
      select: { path: true, content: true },
    });
    const explicit = await prisma.communityNoteFolder.findMany({
      where: { communityId: brain.communityId, ownerKey: brain.ownerKey },
      select: { path: true },
    });
    const folders = new Set<string>();
    for (const n of notes) for (const f of ancestorFolders(n.path)) folders.add(f);
    for (const f of explicit) for (const a of ancestorFolders(indexPathOf(f.path))) folders.add(a);

    let rewritten = 0;
    for (const folder of [...folders].sort()) {
      const idx = indexPathOf(folder);
      const children = notes
        .filter((n) => n.path !== idx && n.path.startsWith(`${folder}/`) && !n.path.slice(folder.length + 1).includes('/'))
        .map((n) => {
          const title = String(parseFrontmatter(n.content).title ?? '').trim();
          return { path: n.path, title: title || (n.path.split('/').pop() ?? n.path).replace(/\.md$/i, '') };
        });
      const next = buildIndexStub(folder, children);
      const prev = notes.find((n) => n.path === idx)?.content ?? null;
      if (prev === next) continue;
      await writeNote(brain, idx, next, INDEX_ACTOR);
      rewritten += 1;
      console.log(`  ${prev === null ? 'created' : 'rewrote'} ${idx}`);
    }
    if (rewritten > 0) console.log(`${brain.communityId} [${brain.ownerKey}]: ${rewritten} index notes updated`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
