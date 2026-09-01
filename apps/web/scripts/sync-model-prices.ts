/**
 * Refresh agent_model_prices from the public catalogues (OpenRouter's models
 * API, LiteLLM's community price map). Thin wrapper over lib/agents/prices.ts —
 * the nightly maintenance run does the same sync.
 *
 * Usage:
 *   pnpm --filter @visvine/web db:prices
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import { syncModelPrices } from '../lib/agents/prices';

async function main() {
  console.log('Syncing model prices from OpenRouter and LiteLLM…');
  const r = await syncModelPrices();
  const total = await prisma.agentModelPrice.count();
  console.log(`Done: ${r.openrouter} OpenRouter row(s), ${r.litellm} LiteLLM row(s); ${total} in the table.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
