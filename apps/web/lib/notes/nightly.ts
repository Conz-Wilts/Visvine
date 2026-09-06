// Nightly maintenance: the two AI catch-up sweeps, run together while nobody's
// awake — the retrieval-embedding sweep (lib/notes/embedSweep.ts) and the
// link-reason pass (lib/notes/linkReasons.ts). Both are idempotent (mtime /
// reasonHash gated), so a re-run, an overlap with the live fire-and-forget
// triggers, or two server instances racing are all harmless — just wasted reads.
//
// WHAT FIRES IT depends on the runtime, and the distinction matters — see
// shared/nightly.ts#nightlyDriver. On a long-lived server the schedule lives
// in-process: instrumentation.ts calls startNightlySchedule() once per server
// start and a setTimeout chain fires at NIGHTLY_MAINTENANCE_HOUR (server-local,
// default 3am). On Cloud Run, which scales to zero, that timer would mostly
// never fire — nobody is awake at 3am, which is the entire premise — so Cloud
// Scheduler POSTs /api/internal/maintenance/nightly instead and this file's
// startNightlySchedule() deliberately arms nothing.
//
// Production-only by default so a dev server left running doesn't spend API
// tokens overnight; NIGHTLY_MAINTENANCE=on|off overrides either way, and
// NIGHTLY_MAINTENANCE_DRIVER=in-process|scheduler overrides who fires it.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { aiConfigured } from '@/lib/notes/ai'
import { embedSweep } from '@/lib/notes/embedSweep'
import { memorySweep } from '@/lib/notes/memorySweep'
import { generateLinkReasons } from '@/lib/notes/linkReasons'
import { drainProjections, projectionBacklog } from '@/lib/notes/projections'
import { pruneRateLimits } from '@/lib/rateLimit'
import { msUntilNextRun, nightlyDriver, nightlyRunHour } from './shared/nightly'

let sweeping = false

/**
 * One full maintenance pass over every space: embeddings first (search
 * freshness benefits everyone), then link reasons. Each stage keys off its own
 * env (OPENROUTER_API_KEY) and skips silently when unkeyed, so
 * partial configuration runs whatever it can.
 */
