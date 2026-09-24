/**
 * The text extracted from a resource (a PDF's pages, a deck's slides, a
 * document's words), read through the reader's own context lens — the chunks
 * sit under the resource's entity folder, so the lens is the resource's
 * audience and nothing here decides access on its own.
 */
import prisma from '@/lib/prisma'
import { readSourceVisible } from '@/lib/notes/contextService'
import { principalOf, resolveContext } from '@/lib/notes/resolve'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { SessionPayload } from '@/lib/session'

export interface ResourceText {
  text: string
  offset: number
  totalChars: number
  /** Where the next page starts, or null at the end. */
  nextOffset: number | null
}

export async function readResourceTextAs(
  principal: ContextPrincipal,
  spaceId: string,
  resourceId: string,
  { offsetChars = 0, maxChars = 20_000 }: { offsetChars?: number; maxChars?: number } = {},
): Promise<ResourceText | null> {
  const row = await prisma.resource.findUnique({ where: { id: resourceId }, select: { sourcePath: true, spaceId: true } })
  if (!row?.sourcePath || row.spaceId !== spaceId) return null
  const page = await readSourceVisible(principal, { spaceId, ownerKey: SHARED_OWNER_KEY }, row.sourcePath, {
    offsetChars,
    maxChars,
  })
  if (!page) return null
  const end = offsetChars + page.text.length
  return { text: page.text, offset: offsetChars, totalChars: page.totalChars, nextOffset: end < page.totalChars ? end : null }
}

export async function readResourceText(
  session: SessionPayload,
  spaceId: string,
  resourceId: string,
  opts?: { offsetChars?: number; maxChars?: number },
): Promise<ResourceText | null> {
  const context = await resolveContext(session, spaceId)
  if (context instanceof Response) return null
  return readResourceTextAs(await principalOf(context), spaceId, resourceId, opts)
}
