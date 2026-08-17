/**
 * The numbers the scheduler, executor and panel must agree on. Pure.
 */

/** Wall-clock cap on one run — AND the stale-`running` reclaim timeout (same number, on purpose). */
export const MAX_RUN_MS = 20 * 60_000
/** Cloud Scheduler fires the tick this often. */
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
