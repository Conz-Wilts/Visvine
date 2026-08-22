// Who may write inside the Visvine space. Super-admins and the platform
// itself pass before this is consulted (lib/notes/contextService.ts); for
// everyone else the answer is: your own record, and nothing else.
//
// "Your own record" = the `people/<slug>` note (flat or folder, and any
// sub-note under the folder) whose node's identity you have claimed. The
// machine block inside it is rewritten by lib/global/record.ts on the next
// sync; the prose around it is yours.

import prisma from '@/lib/prisma'
import { entityKindOfPath, entityOwnerPathOf, parseEntityHref } from '@/lib/notes/entities'
import { folderOfIndexPath, isIndexPath } from '@/lib/notes/shared/indexNote'
import { GLOBAL_SPACE_ID } from '@/lib/spaces/globalSpace'

const DENIAL = 'Only your own Visvine record is yours to edit here. Change your profile to change what it says.'

/** The `people/<slug>` folder path a note inside the people namespace belongs to. */
function recordFolderOf(path: string): string | null {
  if (entityKindOfPath(path) === 'person' && parseEntityHref(path)) {
    return isIndexPath(path) ? folderOfIndexPath(path) : path.replace(/\.md$/i, '')
  }
  const owner = entityOwnerPathOf(path)
  return owner && owner.startsWith('people/') ? owner : null
}

export async function globalSelfRecordDenial(userId: string, path: string): Promise<string | null> {
  const folder = recordFolderOf(path)
  if (!folder) return DENIAL
  const slug = folder.split('/').pop()
  if (!slug) return DENIAL
  const node = await prisma.node.findFirst({
    where: { id: `person:${slug}`, spaceId: GLOBAL_SPACE_ID },
    select: { identity: { select: { userId: true } } },
  })
  return node?.identity?.userId === userId ? null : DENIAL
}
