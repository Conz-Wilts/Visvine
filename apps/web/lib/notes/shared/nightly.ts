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

/** The configured run hour: NIGHTLY_MAINTENANCE_HOUR when a valid 0-23, else 3am. */
export function nightlyRunHour(env: Record<string, string | undefined>): number {
  const hour = Number.parseInt(env.NIGHTLY_MAINTENANCE_HOUR ?? '', 10)
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 3
}
