/**
 * Backfill the retrieval embeddings: every note vector, and any source chunk
 * that was stored without one. Thin wrapper over lib/notes/embedSweep.ts —
 * the nightly maintenance run (lib/notes/nightly.ts) uses the same sweep.
 *
 * Run this once after turning OPENAI_API_KEY on (or rotating EMBED_MODEL):
 * it makes the first real searches fast and makes old uploads findable.
 * Idempotent — see embedSweep.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/embed-context.ts                 # all brains
 *   pnpm --filter @visvine/web exec tsx scripts/embed-context.ts <spaceId>   # one space
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import { embeddingsConfig } from '../lib/notes/embeddings';
import { embedSweep } from '../lib/notes/embedSweep';

async function main() {
  const config = embeddingsConfig();
  if (!config) {
    console.error('OPENAI_API_KEY is not set — nothing to embed. Set it and re-run.');
    process.exit(1);
  }
  const only = process.argv[2];
  console.log(`Embedding with ${config.model}${only ? ` for ${only}` : ' (all spaces)'}…`);
  const result = await embedSweep(only);
  console.log(`Done: ${result.notes} notes, ${result.chunks} source chunks.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
