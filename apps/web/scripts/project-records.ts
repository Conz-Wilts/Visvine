/**
 * Project every note that declares one of a space's invented types into
 * `context_records` / `context_record_fields` (lib/records/projection.ts).
 *
 *   pnpm --filter @visvine/web db:records:project [--space <id>]
 *
 * Every write projects its own note, and a type's fields changing re-reads that
 * type; this is for notes written before the records layer existed. Lighter
 * than `db:projections:rebuild`, which replays every projection of every note
 * and covers this too. Safe to re-run: the projection is idempotent.
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { reprojectSpace } from '../lib/records/projection'

async function main(): Promise<void> {
  const at = process.argv.indexOf('--space')
  const only = at === -1 ? undefined : process.argv[at + 1]
  const spaces = await prisma.space.findMany({ where: only ? { id: only } : {}, select: { id: true } })
  let total = 0
  for (const space of spaces) {
    const projected = await reprojectSpace(space.id)
    if (projected) console.log(`${space.id}: ${projected} record(s)`)
    total += projected
  }
  console.log(`Projected ${total} record(s) across ${spaces.length} space(s).`)
  await prisma.$disconnect()
}

void main()
