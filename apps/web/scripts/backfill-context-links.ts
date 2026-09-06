/**
 * Backfill: derive 'mentioned' directory links (origin 'context') from the
 * [[mentions]] in every existing entity context note (people/… & companies/…,
 * shared contexts). New/edited notes sync live via lib/notes/store.ts; this
 * catches notes written before context-driven links existed.
 *
 * Idempotent: re-running re-derives the same link set (upsertLink dedups on
 * pairKey+relationship, and stale context rows are cleaned per note).
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-context-links.ts                 # all spaces
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-context-links.ts <spaceId>   # one space
 *   … --reasons   also generate AI reason phrases for the links (needs OPENROUTER_API_KEY)
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { backfillContextLinks, CONTEXT_ORIGIN } from '../lib/notes/entityLinks';
import { generateLinkReasons } from '../lib/notes/linkReasons';
import { aiConfigured } from '../lib/notes/ai';

async function main() {
  const args = process.argv.slice(2);
  const reasons = args.includes('--reasons');
  const only = args.find((a) => !a.startsWith('--'));
  if (reasons && !aiConfigured()) throw new Error('--reasons needs OPENROUTER_API_KEY set.');
  const spaces = only
    ? await prisma.space.findMany({ where: { id: only }, select: { id: true, name: true } })
    : await prisma.space.findMany({ select: { id: true, name: true } });
  if (only && spaces.length === 0) throw new Error(`Space not found: ${only}`);

  for (const space of spaces) {
    const processed = await backfillContextLinks(space.id);
    if (processed === 0) continue;
    const total = await prisma.link.count({
      where: { spaceId: space.id, origin: CONTEXT_ORIGIN },
    });
    console.log(`${space.name} (${space.id}): ${processed} entity notes → ${total} context links`);
    if (reasons) {
      const res = await generateLinkReasons(space.id);
      console.log(`  reasons: ${res.updated} written of ${res.considered} pending`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
