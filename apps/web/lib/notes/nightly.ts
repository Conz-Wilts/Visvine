// Nightly maintenance: the two AI catch-up sweeps, run together while nobody's
// awake — the retrieval-embedding sweep (lib/notes/embedSweep.ts) and the
// link-reason pass (lib/notes/linkReasons.ts). Both are idempotent (mtime /
// reasonHash gated), so a re-run, an overlap with the live fire-and-forget
// triggers, or two server instances racing are all harmless — just wasted reads.
//
// There is no queue or external cron in this deploy (long-lived Docker/GCP Node
// server), so the schedule lives in-process: instrumentation.ts calls
// startNightlySchedule() once per server start, and a setTimeout chain fires at
// NIGHTLY_MAINTENANCE_HOUR (server-local, default 3am). Production-only by
// default so a dev server left running doesn't spend API tokens overnight;
// NIGHTLY_MAINTENANCE=on|off overrides either way.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { aiConfigured } from '@/lib/notes/ai'
import { embedSweep } from '@/lib/notes/embedSweep'
import { generateLinkReasons } from '@/lib/notes/linkReasons'
import { drainProjections, projectionBacklog } from '@/lib/notes/projections'
import { msUntilNextRun, nightlyEnabled, nightlyRunHour } from './shared/nightly'

let sweeping = false

/**
 * One full maintenance pass over every space: embeddings first (search
 * freshness benefits everyone), then link reasons. Each stage keys off its own
 * env (OPENAI_API_KEY / GEMINI_API_KEY) and skips silently when unkeyed, so
 * partial configuration runs whatever it can.
 */
async function runNightlyMaintenance(): Promise<void> {
  if (sweeping) return
  sweeping = true
  const startedAt = Date.now()
  try {
    // Drain first, and unconditionally: the sweeps below read derived state, so
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
    if (embedded.notes || embedded.chunks || embedded.pruned) {
      logger.info('notes.nightly.embeddings', {
        configured: embedded.configured,
        notes: embedded.notes,
        chunks: embedded.chunks,
        pruned: embedded.pruned,
      })
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
}

let scheduled = false

/**
 * Arm the nightly timer. Called once from instrumentation.ts register();
 * guarded anyway so a double call can't stack timers. `unref()` keeps the
 * timer from holding a shutting-down process open.
 */
export function startNightlySchedule(): void {
  if (scheduled) return
  if (!nightlyEnabled(process.env)) return
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
