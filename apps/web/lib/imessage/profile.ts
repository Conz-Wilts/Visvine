/**
 * The name and picture a line shows in Messages: the space's, pushed to
 * Sendblue's contact-sharing profile whenever they change, and shared into a
 * person's conversation when they link.
 */
import prisma from '@/lib/prisma'
import { appOrigin } from '@/lib/connectors/connectUrl'
import { logger } from '@/lib/logger'
import { lineForSpace } from './lines'
import { setLineProfile, shareLineProfile } from './sendblue'

/** The space's icon as a URL Sendblue can fetch — absolute, on this deployment. */
function publicImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl
  // A local-driver URL is not reachable from Sendblue; production serves
  // /api/media from the same origin the app is published at.
  if (process.env.NODE_ENV !== 'production' && !process.env.NEXT_PUBLIC_APP_URL) return null
  return `${appOrigin()}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`
}

/** Push the line's card. Best effort; the row records when it last happened. */
export async function pushLineProfile(spaceId: string): Promise<boolean> {
  const [line, space] = await Promise.all([
    lineForSpace(spaceId),
    prisma.space.findUnique({ where: { id: spaceId }, select: { name: true, imageUrl: true } }),
  ])
  if (!line || !space) return false
  const ok = await setLineProfile({ from: line.number, firstName: line.name ?? space.name, photoUrl: publicImageUrl(space.imageUrl) })
  if (ok) await prisma.imessageLine.update({ where: { id: line.id }, data: { profileAt: new Date() } }).catch(() => undefined)
  else logger.warn('imessage.profile.not_pushed', { spaceId })
  return ok
}

/** Put the line's card into one person's conversation — on link, and again on request. */
export async function shareProfileWith(line: { number: string }, phone: string): Promise<void> {
  await shareLineProfile({ from: line.number, to: phone })
}
