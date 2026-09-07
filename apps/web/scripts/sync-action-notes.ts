/**
 * Render the shipped action and recipe catalogues into the Visvine space's Context
 * (lib/actions/sync.ts).
 *
 * Idempotent: the generated contract block in each note is replaced, and
 * everything a maintainer wrote around it is kept. Local-only, like the other
 * db:* scripts; `pnpm db:seed` already calls `syncActionNotes` itself, so this
 * is for re-rendering after a change without reseeding.
 *
 * It is an ENHANCEMENT, not a prerequisite. A deployment with no notes still
 * answers every plan from the shipped catalogue in code; syncing is what makes
 * that content editable in the app, by the admin of the Visvine space.
 *
 * Usage: pnpm --filter @visvine/web db:actions:sync
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { syncActionNotes } from '../lib/actions/sync'

async function main() {
  const { actions, recipes, guides } = await syncActionNotes()
  console.log(`Visvine Context: ${actions} action note(s), ${recipes} recipe note(s), ${guides} new guide(s).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
