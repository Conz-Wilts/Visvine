/**
 * `visvine.state` — a Tool's own small key/value store.
 *
 * This exists because the frame runs sandboxed WITHOUT `allow-same-origin`, so
 * it has no `localStorage`, no cookies and no origin-scoped storage of any kind.
 * A Tool that wants to remember a column order or a chosen filter has nowhere to
 * put it. State is that place, and deliberately nothing more: values are small,
 * per install, and shared by everyone who can see the Tool.
 *
 * It is NOT private to a viewer and NOT a database. A Tool storing a person's
 * notes here instead of writing context notes would be putting space data
 * somewhere the space cannot search, share or audit — the perimeter and
 * `context.write` are for that, and the 16KB cap is the nudge.
 *
 * Preview targets have no install row to key against, so their state lives in a
 * per-process map: an author's preview keeps its state for as long as the server
 * does, and never touches the table an installed copy uses.
 */
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { targetKey, type ResolvedTarget } from './target'

/** Largest single value, serialized. Small on purpose — see the file comment. */
export const STATE_MAX_BYTES = 16 * 1024

/**
 * Keys one Tool may hold before it must clear one to add another. A preview
 * drops its oldest key past this line (there is no author to show a failure
 * to); an install refuses the new key instead — evicting a row an installed
 * Tool relies on would be silent data loss, where a refusal surfaces through
 * the bridge as something the author can read and fix.
 */
export const STATE_MAX_KEYS = 100

export type StateSetResult =
  | { ok: true }
  | { ok: false; reason: 'too_large'; bytes: number }
  | { ok: false; reason: 'key_limit' }

/** Preview state, keyed by `targetKey` then by the Tool's own key. */
const previewState = new Map<string, Map<string, unknown>>()

/**
 * A value as it will be stored, or null when it isn't storable at all.
 *
 * Round-tripping through JSON is the point rather than a formality: it drops
 * `undefined`, functions and class identity, so what comes back out of the
 * preview map is the same shape that would come back out of Postgres. A Tool
 * must not be able to tell which one it is talking to.
 */
function storable(value: unknown): { json: string; value: unknown } | null {
  const json = JSON.stringify(value)
  if (json === undefined) return null
  return { json, value: JSON.parse(json) as unknown }
}

/** One key's value, or null when unset (indistinguishable from a stored null). */
export async function getToolState(t: ResolvedTarget, key: string): Promise<unknown> {
  if (t.installId === null) {
    return previewState.get(targetKey(t))?.get(key) ?? null
  }
  const row = await prisma.appToolState.findUnique({
    where: { app_tool_state_identity: { installId: t.installId, key } },
    select: { value: true },
  })
  return row ? (row.value as unknown) : null
}

/**
 * Set one key. `null` and `undefined` clear it — a Tool with no delete method
 * still needs a way to forget something, and a stored null is indistinguishable
 * from an absent key on the way out anyway.
 */
export async function setToolState(
  t: ResolvedTarget,
  key: string,
  value: unknown,
): Promise<StateSetResult> {
  const prepared = value === null || value === undefined ? null : storable(value)
  if (prepared !== null) {
    const bytes = Buffer.byteLength(prepared.json, 'utf8')
    if (bytes > STATE_MAX_BYTES) return { ok: false, reason: 'too_large', bytes }
  }

  if (t.installId === null) {
    const bucket = previewState.get(targetKey(t)) ?? new Map<string, unknown>()
    previewState.set(targetKey(t), bucket)
    if (prepared === null) {
      bucket.delete(key)
    } else {
      // Re-inserting moves the key to the end, so the eviction below drops the
      // least recently written rather than the first one ever written.
      bucket.delete(key)
      bucket.set(key, prepared.value)
      while (bucket.size > STATE_MAX_KEYS) {
        const oldest = bucket.keys().next()
        if (oldest.done) break
        bucket.delete(oldest.value)
      }
    }
    return { ok: true }
  }

  const identity = { installId: t.installId, key }
  if (prepared === null) {
    await prisma.appToolState.deleteMany({ where: identity })
    return { ok: true }
  }
  const stored = prepared.value as Prisma.InputJsonValue

  // Try the overwrite first: an existing key must always be allowed, cap or
  // no cap, and this tells us whether the write is actually a new row without
  // a separate existence check.
  const updated = await prisma.appToolState.updateMany({ where: identity, data: { value: stored } })
  if (updated.count === 0) {
    const rows = await prisma.appToolState.count({ where: { installId: t.installId } })
    if (rows >= STATE_MAX_KEYS) return { ok: false, reason: 'key_limit' }
    await prisma.appToolState.create({ data: { ...identity, value: stored } })
  }
  return { ok: true }
}

/** Drop every preview's state. Tests only. */
export function resetPreviewToolState(): void {
  previewState.clear()
}
