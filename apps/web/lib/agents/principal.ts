/**
 * The principal a scheduled run acts as: the brief's AUTHOR. Built without a
 * session (the executor has none) from the same pieces `principalOf` uses,
 * so reach is exactly what that user has today — a member's agent cannot
 * read what the member can't, and an admin's activation is approval, not
 * privilege. Null when the user is gone or no longer a member: the run then
 * fails `author_gone` and the agent is deactivated.
 */
import prisma from '@/lib/prisma'
import { isAdmin } from '@/lib/auth'
import { contextAccessFor, ensureAccessSeeded } from '@/lib/notes/access'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'

export async function principalForUser(spaceId: string, userId: string): Promise<ContextPrincipal | null> {
  const [user, space] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, isActive: true } }),
    prisma.space.findUnique({ where: { id: spaceId }, select: { personalOwnerId: true } }),
  ])
  if (!user || !user.isActive || !space) return null

  const personal = space.personalOwnerId !== null
  const admin = space.personalOwnerId === userId || (await isAdmin(userId, spaceId, user.email))
  if (!admin) {
    const member = await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { userId: true },
    })
    if (!member) return null
  }

  let access = OPEN_ACCESS
  if (!personal) {
    await ensureAccessSeeded(spaceId)
    access = await contextAccessFor(spaceId, userId)
  }
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    spaceId,
    spaceAdmin: admin,
    access,
  }
}
