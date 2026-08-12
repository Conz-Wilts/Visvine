/**
 * Backfill: derive 'mentioned' directory links (origin 'context') from the
 * [[mentions]] in every existing entity context note (people/… & companies/…,
 * shared brains). New/edited notes sync live via lib/notes/store.ts; this
 * catches notes written before context-driven links existed.
 *
 * Idempotent: re-running re-derives the same link set (upsertLink dedups on
 * pairKey+relationship, and stale context rows are cleaned per note).
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-context-links.ts                 # all communities
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-context-links.ts <communityId>   # one community
 *   … --reasons   also generate AI reason phrases for the links (needs GEMINI_API_KEY)
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
  if (reasons && !aiConfigured()) throw new Error('--reasons needs GEMINI_API_KEY set.');
  const communities = only
    ? await prisma.community.findMany({ where: { id: only }, select: { id: true, name: true } })
    : await prisma.community.findMany({ select: { id: true, name: true } });
  if (only && communities.length === 0) throw new Error(`Community not found: ${only}`);

  for (const community of communities) {
    const processed = await backfillContextLinks(community.id);
    if (processed === 0) continue;
    const total = await prisma.link.count({
      where: { communityId: community.id, origin: CONTEXT_ORIGIN },
    });
    console.log(`${community.name} (${community.id}): ${processed} entity notes → ${total} context links`);
    if (reasons) {
      const res = await generateLinkReasons(community.id);
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
