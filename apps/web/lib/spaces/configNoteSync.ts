/**
 * Keeping a space's config notes and its config columns in step — the two
 * directions of the declaration/projection split described in
 * docs/data-architecture.md.
 *
 *   column → note   `syncConfigNotes`, called by updateSpaceConfig AFTER its
 *                   transaction commits, so a console change shows up in the
 *                   note (and in the note's history) like any other edit.
 *   note → column   `configNoteWritten` in ./configHook.ts, the store hook,
 *                   called when somebody saves settings/*.md by hand. It lives
 *                   in its own module because `store` imports it, and this one
 *                   imports `store` — keeping them apart is what leaves the
 *                   only cycle a lazy one (spaceConfig imports this on demand).
 *
 * The loop terminates by comparison, not by a flag: each direction skips when
 * what it would write is already what is stored. A hand-edited note that parses
 * to the same config it already had produces no column write; a column write
 * whose note already parses to that config produces no note write. Worst case
 * is one extra no-op hop.
 *
 * Prose is preserved. `syncConfigNotes` only rewrites a note whose PARSED
 * config differs from the stored one, so an admin who adds a paragraph
 * explaining why a feature is off keeps that paragraph through unrelated
 * config changes.
 *
 * Malformed notes are refused at the write gate (contextService.writeGated), not
 * here — by the time this hook runs the note is already saved. The check below
 * is defence in depth for the write paths that bypass the gate (system writes,
 * scripts): a note that does not parse leaves the columns untouched.
 */

import type { Space } from '@prisma/client'
import * as store from '@/lib/notes/store'
import { SHARED_OWNER_KEY, type Actor, type Context } from '@/lib/notes/store'
import {
  CONFIG_NOTE_PATHS,
  parseConfigNote,
  serializeConfigNote,
  type ConfigNoteKind,
} from './configNote'
import type { SpaceConfig } from './spaceConfig'
import { patchIsNoOp } from './configHook'
import { logger } from '@/lib/logger'

const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Visvine' }

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/**
 * Write the config notes for a space, skipping any whose stored note already
 * parses to this config. Best-effort: a space's settings must still save when
 * its mirror cannot be written, so failures are logged and swallowed rather
 * than failing the config change that has already committed.
 */
export async function syncConfigNotes(space: Space, config: SpaceConfig): Promise<void> {
  // A personal space has no console, no admins and no second member to inform;
  // three settings notes in it would be clutter, not governance.
  if (space.personalOwnerId) return

  const context = sharedContext(space.id)
  for (const kind of Object.keys(CONFIG_NOTE_PATHS) as ConfigNoteKind[]) {
    const path = CONFIG_NOTE_PATHS[kind]
    try {
      const existing = await store.readNoteOrNull(context, path)
      if (existing) {
        const { patch, errors } = parseConfigNote(kind, existing)
        // Unchanged AND valid: leave the author's own wording alone.
        if (!errors.length && patchIsNoOp(patch, config)) continue
      }
      await store.writeNote(context, path, serializeConfigNote(kind, config), SYSTEM_ACTOR, 'maintenance')
    } catch (err) {
      logger.error('configNote.sync_failed', { path, spaceId: space.id, err })
    }
  }
}
