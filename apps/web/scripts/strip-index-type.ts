/**
 * One-shot backfill: take `type: Index` out of every stored note.
 *
 * A folder is a PATH — its `index.md` — and a note's `type:` says what it is
 * ABOUT (lib/notes/shared/indexNote.ts). Notes written before that split carry
 * `type: Index` in their frontmatter, which db:notes:verify rule 1 now reports.
 * This rewrites them through the same contract every live write goes through,
 * so an entity folder's index keeps its entity type and `node:` while an
 * ordinary folder simply loses a field it never needed.
 *
 * Writes go through writeNote, so each rewrite keeps its previous content as a
 * baseline revision. Re-running is a no-op. Local-only, guarded like the
 * destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/strip-index-type.ts            # all contexts
 *   pnpm --filter @visvine/web exec tsx scripts/strip-index-type.ts <spaceId>  # one space
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { writeNote, type Actor, type Context } from '../lib/notes/store';
import { declaresIndexType } from '../lib/notes/shared/indexNote';
import { parseFrontmatter, joinFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown';

const ACTOR: Actor = { id: 'system', name: 'Index maintenance' };

/** Drop the `type:` key, leaving the rest of the frontmatter and body as they are. */
function withoutType(content: string): string {
  const { type: _dropped, ...rest } = parseFrontmatter(content);
  return joinFrontmatter(rest, splitFrontmatter(content).body);
}

async function main() {
  const only = process.argv[2];
  const notes = await prisma.contextNote.findMany({
    where: { ...(only ? { spaceId: only } : {}), deletedAt: null },
    select: { spaceId: true, ownerKey: true, path: true, content: true },
  });

  let fixed = 0;
  for (const note of notes) {
    if (!declaresIndexType(note.content)) continue;
    const context: Context = { spaceId: note.spaceId, ownerKey: note.ownerKey };
    // The contract runs inside writeNote: at an index path it restores whatever
    // the folder actually owes (a title, and an entity's type and `node:`), so
    // stripping the field here can never leave an entity folder untyped.
    await writeNote(context, note.path, withoutType(note.content), ACTOR, 'maintenance');
    fixed += 1;
    console.log(`  ${note.spaceId} [${note.ownerKey}] ${note.path}`);
  }
  console.log(`${fixed} note(s) rewritten across ${notes.length} scanned`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
