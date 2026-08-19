/**
 * Per-space connector quotas — the two throttles between "anyone with a grant
 * can run this" and "one space can starve the runtime for everyone".
 *
 *   • a sliding-window cap on connector runs per minute, per space
 *     (`CONNECTOR_RUNS_PER_MINUTE`, default 120);
 *   • a concurrency cap of 2 runs per space, out of the isolate's 4 slots
 *     process-wide (lib/connectors/isolate.ts), so a burst from one space
 *     still leaves the other half for everyone else.
 *
 * Both are enforced INSIDE executeConnectorScript, so every caller — MCP,
 * the agent tool, the Tools bridge, the console — is covered by construction.
 * Both are IN-PROCESS, like lib/tools/limits.ts and for the same reason: the
 * hard guarantees (perimeter, secrets, timeouts) hold per call on every
 * worker; this is about fairness, not safety. `now` is a parameter so tests
 * can walk the window forward without sleeping.
 */

export const CONNECTOR_RATE_WINDOW_MS = 60_000
export const CONNECTOR_CONCURRENCY = 2
const DEFAULT_RUNS_PER_MINUTE = 120
const MAX_TRACKED_KEYS = 5_000

/** The configured per-space run budget per minute. */
export function connectorRunsPerMinute(): number {
  const raw = Number(process.env.CONNECTOR_RUNS_PER_MINUTE)
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_RUNS_PER_MINUTE
}

export type QuotaDecision = { ok: true; remaining: number } | { ok: false; retryAfterMs: number }

const runs = new Map<string, number[]>()

function windowOf(key: string, now: number): number[] {
  const hits = runs.get(key)
  if (!hits) return []
  const cutoff = now - CONNECTOR_RATE_WINDOW_MS
  let drop = 0
  while (drop < hits.length && hits[drop] <= cutoff) drop++
  return drop === 0 ? hits : hits.slice(drop)
}

function sweep(now: number): void {
  for (const key of [...runs.keys()]) {
    const live = windowOf(key, now)
    if (live.length === 0) runs.delete(key)
    else runs.set(key, live)
  }
}

/**
 * Take one run's worth of a space's per-minute budget. On refusal,
 * `retryAfterMs` is when the oldest run falls out of the window.
 */
export function takeConnectorRun(
  spaceId: string,
  now: number = Date.now(),
  limit: number = connectorRunsPerMinute(),
): QuotaDecision {
  if (runs.size > MAX_TRACKED_KEYS) sweep(now)
  const live = windowOf(spaceId, now)
  if (live.length >= limit) {
    runs.set(spaceId, live)
    return { ok: false, retryAfterMs: Math.max(1, live[0] + CONNECTOR_RATE_WINDOW_MS - now) }
  }
  live.push(now)
  runs.set(spaceId, live)
  return { ok: true, remaining: limit - live.length }
}

const inFlight = new Map<string, number>()

/**
 * Take one of the space's concurrent run slots, or null when it is at the cap.
 * Refuses rather than queues — the caller can retry; a queued HTTP request
 * held behind a 30s run cannot. The release is idempotent.
 */
export function acquireConnectorRun(spaceId: string, cap: number = CONNECTOR_CONCURRENCY): (() => void) | null {
  const current = inFlight.get(spaceId) ?? 0
  if (current >= cap) return null
  inFlight.set(spaceId, current + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const next = (inFlight.get(spaceId) ?? 1) - 1
    if (next <= 0) inFlight.delete(spaceId)
    else inFlight.set(spaceId, next)
  }
}

/** Live run count for a space — for tests. */
export function connectorRunsInFlight(spaceId: string): number {
  return inFlight.get(spaceId) ?? 0
}

/** Drop all state. Tests only. */
export function resetConnectorQuota(): void {
  runs.clear()
  inFlight.clear()
}
