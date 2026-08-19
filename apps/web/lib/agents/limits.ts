/**
 * The numbers the scheduler, executor and panel must agree on. Pure.
 */

/** Wall-clock cap on one run. */
export const MAX_RUN_MS = 20 * 60_000
/**
 * The tick reclaims a row stuck in `running` after MAX_RUN_MS + this. The
 * grace exists because the executor's own timeout fires at exactly MAX_RUN_MS
 * and then still has to write the run row and release the state row; reclaiming
 * at the same instant raced that release. Two minutes is far more than either
 * write takes, and far less than a tick interval.
 */
export const RECLAIM_GRACE_MS = 2 * 60_000
/**
 * The SLOWEST cadence Cloud Scheduler is expected to fire the tick at. Event
 * latency = debounce + time to the next tick, so docs/agents.md recommends
 * `* * * * *` (every minute; the tick is one indexed query when nothing is
 * due) — but the delayed banner is sized for the 5-minute job so a slower
 * schedule is never mis-reported as an outage.
 */
const TICK_INTERVAL_MS = 5 * 60_000
/** A due agent not picked up for two ticks means the tick itself is not firing. */
export const DELAYED_AFTER_MS = 2 * TICK_INTERVAL_MS
/** Runs claimed per tick, across all spaces (each is its own HTTP request). */
export const MAX_RUNS_PER_TICK = 5
/** Consecutive failed runs before an agent is switched off. */
export const MAX_CONSECUTIVE_FAILURES = 3
/** How often the executor flushes the transcript to the run row. */
export const FLUSH_EVERY_MS = 2_000
export const FLUSH_EVERY_EVENTS = 10
