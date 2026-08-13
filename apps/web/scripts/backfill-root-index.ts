/**
 * Backfill: ensure every space's context has a ROOT index.md — the context's
 * home page.
 *
 * Why this is a separate backfill from backfill-index-notes.ts: that one uses
 * ensureAncestorIndexes, which can never create the root index
 * (ancestorFolders('index.md') is [] — the root isn't a folder anyone nests
 * under), and rebuild-index-notes.ts deliberately leaves a blockless root alone.
 * So the root is the one index nothing creates retroactively.
 *
 * It matters because the Directory's Context tab routes to the root index —
 * the space's home page (see app/(auth)/directory/page.tsx, which also
 * writes one on first open for contexts that lack it). New spaces get
 * theirs at creation via ensureRootIndex; this catches the ones made before
 * that, in bulk.
 *
 * Covers every Space row, personal `me:<userId>` spaces included, and reads
 * the title from the space's name. Idempotent: a context that already has a
 * root index is skipped, so re-running creates nothing.
 *
 * NOT local-guarded, unlike the db:* scripts — production is exactly where it
 * needs to run. The safety is a dry run by default: it prints the target host
 * and every context it would touch, and only writes when passed --apply.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-root-index.ts           # dry run
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-root-index.ts --apply   # write
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-root-index.ts --apply <spaceId>
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import { ensureRootIndex, SHARED_OWNER_KEY, readNoteOrNull, type Actor } from '../lib/notes/store';
import { INDEX_BASENAME } from '../lib/notes/shared/indexNote';

const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Index maintenance' };

/** Host only — never print credentials from the connection string. */
function targetHost(): string {
  const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '';
  if (!url) return 'discrete DB_HOST parts / default localhost';
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const only = args.find((a) => !a.startsWith('--'));

  const spaces = await prisma.space.findMany({
    where: only ? { id: only } : {},
    select: { id: true, name: true, personalOwnerId: true },
    orderBy: { id: 'asc' },
  });
  if (only && spaces.length === 0) throw new Error(`No such space: ${only}`);

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} → ${targetHost()}`);
  console.log(`${spaces.length} space${spaces.length === 1 ? '' : 's'}\n`);

  let missing = 0;
  let created = 0;
  for (const c of spaces) {
    const context = { spaceId: c.id, ownerKey: SHARED_OWNER_KEY };
    if (await readNoteOrNull(context, INDEX_BASENAME)) continue;
    missing++;
    const kind = c.personalOwnerId ? 'personal' : 'space';
    if (!apply) {
      console.log(`would create  ${c.id} [${kind}] — title ${JSON.stringify(c.name)}`);
      continue;
    }
    // Best-effort per space: one bad context must not strand the rest.
    try {
      if (await ensureRootIndex(context, c.name, SYSTEM_ACTOR)) {
        created++;
        console.log(`created       ${c.id} [${kind}]`);
      }
    } catch (err) {
      console.error(`FAILED        ${c.id} [${kind}]:`, err);
      process.exitCode = 1;
    }
  }

  console.log(
    `\n${missing} missing a root index; ${apply ? `${created} created` : 'run again with --apply to create them'}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