export async function runNightlyMaintenance(): Promise<{ ran: boolean; ms: number }> {
  // Concurrency guard for THIS process only. Cross-instance overlap stays
  // harmless by design (every stage is mtime/hash gated) and the scheduler
  // driver makes it rare rather than relying on it.
  if (sweeping) return { ran: false, ms: 0 }
  sweeping = true
  const startedAt = Date.now()
  try {
    // The action notes, cheaply: ~40 idempotent writes that keep the Visvine
    // catalogue in step with the actions this release actually has. It lives
    // here rather than in the release because a scale-to-zero runtime has no
    // deploy hook to hang it on, and because the surface does not depend on it —
    // un-synced notes cost the EDITABLE half of the documentation, never the
    // ability to route or run (lib/actions/notes.ts).
    try {
      const { syncActionNotes } = await import('@/lib/actions/sync')
      const synced = await syncActionNotes()
      logger.info('notes.nightly.action_notes', { actions: synced.actions, recipes: synced.recipes })
    } catch (err) {
      logger.warn('notes.nightly.action_notes_failed', { err })
    }
    // Model prices, from the public catalogues. The fetched tier of the
    // pricing chain (lib/agents/prices.ts): without it any model outside the
    // registry meters in tokens only. Needs no API key, and a catalogue being
    // down costs freshness, never the sweep.
    try {
      const { syncModelPrices } = await import('@/lib/agents/prices')
      const prices = await syncModelPrices()
      logger.info('notes.nightly.model_prices', prices)
    } catch (err) {
      logger.warn('notes.nightly.model_prices_failed', { err })
    }
    // Drain before the sweeps, and unconditionally: they read derived state, so
    // running them over projections that were never rebuilt would embed the
    // staleness (an un-synced mention has no edge for the link-reason pass to
    // explain). Unlike the two AI stages this needs no API key.
    const drained = await drainProjections(500)
    const backlog = await projectionBacklog()
    if (drained.claimed || backlog.pending) {
      logger.info('notes.nightly.projections', { ...drained, ...backlog })
    }
    // Not gated on a key any more. embedSweep no-ops its embedding half when
    // there is none, but its ORPHAN PRUNE has to run regardless: a space that
    // never had a key, or had one removed, still deletes and renames notes, and
    // its stranded vectors would otherwise have nothing that ever collects them.
    const embedded = await embedSweep()
    if (embedded.notes || embedded.noteChunks || embedded.chunks || embedded.pruned || embedded.skippedSpaces) {
      logger.info('notes.nightly.embeddings', {
        configured: embedded.configured,
        notes: embedded.notes,
        chunkedNotes: embedded.chunkedNotes,
        noteChunks: embedded.noteChunks,
        chunks: embedded.chunks,
        pruned: embedded.pruned,
        skippedSpaces: embedded.skippedSpaces,
      })
    }
    // The derived memories, after the note vectors: bounded to 50 extractions
    // a night, so a large backlog catches up over nights. Its orphan prune runs
    // regardless of a key, like embedSweep's.
    try {
      const memories = await memorySweep()
      if (memories.notes || memories.embedded || memories.pruned || memories.remaining) {
        logger.info('notes.nightly.memories', {
          configured: memories.configured,
          notes: memories.notes,
          claims: memories.claims,
          embedded: memories.embedded,
          remaining: memories.remaining,
          pruned: memories.pruned,
        })
      }
    } catch (err) {
      logger.error('notes.nightly.memories_failed', { err })
    }
    // Reconcile object storage against the database — REPORT ONLY, never
    // deleting. The eager purge (lib/storage/purge.ts) cannot be a guarantee:
    // there is no two-phase commit between Postgres and GCS, so a delete can
    // always be lost to a crash or a bucket blip. Running the comparison nightly
    // is what makes the resulting drift visible instead of discovered. Deleting
    // stays a deliberate human act — `pnpm db:gc:objects --apply` — because a
    // sweep that deletes unattended is one bad predicate away from data loss.
    if (process.env.GCS_RESOURCES_BUCKET || process.env.GCS_MEDIA_BUCKET) {
      try {
        const { findOrphanObjects } = await import('@/lib/storage/audit')
        const audit = await findOrphanObjects()
        if (audit.orphans.length > 0 || audit.unrecognised.length > 0) {
          logger.warn('notes.nightly.storage_drift', {
            orphans: audit.orphans.length,
            bytes: audit.bytes,
            unrecognised: audit.unrecognised.length,
            scanned: audit.scanned,
            hint: 'run `pnpm db:gc:objects` to see them, `--apply` to delete',
          })
        } else {
          logger.info('notes.nightly.storage_ok', { scanned: audit.scanned })
        }
      } catch (err) {
        // A bucket being unreachable must not take the rest of the sweep with it.
        logger.error('notes.nightly.storage_audit_failed', { err })
      }
    }

    // Rate-limit buckets are keyed by caller (an IP, an email), so the table's
    // key space is open-ended. A bucket idle long enough to have refilled to
    // full carries no state worth keeping, so this is pure reclamation — the
    // opportunistic sweep in lib/rateLimit.ts handles the hot path, this is the
    // backstop for a quiet table nobody is taking from.
    const prunedBuckets = await pruneRateLimits().catch((err) => {
      logger.error('notes.nightly.rate_limit_prune_failed', { err })
      return 0
    })
    if (prunedBuckets) logger.info('notes.nightly.rate_limits', { pruned: prunedBuckets })

    // An authorization code lives five minutes and is single-use; a row past
    // that is a record of nothing. Swept an hour late so a code still being
    // exchanged at the boundary is never pulled from under the exchange.
    const prunedCodes = await prisma.oAuthAuthCode
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } })
      .then((r) => r.count)
      .catch((err) => {
        logger.error('notes.nightly.auth_code_prune_failed', { err })
        return 0
      })
    if (prunedCodes) logger.info('notes.nightly.auth_codes', { pruned: prunedCodes })

    if (aiConfigured()) {
      const spaces = await prisma.space.findMany({ select: { id: true } })
      let updated = 0
      let considered = 0
      for (const space of spaces) {
        const res = await generateLinkReasons(space.id)
        updated += res.updated
        considered += res.considered
      }
      logger.info('notes.nightly.linkReasons', { updated, considered })
    }
    logger.info('notes.nightly.done', { ms: Date.now() - startedAt })
  } catch (err) {
    logger.error('notes.nightly.failed', { err })
  } finally {
    sweeping = false
  }
  return { ran: true, ms: Date.now() - startedAt }
}

let scheduled = false

/**
 * Arm the nightly timer. Called once from instrumentation.ts register();
 * guarded anyway so a double call can't stack timers. `unref()` keeps the
 * timer from holding a shutting-down process open.
 */
export function startNightlySchedule(): void {
  if (scheduled) return
  const driver = nightlyDriver(process.env)
  if (driver === 'scheduler') {
    // Say so out loud. A silent no-op here is exactly the failure this split
    // exists to fix, and the log line is what tells you the Cloud Scheduler job
    // is now the only thing that will ever run maintenance.
    logger.info('notes.nightly.delegated', { driver, endpoint: '/api/internal/maintenance/nightly' })
    scheduled = true
    return
  }
  if (driver === 'off') return
  scheduled = true

  const runHour = nightlyRunHour(process.env)

  const arm = () => {
    const delay = msUntilNextRun(new Date(), runHour)
    const timer = setTimeout(() => {
      void runNightlyMaintenance().finally(arm)
    }, delay)
    timer.unref()
    logger.info('notes.nightly.armed', { hour: runHour, inMinutes: Math.round(delay / 60000) })
  }
  arm()
}
