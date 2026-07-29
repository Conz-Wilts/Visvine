// Teams: named member groups inside a community — deliberately boring (name +
// members + optional leads). They are NOT a permission concept by themselves;
// they're a subject a BrainGrant can target, which is what makes "add someone
// to Engineering" open the handbook, the strategy folder, and the engineering
// subtree in one action. Community admins manage teams; team leads manage
// their own team's membership.

import prisma from '@/lib/prisma'
import { logAudit } from './audit'

export type TeamRole = 'lead' | 'member'

interface TeamMemberInfo {
  userId: string
  role: TeamRole
  name: string
  email: string | null
  image: string | null
}

export interface TeamInfo {
  id: string
  name: string
  description: string | null
  createdBy: string
  createdAt: number
  members: TeamMemberInfo[]
}

interface Actor {
  userId: string
  name: string
}

function toRole(role: string): TeamRole {
  return role === 'lead' ? 'lead' : 'member'
}

/** Every team of a community with its members (visible to any member). */
export async function listTeams(communityId: string): Promise<TeamInfo[]> {
  const teams = await prisma.team.findMany({
    where: { communityId },
    orderBy: { name: 'asc' },
    include: { members: { orderBy: { createdAt: 'asc' } } },
  })
  const userIds = [...new Set(teams.flatMap((t) => t.members.map((m) => m.userId)))]
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, image: true },
      })
    : []
  const userById = new Map(users.map((u) => [u.id, u]))
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    createdBy: t.createdBy,
    createdAt: t.createdAt.getTime(),
    members: t.members.map((m) => {
      const user = userById.get(m.userId)
      return {
        userId: m.userId,
        role: toRole(m.role),
        name: user?.name ?? 'Former member',
        email: user?.email ?? null,
        image: user?.image ?? null,
      }
    }),
  }))
}

/** Whether the caller may manage a team's membership: community admin or lead. */
export async function canManageTeam(
  teamId: string,
  userId: string,
  communityAdmin: boolean,
): Promise<boolean> {
  if (communityAdmin) return true
  const membership = await prisma.teamMember.findUnique({
    where: { team_member_identity: { teamId, userId } },
    select: { role: true },
  })
  return membership?.role === 'lead'
}

export async function createTeam(
  communityId: string,
  input: { name: string; description?: string },
  actor: Actor,
): Promise<TeamInfo> {
  const name = input.name.trim()
  if (!name) throw new Error('Team name is required')
  const existing = await prisma.team.findUnique({
    where: { team_identity: { communityId, name } },
    select: { id: true },
  })
  if (existing) throw new Error(`A team named "${name}" already exists`)
  const team = await prisma.team.create({
    data: {
      communityId,
      name,
      description: input.description?.trim() || null,
      createdBy: actor.userId,
    },
  })
  void logAudit(communityId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: `created team "${name}"`,
  })
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    createdBy: team.createdBy,
    createdAt: team.createdAt.getTime(),
    members: [],
  }
}

export async function updateTeam(
  communityId: string,
  teamId: string,
  input: { name?: string; description?: string | null },
): Promise<void> {
  const team = await prisma.team.findFirst({ where: { id: teamId, communityId }, select: { id: true } })
  if (!team) throw new Error('Unknown team')
  const data: { name?: string; description?: string | null } = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new Error('Team name is required')
    data.name = name
  }
  if (input.description !== undefined) data.description = input.description?.trim() || null
  await prisma.team.update({ where: { id: teamId }, data })
}

/** Delete a team AND its grants — membership rows cascade with the team. */
export async function deleteTeam(communityId: string, teamId: string, actor: Actor): Promise<void> {
  const team = await prisma.team.findFirst({ where: { id: teamId, communityId } })
  if (!team) throw new Error('Unknown team')
  await prisma.brainGrant.deleteMany({
    where: { communityId, subjectType: 'team', subjectId: teamId },
  })
  await prisma.team.delete({ where: { id: teamId } })
  void logAudit(communityId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: `deleted team "${team.name}" (and its grants)`,
  })
}

/** Add (or re-role) a member — they must be an active member of the community. */
export async function setTeamMember(
  communityId: string,
  teamId: string,
  userId: string,
  role: TeamRole,
  actor: Actor,
): Promise<void> {
  const team = await prisma.team.findFirst({ where: { id: teamId, communityId }, select: { id: true } })
  if (!team) throw new Error('Unknown team')
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { status: true },
  })
  if (!membership || membership.status !== 'active') {
    throw new Error('That person is not an active member of this community')
  }
  await prisma.teamMember.upsert({
    where: { team_member_identity: { teamId, userId } },
    create: { teamId, userId, role, addedBy: actor.userId },
    update: { role },
  })
}

export async function removeTeamMember(
  communityId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  const team = await prisma.team.findFirst({ where: { id: teamId, communityId }, select: { id: true } })
  if (!team) throw new Error('Unknown team')
  await prisma.teamMember.deleteMany({ where: { teamId, userId } })
}
