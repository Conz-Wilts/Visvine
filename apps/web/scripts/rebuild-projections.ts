/**
 * Replay tier 1 and rebuild every projection it implies.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/rebuild-projections.ts [--space <id>] [--dry]
 *
 * The operational form of docs/data-architecture.md's claim that a projection is
 * "rebuildable by replaying tier 1". Use it after restoring a backup, after
 * changing how a projection is derived, or when derived state is suspected of
 * having drifted.
 *
 * It is also the ONLY thing that can repair drift from before the outbox
 * existed: a write that lost its side effects in 2026 left no job row behind, so
 * there is nothing for the drain to find. This walks the notes themselves.
 *
 * Safe to re-run: every projection on the path is idempotent, and the replay is
 * stamped `maintenance` so rebuilding state can never trip the agent hook's
 * "a human edited my brief" rule and deactivate a live agent.
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { drainProjections, projectionBacklog, reconcileContext } from '../lib/notes/projections'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const only = arg('space')
  const dry = process.argv.includes('--dry')

  const before = await projectionBacklog()
  console.log(
    `Outbox backlog: ${before.pending} pending, ${before.failing} with failures` +
      (before.oldestMs ? `, oldest ${Math.round(before.oldestMs / 1000)}s old` : ''),
  )

  if (dry) {
    const contexts = await distinctContexts(only)
    console.log(`Would reconcile ${contexts.length} context(s).`)
    for (const c of contexts) console.log(`  ${c.spaceId} / ${c.ownerKey}`)
    return
  }

  // Retry what the outbox already knows is owed before walking everything: it is
  // far cheaper, and it clears the backlog the reconcile would otherwise redo.
  const drained = await drainProjections(1000)
  console.log(
    `Drained: ${drained.claimed} claimed, ${drained.succeeded} ok, ${drained.failed} failed, ${drained.parked} parked.`,
  )

  const contexts = await distinctContexts(only)
  console.log(`Reconciling ${contexts.length} context(s)…`)

  let notes = 0
  let failed = 0
  for (const context of contexts) {
    const report = await reconcileContext(context)
    notes += report.notes
    failed += report.failed
    const label = `${context.spaceId}/${context.ownerKey}`
    console.log(`  ${label}: ${report.notes} notes${report.failed ? `, ${report.failed} FAILED` : ''}`)
    for (const e of report.errors.slice(0, 5)) console.log(`      ${e.path}: ${e.error}`)
  }

  console.log(`\nDone: ${notes} notes replayed, ${failed} failures.`)
  const after = await projectionBacklog()
  console.log(`Outbox backlog now: ${after.pending} pending, ${after.failing} with failures.`)
}

/** Every (spaceId, ownerKey) that holds at least one live note. */
async function distinctContexts(only?: string): Promise<{ spaceId: string; ownerKey: string }[]> {
  const rows = await prisma.contextNote.findMany({
    where: { deletedAt: null, ...(only ? { spaceId: only } : {}) },
    select: { spaceId: true, ownerKey: true },
    distinct: ['spaceId', 'ownerKey'],
    orderBy: [{ spaceId: 'asc' }, { ownerKey: 'asc' }],
  })
  return rows
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
