/**
 * What Console → iMessage shows and saves (docs/imessage.md § Surfaces).
 *
 * One read of the space's whole iMessage state: the line, the switch, the
 * `phone` agent, the model it would run on, how many members are linked, and
 * the rooms a text could reach. Admin-only, like the section.
 */
import prisma from '@/lib/prisma'
import { mergeFeatureConfig } from '@/lib/featureAccess'
import { updateSpaceConfig } from '@/lib/spaces/spaceConfig'
import { findAgentBrief } from '@/lib/agents/briefs'
import { createAgentBrief } from '@/lib/agents/service'
import { noModelReason, spaceModels } from '@/lib/agents/spaceModels'
import { isSuperAdmin } from '@/lib/session'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { grantAccess } from '@/lib/notes/access'
import { LEVEL_VIEW } from '@/lib/notes/shared/authz'
import { agentFolderPath } from '@/lib/agents/config'
import { IMESSAGE_FEATURE_KEY, imessageOn, lineForSpace, renameLine } from './lines'
import { countLinkedMembers } from './links'
import { pushLineProfile } from './profile'
import { sendblueConfigured } from './sendblue'
import { PHONE_AGENT, PHONE_BRIEF_DESCRIPTION, PHONE_BRIEF_TITLE, phoneBriefBody } from './shared/brief'

export interface ImessageConsole {
  /** Deployment has Sendblue keys; without them nothing here can work. */
  configured: boolean
  line: { number: string; name: string | null; status: 'active' | 'suspended'; profileAt: string | null } | null
  enabled: boolean
  agent: { path: string } | null
  /** Why no model could run the agent, or null when one can. */
  modelProblem: string | null
  linked: number
  /** Rooms whose texts this line would also answer (they hold a `phone` agent). */
  rooms: Array<{ id: string; name: string }>
  /** The caller may assign or move the line (super-admin). */
  canAssign: boolean
}

export async function describeImessage(spaceId: string, viewerEmail: string | null | undefined): Promise<ImessageConsole> {
  const [space, line, brief, models, linked, rooms] = await Promise.all([
    prisma.space.findUnique({ where: { id: spaceId }, select: { featureConfig: true } }),
    lineForSpace(spaceId),
    findAgentBrief(spaceId, PHONE_AGENT),
    spaceModels(spaceId),
    countLinkedMembers(spaceId),
    prisma.agentState.findMany({
      where: { name: PHONE_AGENT, space: { parentId: spaceId } },
      select: { spaceId: true, space: { select: { name: true } } },
      orderBy: { space: { name: 'asc' } },
    }),
  ])
  return {
    configured: sendblueConfigured(),
    line: line ? { number: line.number, name: line.name, status: line.status, profileAt: line.profileAt?.toISOString() ?? null } : null,
    enabled: imessageOn(space?.featureConfig),
    agent: brief ? { path: brief.path } : null,
    modelProblem: noModelReason(models),
    linked,
    rooms: rooms.map((r) => ({ id: r.spaceId, name: r.space.name })),
    canAssign: isSuperAdmin(viewerEmail),
  }
}

export async function setImessageEnabled(spaceId: string, enabled: boolean): Promise<void> {
  await updateSpaceConfig(spaceId, (stored) => ({
    featureConfig: mergeFeatureConfig(stored.featureConfig, { enabled: { [IMESSAGE_FEATURE_KEY]: enabled } }),
  }))
}

/** The shown name; the contact card follows. */
export async function setLineName(spaceId: string, name: string | null): Promise<boolean> {
  const row = await renameLine(spaceId, name)
  if (!row) return false
  await pushLineProfile(spaceId).catch(() => undefined)
  return true
}

/**
 * Write agents/phone/index.md from the starter brief, as the admin.
 *
 * The folder gets a space-wide VIEW grant: a text runs the agent AS the
 * texter, and the runner refuses a run whose person cannot read the brief —
 * so "every member may text the line" and "every member may read
 * agents/phone" are the same fact. The grant is the ordinary kind and an
 * admin can narrow it on the note's Share panel like any other.
 */
export async function createPhoneAgent(p: ContextPrincipal, spaceId: string) {
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { name: true } })
  const created = await createAgentBrief(p, { spaceId, ownerKey: SHARED_OWNER_KEY }, {
    name: PHONE_AGENT,
    title: PHONE_BRIEF_TITLE,
    description: PHONE_BRIEF_DESCRIPTION,
    tools: ['actions', 'web', 'directory'],
    body: phoneBriefBody(space?.name ?? 'this space'),
  })
  if (created.ok) {
    await grantAccess(
      spaceId,
      { subjectType: 'space', subjectId: '', resourcePath: agentFolderPath(PHONE_AGENT), level: LEVEL_VIEW },
      { userId: p.userId, name: p.name },
    )
  }
  return created
}
