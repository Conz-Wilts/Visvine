/**
 * `pnpm db:seed` — rebuild the local database as the Visvine HQ demo space.
 *
 * WIPES the local database, then builds everything in one pass, in the order a
 * space is actually lived in:
 *
 *   1. base        the anchor users, Visvine HQ and its three rooms, provisioned
 *                  the way the app provisions a space, then configured
 *   2. directory   65 organisations and the people at them, as records
 *   3. notes       the shared context and the admin's personal one
 *   4. tools       events, channels and the Drive, each with its own notes
 *   5. connectors  the three demo connector sets and their secrets
 *   6. agents      the space's model and two agents
 *   7. global      the platform space's public records and action notes
 *   8. lived-in    the history a space accumulates: runs, queues, OAuth rows,
 *                  publications, message decorations, the audit ledger
 *
 * Every note goes through the note store, so the directory edges, folder
 * indexes, entity folders and agent state are the app's own projections — there
 * is no backfill, rebuild or migration pass afterwards to reconcile them. The
 * content lives in ./space.ts (identity), ./dataset.ts (the records),
 * ./notes.ts and ./connectors.ts; the steps in ./steps only write it.
 *
 * `pnpm db:seed` runs db:notes:verify after this, which fails the seed on a
 * structural violation.
 *
 * Local-only: guarded like every destructive db:* script. If your apps/web/.env
 * keeps CLOUD_SQL_CONNECTION_NAME for `pnpm dev:cloud`, the guard refuses —
 * run it as `CLOUD_SQL_CONNECTION_NAME= pnpm db:seed`.
 */

import './env'
import '../../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../../lib/prisma'
import { rebuildGlobalRecords } from '../../lib/global/record'
import { syncActionNotes } from '../../lib/actions/sync'
import { SHARED_OWNER_KEY } from '../../lib/notes/store'
import { personal, shared } from './notes'
import { ALIASES, ANCHORS, EDIT, SPACE_ID, SPACE_NAME, SUBSPACES } from './space'
import { anchorActor, seedBase, wipe } from './steps/base'
import { seedDirectory } from './steps/directory'
import { seedChannels, seedDrive, seedEvents } from './steps/tools'
import { seedAgents, seedConnectors, seedLivedIn } from './steps/machinery'
import { putNotes } from './write'

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  process.stdout.write(`  ${label.padEnd(12)} `)
  const result = await fn()
  const detail =
    result && typeof result === 'object'
      ? Object.entries(result as Record<string, unknown>)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ')
      : ''
  console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${detail}`)
  return result
}

async function main() {
  const t0 = Date.now()
  const admin = ANCHORS[0]
  console.log(`Seeding ${SPACE_NAME} (${SPACE_ID})`)

  await step('wipe', wipe)
  await step('base', async () => {
    await seedBase()
    return { spaces: 1 + SUBSPACES.length, users: ANCHORS.length }
  })
  await step('directory', seedDirectory)
  await step('notes', async () => ({
    shared: await putNotes({ spaceId: SPACE_ID, ownerKey: SHARED_OWNER_KEY }, shared, anchorActor(admin.id)),
    personal: await putNotes({ spaceId: SPACE_ID, ownerKey: admin.id }, personal, anchorActor(admin.id)),
  }))
  await step('events', seedEvents)
  await step('channels', seedChannels)
  await step('drive', seedDrive)
  await step('connectors', seedConnectors)
  await step('agents', seedAgents)
  await step('global', async () => {
    const records = await rebuildGlobalRecords()
    const actions = await syncActionNotes()
    return { records: records.records, 'action notes': actions.actions, 'recipe notes': actions.recipes }
  })
  await step('lived-in', async () => {
    const tally = await seedLivedIn()
    return { tables: Object.keys(tally).length, rows: Object.values(tally).reduce((a, b) => a + b, 0) }
  })

  const [nodes, links, notes] = await Promise.all([
    prisma.node.count({ where: { spaceId: SPACE_ID } }),
    prisma.link.count({ where: { spaceId: SPACE_ID } }),
    prisma.contextNote.count({ where: { spaceId: SPACE_ID, deletedAt: null } }),
  ])
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${nodes} nodes, ${links} links, ${notes} notes in ${SPACE_NAME}.`)
  console.log('\nSign in via /dev/login:')
  for (const a of ANCHORS) console.log(`  ${a.email.padEnd(20)} ${a.name} (${a.aliases.join(', ')})`)
  console.log('\nPerson aliases (Console → Types):')
  for (const a of ALIASES.filter((x) => x.nodeType === 'Person')) {
    const reach = a.system
      ? 'is admin of the space'
      : a.grants.map(([p, l]) => `${p || 'everything'} ${l === EDIT ? 'edit' : 'view'}`).join(', ') || 'nothing yet'
    console.log(`  ${a.name.padEnd(10)} ${reach}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
