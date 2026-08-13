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
import { semanticConfigured } from '@/lib/notes/embeddings'
import { embedSweep } from '@/lib/notes/embedSweep'
import { generateLinkReasons } from '@/lib/notes/linkReasons'
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
    if (semanticConfigured()) {
      const embedded = await embedSweep()
      logger.info('notes.nightly.embeddings', {
        notes: embedded.notes,
        chunks: embedded.chunks,
      })
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
