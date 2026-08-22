// Where the global record learns that something public changed. Each hook is
// best-effort and runs AFTER the primary write has landed — a record that
// lags is a stale projection, never a failed save.

import prisma from '@/lib/prisma'
import { entityKindOfPath, parseEntityHref } from '@/lib/notes/entities'
import { isIndexPath, folderOfIndexPath } from '@/lib/notes/shared/indexNote'
import type { Context } from '@/lib/notes/store'
import type { NoteRevisionOrigin } from '@/lib/notes/shared/types'
import { isGlobalSpace } from '@/lib/spaces/globalSpace'
import { syncGlobalRecordSafe } from './record'

/** `people/x.md` or `people/x/index.md` → `person:x`; null for anything else. */
function personNodeIdOfPath(path: string): string | null {
  if (entityKindOfPath(path) !== 'person' || !parseEntityHref(path)) return null
  const base = isIndexPath(path) ? folderOfIndexPath(path) : path.replace(/\.md$/i, '')
  const slug = base.split('/').pop()
  return slug ? `person:${slug}` : null
}

/**
 * A person's note was saved in some space's shared context. If that space is
 * public and the node behind the note has an identity, its record may have
 * changed (the note's title is the card's name). Replica and platform writes
 * are skipped: a replica is the record coming back, a baseline write is the
 * record itself.
 */
export async function globalNoteWritten(context: Context, path: string, origin: NoteRevisionOrigin): Promise<void> {
  if (context.ownerKey !== 'shared') return // store.ts SHARED_OWNER_KEY; see record.ts
  if (origin === 'publish' || origin === 'baseline') return
  if (isGlobalSpace(context.spaceId)) return
  const nodeId = personNodeIdOfPath(path)
  if (!nodeId) return
  const node = await prisma.node.findFirst({
    where: { id: nodeId, spaceId: context.spaceId },
    select: { identityId: true, space: { select: { visibility: true } } },
  })
  if (!node?.identityId || node.space?.visibility !== 'public') return
  await syncGlobalRecordSafe(node.identityId)
}
