/**
 * The Tool-facing filter over the note change bus (lib/notes/changes.ts):
 * which of a space's changes a given frame may be told about.
 *
 * Pure and small so the SSE route stays a transport and the rule is testable
 * without a stream. A change is forwarded when ALL of:
 *
 *   • it is in the SHARED context — a Tool never sees anyone's personal notes,
 *     and the bus carries personal writes too;
 *   • the path is inside the Tool's declared read perimeter — the same
 *     `refuseRead` the bridge applies to `context.list`;
 *   • the VIEWER may read the path (`canReadPath`, the pure half of the grant
 *     check the bridge's reads go through). Deletes and the old half of a
 *     rename are held to this too: a path is a name, and the name of a note
 *     the viewer could never read is still something they were never told.
 *     A frame may therefore miss the delete of a note it could not read — it
 *     had nothing showing to refresh.
 *
 * What crosses is a path and nothing else. Content is always re-read through
 * the bridge, under the viewer's grants at that moment.
 */
import { canReadPath } from '@/lib/notes/contextService'
import type { NoteChange } from '@/lib/notes/changes'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { refuseRead } from './perimeter'
import type { ResolvedTarget } from './target'

/** The paths of `change` this Tool frame may be told about (0, 1 or 2 for a rename). */
export function changedPathsFor(t: ResolvedTarget, change: NoteChange): string[] {
  if (change.spaceId !== t.spaceId || change.ownerKey !== SHARED_OWNER_KEY) return []
  const out: string[] = []
  const consider = (path: string) => {
    if (refuseRead(t.perimeter, path) !== null) return
    if (!canReadPath(t.principal, t.context, path)) return
    if ((t.coPrincipals ?? []).some((p) => !canReadPath(p, t.context, path))) return
    out.push(path)
  }
  consider(change.path)
  // A rename is a delete at the old path.
  if (change.kind === 'rename' && change.from && change.from !== change.path) consider(change.from)
  return out
}
