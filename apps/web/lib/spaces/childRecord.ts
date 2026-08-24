// A space created inside another one is also a record of the parent's: the
// `space` node + `communities/<slug>.md` that every space node must have
// (docs/sub-spaces.md). The switcher's "Create space inside…" provisions first
// and records here; the directory's Create → Space records first and
// provisions on the way (lib/directory/createEntity.ts). Same two halves.
import { createEntity } from '@/lib/directory/createEntity'
import { resolveContext } from '@/lib/notes/resolve'
import { logger } from '@/lib/logger'
import type { SessionPayload } from '@/lib/session'

export async function recordChildSpace(
  parentId: string,
  childId: string,
  name: string,
  session: SessionPayload,
): Promise<void> {
  const context = await resolveContext(session, parentId)
  if (context instanceof Response) return
  const result = await createEntity(context, { type: 'space', name, spaceRef: childId })
  // A record that already exists under that name is not a failure — the
  // space is real either way, and the existing card is the one to point at.
  if (!result.ok && result.status !== 409) {
    logger.warn('spaces.child_record_failed', { parentId, childId, error: result.error })
  }
}
