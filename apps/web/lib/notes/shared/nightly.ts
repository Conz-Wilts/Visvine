// Pure scheduling logic for the nightly maintenance run (lib/notes/nightly.ts),
// kept here — no prisma/fs — so it's unit-testable like the rest of shared/*.

/** Milliseconds from `now` to the next `hour`:00 (server-local), always > 0. */
export function msUntilNextRun(now: Date, hour: number): number {
  const next = new Date(now)
  next.setHours(hour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

/**
 * Whether the nightly schedule should arm: production-only by default (a dev
 * server left running shouldn't spend API tokens overnight), overridable
 * either way with NIGHTLY_MAINTENANCE=on|off.
 */
export function nightlyEnabled(env: Record<string, string | undefined>): boolean {
  const flag = (env.NIGHTLY_MAINTENANCE ?? '').trim().toLowerCase()
  if (flag === 'on') return true
  if (flag === 'off') return false
  return env.NODE_ENV === 'production'
}

/**
 * WHO fires the nightly run.
 *
 * `in-process` is a setTimeout chain inside the server (see nightly.ts). That
 * works for a long-lived server and is silently wrong on Cloud Run, which
 * scales to zero: at 3am there is usually no instance alive to hold the timer,
 * so the sweep simply never happens — no error, no log line, just embeddings
 * and link reasons quietly going stale. And when an instance IS alive, there
 * may be up to --max-instances of them, each holding its own timer.
 *
 * So a managed runtime hands the job to Cloud Scheduler instead, which POSTs
 * /api/internal/maintenance/nightly exactly once (see that route). K_SERVICE is
 * set by Cloud Run itself, so this needs no configuration to be right in prod.
 *
 * NIGHTLY_MAINTENANCE_DRIVER forces the choice when the guess is wrong — a
 * long-lived VM deploy, or a Cloud Run service you have not yet given a
 * scheduler job.
 */
export type NightlyDriver = 'off' | 'in-process' | 'scheduler'

export function nightlyDriver(env: Record<string, string | undefined>): NightlyDriver {
  if (!nightlyEnabled(env)) return 'off'
  const forced = (env.NIGHTLY_MAINTENANCE_DRIVER ?? '').trim().toLowerCase()
  if (forced === 'in-process' || forced === 'scheduler') return forced
  return env.K_SERVICE ? 'scheduler' : 'in-process'
}

/** The configured run hour: NIGHTLY_MAINTENANCE_HOUR when a valid 0-23, else 3am. */
export function nightlyRunHour(env: Record<string, string | undefined>): number {
  const hour = Number.parseInt(env.NIGHTLY_MAINTENANCE_HOUR ?? '', 10)
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 3
}
