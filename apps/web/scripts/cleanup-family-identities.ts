/**
 * Fold people recorded before the family identity rule (lib/identity/family.ts):
 * every person node gets an identity, and one person held under several
 * identities across a house and its rooms becomes one. Then rebuilds the
 * Visvine records the change touched. Idempotent.
 *
 * Usage: pnpm --filter @visvine/web db:identity:family [--dry]
 */

import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { cleanupFamilyIdentities } from '../lib/identity/familyCleanup'
import { rebuildGlobalRecords } from '../lib/global/record'

async function main() {
  const dryRun = process.argv.includes('--dry')
  const result = await cleanupFamilyIdentities({ dryRun })
  const count = (kind: string) => result.plan.filter((s) => s.kind === kind).length
  if (dryRun) {
    console.log(`Plan: ${count('attach')} attach, ${count('merge')} merge, ${count('resolve')} resolve.`)
  } else {
    console.log(`Attached ${result.attached}, merged ${result.merged}, resolved ${result.resolved}, dropped ${result.identitiesDropped} identit(ies).`)
    const records = await rebuildGlobalRecords()
    console.log(`Visvine: ${records.records} record(s) from ${records.identities} identit(ies).`)
  }
  for (const s of result.skipped) console.log(`  left alone: ${s.name} (${s.space}) — ${s.reason}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
