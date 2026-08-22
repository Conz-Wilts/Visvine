/**
 * Rebuild every Visvine global record from its public sources
 * (lib/global/record.ts#rebuildGlobalRecords). Idempotent — run it after
 * hand-editing a seed layer, flipping a space public, or a backfill of
 * identities. Local-only, like the other db:* scripts.
 *
 * Usage: pnpm --filter @visvine/web db:global:rebuild
 */

import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { rebuildGlobalRecords } from '../lib/global/record'

async function main() {
  const result = await rebuildGlobalRecords()
  console.log(`Visvine: ${result.records} record(s) from ${result.identities} identit(ies).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
