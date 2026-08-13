'use client'

// The brain's root index note (`index.md`) — a space's home page, and where the
// Directory's Context tab lands.
//
// The server seeds one at create time (ensureRootIndex in lib/notes/store.ts),
// but best-effort: a seed that throws is logged and swallowed, because a space
// without a home page is recoverable and a half-created space is not. So the two
// client surfaces that can be first to the note — the create dialog and the
// Context tab — both come through here, which writes the note if it is missing
// and does not return until the note is actually readable. Landing on the note
// page before that is what produced the "request access" card on a brand-new
// space: a 404 read is indistinguishable from a note you may not see.

import { newIndexContent } from '@/lib/notes/shared/indexNote'
import { cachedFetch, contextKeys, invalidateContextCache, readNote } from './contextPrefetch'
import { notesApi } from './notesApi'

export const ROOT_INDEX_PATH = 'index.md'

/**
 * Make sure `spaceId` has a root index and that its content is in the
 * context cache, so the next paint of the note comes from memory rather than a
 * fetch. Resolves either way — a space you can't write to still opens, it just
 * opens on whatever the note read gave back.
 */
export async function ensureRootIndexNote(spaceId: string, spaceName: string): Promise<void> {
  try {
    const { notes } = await cachedFetch(contextKeys.list(spaceId), () => notesApi.list(spaceId))
    if (!notes.some((n) => n.path === ROOT_INDEX_PATH)) {
      try {
        await notesApi.create(
          spaceId,
          ROOT_INDEX_PATH,
          newIndexContent({ title: spaceName || 'Home' }),
        )
      } catch (err) {
        // "already exists" = the server's own seed, or another tab, got there
        // between the list and the create. That is the outcome we wanted.
        if (!(err instanceof Error && /already exists/i.test(err.message))) throw err
      }
      invalidateContextCache(
        contextKeys.read(spaceId, ROOT_INDEX_PATH),
        contextKeys.list(spaceId),
        contextKeys.tree(spaceId),
      )
    }
    // The read is the point: it both warms the cache and is the thing that
    // proves the note is there to be shown.
    await readNote(spaceId, ROOT_INDEX_PATH)
  } catch {
    // Nothing here is worth blocking navigation over — the note page has its own
    // loading, missing and error states for whatever we failed to pre-empt.
  }
}
