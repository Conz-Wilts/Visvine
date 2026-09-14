// The one sentence every write surface says when a connector name resolves to
// the parent's shared note rather than this space's own (docs/sub-spaces.md).
//
// A shared connector is read here and changed there: its note, its switch,
// its secrets and its tool policy are the parent's. Each write route checks
// its own space's note first and only asks this when that read found nothing,
// so a space that has written its own same-named note is never told to go
// elsewhere.
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { describeConnector } from './service'

/**
 * Why `name` cannot be changed in `context`, or null when it is not the
 * parent's shared connector (absent, or this space's own — the caller has
 * already answered the second).
 */
export async function sharedConnectorRefusal(
  p: ContextPrincipal,
  context: Context,
  name: string,
): Promise<string | null> {
  const detail = await describeConnector(p, context, name)
  if (!detail?.shared) return null
  return `This connector belongs to ${detail.sharedFrom?.name ?? 'the parent space'}; change it there.`
}
