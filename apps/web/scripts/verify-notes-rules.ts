/**
 * Verify the context's structural rules — the ones the seed has to satisfy and the
 * app maintains at runtime. An index note IS a folder (see
 * lib/notes/shared/indexNote.ts), and folder-ness is the PATH — a note's `type:`
 * says what it is ABOUT. The checks below make both concrete:
 *
 *   1. no note anywhere declares `type: Index` — that names a shape, and the
 *      shape is already the path;
 *   2. every folder (note-derived or an explicit folder row) has an index;
 *   3. every `index.md` declares a title — the title is the folder's display
 *      name everywhere it is shown — and an ENTITY FOLDER's index
 *      (people/<slug>/index.md, an entity note that has become a folder, see
 *      lib/notes/entities.ts) additionally declares the entity's own type and a
 *      `node:` naming a real node of this space;
 *   4. an index's managed child block is present and current;
 *   5. a `/…​.md` link in an index body points at a note that exists;
 *   6. a node's `metadata.notePath` pointer and the entity-folder index agree:
 *      the pointer names the live index (shared context), and a live entity-
 *      folder index has a node pointing at it — drift either way is reported.
 *
 * Exits non-zero listing every violation, so it can sit at the end of the seed
 * pipeline (`pnpm db:notes:verify`) and fail a reseed that produced bad data.
 * Read-only — but local-only anyway, guarded like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/verify-notes-rules.ts                 # all contexts
 *   pnpm --filter @visvine/web exec tsx scripts/verify-notes-rules.ts <spaceId>   # one space
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
  declaresIndexType,
  isIndexPath,
  type IndexChild,
} from '../lib/notes/shared/indexNote';
import { extractMarkdownLinks, parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown';
import {
  entityFlatPath,
  entityIndexPathOf,
  entityKindOf,
  entityTypeLabelOf,
  entityTypeNamesKind,
  isEntityFolderIndex,
  isFolderOnlyEntityKind,
  parseEntityHref,
} from '../lib/notes/entities';

const SHARED_OWNER_KEY = 'shared';

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
  const where = only ? { spaceId: only } : {};

  const noteContexts = await prisma.contextNote.groupBy({
    by: ['spaceId', 'ownerKey'],
    where: { ...where, deletedAt: null },
  });
  const folderContexts = await prisma.contextFolder.groupBy({
    by: ['spaceId', 'ownerKey'],
    where,
  });
  const contexts = new Map<string, { spaceId: string; ownerKey: string }>();
  for (const b of [...noteContexts, ...folderContexts]) {
    contexts.set(`${b.spaceId} ${b.ownerKey}`, { spaceId: b.spaceId, ownerKey: b.ownerKey });
  }
  if (only && contexts.size === 0) throw new Error(`No notes found for space: ${only}`);

  const violations: string[] = [];
  let checked = 0;

  for (const context of contexts.values()) {
    const label = `${context.spaceId} [${context.ownerKey}]`;
    const notes: Note[] = await prisma.contextNote.findMany({
      where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: null },
      select: { path: true, content: true },
    });
    const explicit = await prisma.contextFolder.findMany({
      where: { spaceId: context.spaceId, ownerKey: context.ownerKey },
      select: { path: true },
    });
    const live = new Set(notes.map((n) => n.path));

    // The space's nodes, for the entity-folder checks (3 + 6): which index paths
    // are entity folders' and where each node says its note lives.
    const nodes = await prisma.node.findMany({
      where: { spaceId: context.spaceId },
      select: { id: true, type: true, metadata: true },
    });

    // A `space` node stands for a real space (docs/sub-spaces.md): its
    // metadata.spaceRef names a spaces row, and its note says the same.
    for (const n of nodes) {
      if (n.type !== 'space') continue;
      const ref = (n.metadata as Record<string, unknown> | null)?.spaceRef;
      if (typeof ref !== 'string' || !(await prisma.space.findUnique({ where: { id: ref }, select: { id: true } }))) {
        violations.push(`${label} ${n.id}: space node has no spaceRef to an existing space (run db:spaces:records)`);
      }
    }
    const nodeByIndexPath = new Map<string, { id: string; type: string; pointer: string | null }>();
    for (const n of nodes) {
      const idx = entityIndexPathOf({ id: n.id, type: n.type });
      if (!idx) continue;
      const pointer = (n.metadata as Record<string, unknown> | null)?.notePath;
      nodeByIndexPath.set(idx, { id: n.id, type: n.type, pointer: typeof pointer === 'string' ? pointer : null });
    }

    const folders = new Set<string>();
    for (const n of notes) for (const f of ancestorFolders(n.path)) folders.add(f);
    // Folder rows double as access boundaries, and a boundary can sit on a note
    // (store.listFolders drops those the same way) — only real folders count.
    for (const f of explicit) {
      if (f.path.endsWith('.md')) continue;
      for (const a of ancestorFolders(indexPathOf(f.path))) folders.add(a);
    }

    // 1 + 3: `Index` is nobody's type, and every folder's index names itself.
    for (const note of notes) {
      checked += 1;
      // A folder is a PATH. `type:` says what a note is about, so the word
      // Index has no business in any note's frontmatter — the contract strips
      // it on write, and anything that got in another way shows up here.
      if (declaresIndexType(note.content)) {
        violations.push(`${label} ${note.path}: declares type Index — a folder is its path, not a type`);
      }
      if (isIndexPath(note.path)) {
        const owner = isEntityFolderIndex(note.path) ? nodeByIndexPath.get(note.path) : undefined;
        if (owner) {
          // An entity folder's index IS the entity note: entity type + node:.
          const fm = parseFrontmatter(note.content);
          const wantType = entityTypeLabelOf(owner.type) ?? '';
          const gotType = typeof fm.type === 'string' ? fm.type.trim() : '';
          if (!entityTypeNamesKind(gotType, owner.type)) {
            violations.push(
              `${label} ${note.path}: an entity folder's index must keep the entity type "${wantType}" (found "${gotType || 'nothing'}")`,
            );
          }
          if (fm.node !== owner.id) {
            violations.push(`${label} ${note.path}: node: must name its entity (${owner.id}; found "${fm.node ?? 'nothing'}")`);
          }
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

    // 6: a folder-only entity's note is its folder — the flat path may hold
    // nothing (any context, the alias never lives anywhere).
    for (const owner of nodeByIndexPath.values()) {
      if (!isFolderOnlyEntityKind(entityKindOf(owner.type))) continue;
      const flat = entityFlatPath({ id: owner.id, type: owner.type });
      if (flat && live.has(flat)) {
        violations.push(`${label} ${owner.id}: ${flat} is live but a ${owner.type} is a folder (run db:entities:folders)`);
      }
    }

    // 6b: for the kinds that convert lazily, the node pointer and the
    // entity-folder index agree (shared context only — the pointer is node
    // state, and there is one node).
    if (context.ownerKey === SHARED_OWNER_KEY) {
      for (const [idx, owner] of nodeByIndexPath) {
        if (isFolderOnlyEntityKind(entityKindOf(owner.type))) continue;
        const indexLive = live.has(idx);
        const flat = entityFlatPath({ id: owner.id, type: owner.type });
        if (owner.pointer === idx && !indexLive) {
          violations.push(`${label} ${owner.id}: metadata.notePath → ${idx} but no such note is live`);
        }
        if (indexLive && owner.pointer !== idx) {
          violations.push(
            `${label} ${owner.id}: ${idx} is live but metadata.notePath is ${owner.pointer ? `"${owner.pointer}"` : 'unset'}`,
          );
        }
        if (indexLive && flat && live.has(flat)) {
          violations.push(`${label} ${owner.id}: both ${flat} and ${idx} are live — one entity, one note`);
        }
      }
    }

    // 5: index bodies are navigation — a dead link in one is a dead end.
    for (const note of notes) {
      if (!isIndexPath(note.path)) continue;
      for (const href of extractMarkdownLinks(splitFrontmatter(note.content).body)) {
        if (!href.startsWith('/') || !href.toLowerCase().endsWith('.md')) continue;
        const target = href.slice(1);
        if (live.has(target)) continue;
        // An entity link is good in either form — the note may have become
        // its folder's index since the link was written (or the reverse).
        if (parseEntityHref(target)) {
          const other = isIndexPath(target)
            ? target.replace(/\/index\.md$/i, '.md')
            : target.replace(/\.md$/i, '/index.md');
          if (live.has(other)) continue;
        }
        violations.push(`${label} ${note.path}: dead link → ${href}`);
      }
    }
  }

  if (violations.length === 0) {
    console.log(`notes rules OK — ${checked} notes across ${contexts.size} contexts`);
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
