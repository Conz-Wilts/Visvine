/**
 * Derive memories: extract one-sentence claims from every note that has none
 * (or whose claims are from an older save), then embed them. Thin wrapper over
 * lib/notes/memorySweep.ts — the nightly maintenance run uses the same sweep.
 *
 * Bounded per run (50 notes); run it again until `remaining` is 0.
 *
 * Usage:
 *   pnpm --filter @visvine/web db:memories              # all contexts
 *   pnpm --filter @visvine/web db:memories <spaceId>    # one space
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import { aiConfigured } from '../lib/notes/ai';
import { memorySweep } from '../lib/notes/memorySweep';

async function main() {
  if (!aiConfigured()) {
    console.error('GEMINI_API_KEY is not set — nothing to extract. Set it and re-run.');
    process.exit(1);
  }
  const only = process.argv[2];
  console.log(`Deriving memories${only ? ` for ${only}` : ' (all spaces)'}…`);
  const r = await memorySweep(only);
  console.log(
    `Done: ${r.notes} notes read, ${r.claims} claims stored, ${r.embedded} embedded, ` +
      `${r.pruned} orphan(s) pruned, ${r.remaining} note(s) still to do.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
