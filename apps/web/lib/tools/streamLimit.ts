/**
 * A per-user cap on open change streams (`GET /api/tools/changes`).
 *
 * Every open stream is a subscriber on the note change bus and a held
 * response; a page that opens Tool frames in a loop — or a script with a
 * cookie — must not be able to pin an unbounded number of them. Refusing the
 * (N+1)th with 429 is simpler and more honest than closing the oldest: the
 * client that gets refused is the one misbehaving, and EventSource retries.
 *
 * Per process, on `globalThis` so it survives Next.js dev HMR the way
 * lib/notes/changes.ts does. The counter itself is pure and injectable so it
 * can be tested without a request.
 */

/** Open streams one user may hold at once, per process. */
export const MAX_STREAMS_PER_USER = 8

export interface StreamCounter {
  /** Try to open one more for `userId`; `false` when at the cap. */
  acquire(userId: string): boolean
  /** Give one back. Never goes below zero, and forgets the user at zero. */
  release(userId: string): void
  /** How many `userId` holds now (tests, diagnostics). */
  count(userId: string): number
}

export function createStreamCounter(max: number = MAX_STREAMS_PER_USER): StreamCounter {
  const open = new Map<string, number>()
  return {
    acquire(userId) {
      const now = open.get(userId) ?? 0
      if (now >= max) return false
      open.set(userId, now + 1)
      return true
    },
    release(userId) {
      const now = open.get(userId) ?? 0
      if (now <= 1) open.delete(userId)
      else open.set(userId, now - 1)
    },
    count(userId) {
      return open.get(userId) ?? 0
    },
  }
}

const KEY = '__visvine_tool_stream_counter__'
type WithCounter = typeof globalThis & { [KEY]?: StreamCounter }

/** The process-wide counter the route uses. */
export function streamCounter(): StreamCounter {
  const g = globalThis as WithCounter
  if (!g[KEY]) g[KEY] = createStreamCounter()
  return g[KEY]
}
