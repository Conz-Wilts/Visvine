/**
 * The note → column direction of the space-config split (docs/data-architecture.md):
 * somebody saved `settings/types.md` (or features/design) by hand, so the
 * columns follow. Called from lib/notes/store.ts alongside the agent and Tool
 * hooks.
 *
 * Deliberately does NOT import the note store — store imports this, and the
 * other direction (./configNoteSync.ts) imports store. Keeping the two halves
 * in separate modules is what leaves the module graph with only one cycle, and
 * that one lazy.
 *
 * Malformed notes are refused earlier, at the write gate
 * (contextService.writeGated), because by the time this runs the note is
 * already saved. The parse below is defence in depth for the paths that bypass
 * the gate — system writes, scripts, seeds: a note that does not parse leaves
 * the columns exactly as they were.
 */

import { configNoteKindOf, adminAliasDenial, parseConfigNote } from './configNote'
import { readSpaceConfig, updateSpaceConfig, type SpaceConfig, type SpaceConfigPatch } from './spaceConfig'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import { logger } from '@/lib/logger'

/** Stable-key JSON, so `{a:1,b:2}` and `{b:2,a:1}` compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

/**
 * Does this patch already describe what the config holds? This comparison is
 * what terminates the two-way sync: neither direction writes when the other
 * side already says the same thing.
 */
export function patchIsNoOp(patch: SpaceConfigPatch, config: SpaceConfig): boolean {
  return (Object.keys(patch) as (keyof SpaceConfig)[]).every(
    (key) => canonical(patch[key]) === canonical(config[key]),
  )
}

export async function configNoteWritten(
  context: Context,
  path: string,
  content: string,
): Promise<void> {
  // Personal contexts have no space configuration to speak for.
  if (context.ownerKey !== SHARED_OWNER_KEY) return
  const kind = configNoteKindOf(path)
  if (!kind) return

  const { patch, errors } = parseConfigNote(kind, content)
  if (errors.length) {
    logger.error('configNote.parse_failed', { path, spaceId: context.spaceId, errors })
    return
  }
  if (!Object.keys(patch).length) return

  const stored = await readSpaceConfig(context.spaceId)
  if (stored && patchIsNoOp(patch, stored)) return
  // The gate refuses this earlier for ordinary writes; repeated here because a
  // write that bypassed the gate must not be able to strand a space with no
  // admin either.
  const denial = stored ? adminAliasDenial(patch, stored) : null
  if (denial) {
    logger.error('configNote.refused', { path, spaceId: context.spaceId, denial })
    return
  }

  // `skipNoteSync` so the admin's own wording and key order survive: the note is
  // already right, and rewriting it into canonical form would discard whatever
  // they wrote around the config.
  await updateSpaceConfig(context.spaceId, () => patch, { skipNoteSync: true })
}
