/**
 * Verify the brain's structural rules — the ones the seed has to satisfy and the
 * app maintains at runtime. An index note IS a folder (see
 * lib/notes/shared/indexNote.ts), which the checks below make concrete:
 *
 *   1. a `type: Index` note lives at an `index.md` path — nothing else claims
 *      the type;
 *   2. every folder (note-derived or an explicit folder row) has an index;
 *   3. every `index.md` declares `type: Index` and a title — the title is the
 *      folder's display name everywhere it is shown;
 *   4. an index's managed child block is present and current;
 *   5. a `/…​.md` link in an index body points at a note that exists.
 *
 * Exits non-zero listing every violation, so it can sit at the end of the seed
 * pipeline (`pnpm db:notes:verify`) and fail a reseed that produced bad data.
 * Read-only — but local-only anyway, guarded like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/verify-notes-rules.ts                 # all brains
 *   pnpm --filter @visvine/web exec tsx scripts/verify-notes-rules.ts <communityId>   # one community
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import {
  ancestorFolders,
  applyChildrenBlock,
  hasChildrenBlock,
  humanizeFolderName,
  indexPathOf,
  isIndexContent,
  isIndexPath,
  type IndexChild,
} from '../lib/notes/shared/indexNote';
import { extractMarkdownLinks, parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown';

interface Note {
  path: string;
  content: string;
}

function titleOf(content: string): string {
  return String(parseFrontmatter(content).title ?? '').trim();
}

/** Mirrors store.directChildrenOf: direct notes plus direct subfolder indexes. */
function directChildrenOf(notes: Note[], folder: string): IndexChild[] {
  const prefix = folder ? `${folder}/` : '';
  const own = indexPathOf(folder);
  const children: IndexChild[] = [];
  for (const note of notes) {
    if (note.path === own || !note.path.startsWith(prefix)) continue;
    const rel = note.path.slice(prefix.length);
    const declared = titleOf(note.content);
    if (!rel.includes('/')) {
      children.push({ path: note.path, title: declared || rel.replace(/\.md$/i, '') });
    } else if (rel.split('/').length === 2 && isIndexPath(rel)) {
      children.push({ path: note.path, title: declared || humanizeFolderName(rel.split('/')[0]) });
    }
  }
  return children;
}

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
  const brains = new Map<string, { communityId: string; ownerKey: string }>();
  for (const b of [...noteBrains, ...folderBrains]) {
    brains.set(`${b.communityId} ${b.ownerKey}`, { communityId: b.communityId, ownerKey: b.ownerKey });
  }
  if (only && brains.size === 0) throw new Error(`No notes found for community: ${only}`);

  const violations: string[] = [];
  let checked = 0;

  for (const brain of brains.values()) {
    const label = `${brain.communityId} [${brain.ownerKey}]`;
    const notes: Note[] = await prisma.communityNote.findMany({
      where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: null },
      select: { path: true, content: true },
    });
    const explicit = await prisma.communityNoteFolder.findMany({
      where: { communityId: brain.communityId, ownerKey: brain.ownerKey },
      select: { path: true },
    });
    const live = new Set(notes.map((n) => n.path));

    const folders = new Set<string>();
    for (const n of notes) for (const f of ancestorFolders(n.path)) folders.add(f);
    // Folder rows double as access boundaries, and a boundary can sit on a note
    // (store.listFolders drops those the same way) — only real folders count.
    for (const f of explicit) {
      if (f.path.endsWith('.md')) continue;
      for (const a of ancestorFolders(indexPathOf(f.path))) folders.add(a);
    }

    // 1 + 3: the type and the path agree, and an index carries a display name.
    for (const note of notes) {
      checked += 1;
      if (isIndexContent(note.content) && !isIndexPath(note.path)) {
        violations.push(`${label} ${note.path}: type Index but not a folder's index.md`);
      }
      if (isIndexPath(note.path)) {
        if (!isIndexContent(note.content)) {
          violations.push(
            `${label} ${note.path}: an index.md must declare type: Index (found "${parseFrontmatter(note.content).type ?? 'nothing'}")`,
          );
        }
        if (!titleOf(note.content)) {
          violations.push(`${label} ${note.path}: no title — the title is the folder's display name`);
        }
      }
    }

    // 2 + 4: every folder has an index, and its child block is current.
    for (const folder of [...folders].sort()) {
      const idx = indexPathOf(folder);
      const note = notes.find((n) => n.path === idx);
      if (!note) {
        violations.push(`${label} ${folder}/: folder has no index.md`);
        continue;
      }
      if (!hasChildrenBlock(note.content)) {
        violations.push(`${label} ${idx}: no managed child block (run db:index-notes:rebuild)`);
        continue;
      }
      if (applyChildrenBlock(note.content, directChildrenOf(notes, folder)) !== note.content) {
        violations.push(`${label} ${idx}: child block is stale (run db:index-notes:rebuild)`);
      }
    }

    // 5: index bodies are navigation — a dead link in one is a dead end.
    for (const note of notes) {
      if (!isIndexPath(note.path)) continue;
      for (const href of extractMarkdownLinks(splitFrontmatter(note.content).body)) {
        if (!href.startsWith('/') || !href.toLowerCase().endsWith('.md')) continue;
        const target = href.slice(1);
        if (!live.has(target)) violations.push(`${label} ${note.path}: dead link → ${href}`);
      }
    }
  }

  if (violations.length === 0) {
    console.log(`notes rules OK — ${checked} notes across ${brains.size} brains`);
    return;
  }
  console.error(`${violations.length} violation(s):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
