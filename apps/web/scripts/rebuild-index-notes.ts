/**
 * Rebuild: put EVERY folder's index.md into the one index shape (see the header
 * of lib/notes/shared/indexNote.ts) with its managed child block listing the
 * folder's current direct notes and subfolders. Missing indexes are created
 * whole, from the folder-name convention.
 *
 * An EXISTING index keeps what somebody wrote — its title (the folder's display
 * name), its tags, its prose. What changes is the shape around it: a `type:`
 * that only named the shape (`Index`, `Note`) goes, a `# Title` line repeating
 * the title goes, and a hand-written listing of the folder's own children —
 * `- [Team](/team/index.md) — who covers what` — folds into the block, its
 * description moving onto the child's own `description:` when the child has
 * none (foldCuratedChildren). The context root is a folder like any other.
 *
 * Re-running is a no-op (an unchanged index is not written).
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/rebuild-index-notes.ts                 # all contexts
 *   pnpm --filter @visvine/web exec tsx scripts/rebuild-index-notes.ts <spaceId>   # one space
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { createFolder, refreshFolderIndex, type Actor, type Context } from '../lib/notes/store';
import {
  ancestorFolders,
  foldCuratedChildren,
  humanizeFolderName,
  indexPathOf,
  isIndexPath,
  oneLineDescription,
  type IndexChild,
} from '../lib/notes/shared/indexNote';
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown';

type Note = { id: string; path: string; content: string };

/** Mirrors store.directChildrenOf over an in-memory note list. */
function directChildrenOf(notes: Note[], folder: string): IndexChild[] {
  const prefix = folder ? `${folder}/` : '';
  const own = indexPathOf(folder);
  const children: IndexChild[] = [];
  for (const note of notes) {
    if (note.path === own || !note.path.startsWith(prefix)) continue;
    const rel = note.path.slice(prefix.length);
    const fm = parseFrontmatter(note.content);
    const declared = String(fm.title ?? '').trim();
    const description = oneLineDescription(fm.description);
    if (!rel.includes('/')) {
      children.push({ path: note.path, title: declared || rel.replace(/\.md$/i, ''), description });
    } else if (rel.split('/').length === 2 && isIndexPath(rel)) {
      children.push({ path: note.path, title: declared || humanizeFolderName(rel.split('/')[0]), description, folder: true });
    }
  }
  return children;
}

/**
 * Fold every index's hand-written child listing into its block, writing the
 * descriptions those lines carried onto the children first. Direct row
 * updates — this is shape, not authorship — followed by the refresh below,
 * which renders the block from the (now described) children.
 */
async function foldListings(context: Context, notes: Note[]): Promise<number> {
  let folded = 0;
  const byPath = new Map(notes.map((n) => [n.path, n]));
  for (const note of notes) {
    if (!isIndexPath(note.path)) continue;
    const folder = note.path.slice(0, Math.max(0, note.path.length - 'index.md'.length - 1));
    const { content, descriptions } = foldCuratedChildren(note.content, directChildrenOf(notes, folder));
    if (content === note.content) continue;
    for (const [childPath, description] of descriptions) {
      const child = byPath.get(childPath);
      if (!child) continue;
      const fm = parseFrontmatter(child.content);
      if (oneLineDescription(fm.description)) continue;
      const next = joinFrontmatter({ ...fm, description }, splitFrontmatter(child.content).body);
      await prisma.contextNote.update({ where: { id: child.id }, data: { content: next } });
      child.content = next;
    }
    await prisma.contextNote.update({ where: { id: note.id }, data: { content } });
    note.content = content;
    folded += 1;
    console.log(`  folded ${note.path} (${descriptions.size} descriptions moved)`);
  }
  return folded;
}

const INDEX_ACTOR: Actor = { id: 'system', name: 'Index maintenance' };

async function main() {
  const only = process.argv[2];
  const where = only ? { spaceId: only } : {};

  const noteContexts = await prisma.contextNote.groupBy({
    by: ['spaceId', 'ownerKey'],
    where: { ...where, deletedAt: null },
  });
  const folderContexts = await prisma.contextFolder.groupBy({
    by: ['spaceId', 'ownerKey'],
    where,
  });
  const contexts = new Map<string, Context>();
  for (const b of [...noteContexts, ...folderContexts]) {
    contexts.set(`${b.spaceId} ${b.ownerKey}`, { spaceId: b.spaceId, ownerKey: b.ownerKey });
  }
  if (only && contexts.size === 0) throw new Error(`No notes found for space: ${only}`);

  for (const context of contexts.values()) {
    const notes: Note[] = await prisma.contextNote.findMany({
      where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: null },
      select: { id: true, path: true, content: true },
    });
    const explicit = await prisma.contextFolder.findMany({
      where: { spaceId: context.spaceId, ownerKey: context.ownerKey },
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
      await createFolder(context, folder, INDEX_ACTOR);
      created += 1;
      console.log(`  created ${indexPathOf(folder)}`);
    }
    // Hand-written listings fold into the block before it is rendered.
    const folded = await foldListings(context, notes);
    // Then hold every index to the shape — including the ones just created,
    // whose children may have arrived out of order above. '' is the context
    // root, a folder like any other.
    for (const folder of ordered) await refreshFolderIndex(context, folder);
    await refreshFolderIndex(context, '');
    console.log(
      `${context.spaceId} [${context.ownerKey}]: ${folders.size} folders, ${created} indexes created, ${folded} listings folded`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
