/**
 * Who wrote a Tool's working copy since its space last approved it — and so
 * whose reach an unreviewed draft runs with.
 *
 * A preview runs code nobody has reviewed. Run under the viewer alone, a member
 * could hand an admin the preview link and have their unreviewed code read and
 * write with the admin's reach. So a preview's principal is the INTERSECTION of
 * the viewer and every person who has written the draft since its last approved
 * version: a read or write is allowed only if all of them could make it
 * (lib/tools/target.ts#resolvePreview, enforced per call in lib/tools/bridge.ts).
 * With no approved version, everyone who ever wrote it counts.
 *
 * Authors are read from the source notes' revisions — every save records the
 * editor — plus a note's creator. A save with no editor on record (a system
 * write) names nobody.
 */
import prisma from '@/lib/prisma'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { toolKey } from './registry'

export interface DraftAuthor {
  userId: string
  name: string
}

export interface DraftAuthorship {
  authors: DraftAuthor[]
  /** The newest save of the draft's sources, for "last edited by". */
  lastEdit: { name: string; at: string } | null
}

/** The draft authors of the Tool `name`, whose folder is `folder`. */
export async function draftAuthorship(spaceId: string, name: string, folder: string): Promise<DraftAuthorship> {
  const approved = await prisma.appToolVersion.findFirst({
    where: { key: toolKey(spaceId, name), status: 'approved', revokedAt: null },
    orderBy: { version: 'desc' },
    select: { submittedAt: true },
  })
  const since = approved?.submittedAt ?? null
  const notes = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: `${folder}/` } },
    select: { id: true, createdBy: true, createdAt: true },
  })
  if (notes.length === 0) return { authors: [], lastEdit: null }
  const revisions = await prisma.contextNoteRevision.findMany({
    where: { noteId: { in: notes.map((n) => n.id) }, ...(since ? { at: { gte: since } } : {}) },
    orderBy: { at: 'desc' },
    select: { editor: true, editorEmail: true, at: true },
  })

  const emails = [...new Set(revisions.map((r) => r.editorEmail?.toLowerCase()).filter((e): e is string => !!e))]
  const creators = notes.filter((n) => !since || n.createdAt >= since).map((n) => n.createdBy)
  const users = await prisma.user.findMany({
    where: { OR: [{ email: { in: emails, mode: 'insensitive' } }, { id: { in: [...new Set(creators)] } }] },
    select: { id: true, name: true, email: true },
  })
  const authors = new Map<string, DraftAuthor>()
  for (const user of users) authors.set(user.id, { userId: user.id, name: user.name })
  const newest = revisions[0]
  return {
    authors: [...authors.values()].sort((a, b) => a.name.localeCompare(b.name)),
    lastEdit: newest ? { name: newest.editor, at: newest.at.toISOString() } : null,
  }
}

/**
 * A principal that reaches nothing — what an author who has left the space,
 * or whose account is gone, contributes to the intersection.
 */
export function nobodyPrincipal(spaceId: string, author: DraftAuthor): ContextPrincipal {
  return {
    userId: author.userId,
    email: '',
    name: author.name,
    spaceId,
    spaceAdmin: false,
    access: { ...OPEN_ACCESS, grants: [] },
  }
}
