/**
 * The base layer: an empty database, the two anchor users, Visvine HQ and its
 * two rooms — each space created the way the app creates one
 * (lib/spaces/provision.ts), then configured the way an admin would from the
 * console: its node types, its alias vocabulary and the grants behind it, and
 * the tools switched on.
 */

import prisma from '../../../lib/prisma'
import { provisionSpace } from '../../../lib/spaces/provision'
import { ensureMemberNode } from '../../../lib/spaces/memberNode'
import { defaultFeatureConfig } from '../../../lib/featureAccess'
import { SHARED_OWNER_KEY, type Actor } from '../../../lib/notes/store'
import { ADMIN_ALIAS_NAME } from '../../../lib/types/context'
import {
  ADMIN_NODE,
  ADMIN_USER,
  ALIASES,
  ANCHORS,
  MEMBER_NODE,
  NODE_TYPES,
  SPACE_COUNTRY,
  SPACE_DESCRIPTION,
  SPACE_GRANTS,
  SPACE_ID,
  SPACE_LOCATION,
  SPACE_NAME,
  SPACE_TAGS,
  SPACE_TIMEZONE,
  SUBSPACES,
  seedAliasId,
} from '../space'
import { putNotes } from '../write'

/** Delete everything, in dependency order. */
export async function wipe(): Promise<void> {
  // Anything with onDelete: Cascade goes with its parent; the rest are explicit,
  // including the tables that carry a spaceId with no FK behind it and the
  // platform-wide ones the lived-in layer fills (OAuth clients, rate limits,
  // link previews), which would otherwise accumulate a copy per reseed.
  await prisma.$transaction([
    prisma.link.deleteMany({}),
    prisma.eventAttendee.deleteMany({}),
    prisma.resourceComment.deleteMany({}),
    prisma.resourceChange.deleteMany({}),
    prisma.resource.deleteMany({}),
    prisma.resourceFolder.deleteMany({}),
    prisma.spaceMember.deleteMany({}),
    prisma.identityResolution.deleteMany({}),
    prisma.node.deleteMany({}),
    prisma.identity.deleteMany({}),
    prisma.oAuthAuthCode.deleteMany({}),
    prisma.oAuthClient.deleteMany({}),
    prisma.user.deleteMany({}),
    // Sub-spaces before their parents: the parent relation is Restrict.
    prisma.space.deleteMany({ where: { parentId: { not: null } } }),
    prisma.space.deleteMany({}),
    // The marketplace registry is deliberately not space-keyed (a published
    // version outlives its author space); with every space gone there is no
    // install left to protect.
    prisma.appToolVersion.deleteMany({}),
    prisma.linkPreview.deleteMany({}),
    prisma.rateLimitBucket.deleteMany({}),
    prisma.agentHeartbeat.deleteMany({}),
  ])
}

export const anchorActor = (userId: string): Actor => {
  const a = ANCHORS.find((x) => x.id === userId)
  if (!a) throw new Error(`seed: no anchor ${userId}`)
  return { id: a.id, name: a.name, email: a.email }
}

async function createAnchorUsers(): Promise<void> {
  for (const a of ANCHORS) {
    await prisma.user.create({
      data: {
        id: a.id,
        email: a.email,
        name: a.name,
        isActive: true,
        subtitle: a.profile.subtitle,
        bio: a.profile.bio,
        location: a.profile.location,
        website: a.profile.website,
        phone: a.profile.phone,
        pronouns: a.profile.pronouns,
        createdAt: new Date(Date.now() - a.profile.joinedDaysAgo * 86_400_000),
      },
    })
  }
}

/**
 * Join a member the way every member-add path does: the membership, the Person
 * aliases they hold, and the connected person node (lib/spaces/memberNode.ts).
 * The creator's membership and Admin alias come from provisionSpace itself.
 */
async function join(spaceId: string, userId: string, aliases: string[], chip: string | null): Promise<string> {
  await prisma.spaceMember.upsert({
    where: { userId_spaceId: { userId, spaceId } },
    create: { userId, spaceId, status: 'active' },
    update: {},
  })
  for (const name of aliases) {
    const aliasId = seedAliasId(name)
    const held = await prisma.userAlias.findFirst({ where: { spaceId, userId, aliasId } })
    if (!held) await prisma.userAlias.create({ data: { spaceId, userId, aliasId, addedBy: ADMIN_USER } })
  }
  const nodeId = await ensureMemberNode(spaceId, userId, anchorActor(ADMIN_USER), chip)
  if (!nodeId) throw new Error(`seed: no member node for ${userId} in ${spaceId}`)
  // The chip is space-local and only stamped on a NEW node; the creator's was
  // minted as Admin before the vocabulary existed, so set it to what they wear.
  if (chip) await prisma.node.update({ where: { id: nodeId }, data: { alias: chip } })
  return nodeId
}

export async function seedBase(): Promise<void> {
  await createAnchorUsers()
  const admin = anchorActor(ADMIN_USER)

  const hq = await provisionSpace({
    name: SPACE_NAME,
    description: SPACE_DESCRIPTION,
    location: SPACE_LOCATION,
    // Demo content is meant to show up in Discover.
    visibility: 'public',
    creator: admin,
  })
  if (!hq.ok) throw new Error(`seed: provisioning ${SPACE_NAME} failed: ${hq.error}`)
  if (hq.space.id !== SPACE_ID) {
    throw new Error(`seed: ${SPACE_NAME} provisioned as "${hq.space.id}", but scripts/seed/space.ts says "${SPACE_ID}"`)
  }

  // What an admin sets from the console. Channels is the one optional tool, and
  // this space runs it — the demo has sections, channels and messages in it.
  const featureConfig = defaultFeatureConfig()
  featureConfig.enabled = { ...featureConfig.enabled, channels: true }
  await prisma.space.update({
    where: { id: SPACE_ID },
    data: {
      tags: [...SPACE_TAGS],
      country: SPACE_COUNTRY,
      timezone: SPACE_TIMEZONE,
      nodeTypes: NODE_TYPES,
      featureConfig: featureConfig as object,
      aliases: ALIASES.map((a) => ({
        id: seedAliasId(a.name),
        name: a.name,
        color: a.color,
        nodeType: a.nodeType,
        ...(a.admin ? { admin: true } : {}),
        ...(a.system ? { system: true } : {}),
      })),
    },
  })

  await prisma.contextGrant.createMany({
    data: [
      ...ALIASES.flatMap((a) =>
        a.grants.map(([resourcePath, level]) => ({
          spaceId: SPACE_ID,
          subjectType: 'alias',
          subjectId: seedAliasId(a.name),
          resourcePath,
          level,
          grantedBy: ADMIN_USER,
        })),
      ),
      ...SPACE_GRANTS.map(([resourcePath, level]) => ({
        spaceId: SPACE_ID,
        subjectType: 'space',
        subjectId: '',
        resourcePath,
        level,
        grantedBy: ADMIN_USER,
      })),
    ],
  })

  for (const a of ANCHORS) {
    const chip = a.aliases.find((n) => n !== ADMIN_ALIAS_NAME) ?? null
    const nodeId = await join(SPACE_ID, a.id, a.aliases.filter((n) => n !== ADMIN_ALIAS_NAME), chip)
    if (nodeId !== a.personNodeId) {
      throw new Error(`seed: ${a.email}'s node is "${nodeId}", but scripts/seed/space.ts says "${a.personNodeId}"`)
    }
    // Their own profile node: the card in the space they call home.
    await prisma.user.update({ where: { id: a.id }, data: { nodeId } })
  }
  if (ANCHORS[0].personNodeId !== ADMIN_NODE || ANCHORS[1].personNodeId !== MEMBER_NODE) {
    throw new Error('seed: ADMIN_NODE / MEMBER_NODE disagree with ANCHORS')
  }

  for (const sub of SUBSPACES) {
    const room = await provisionSpace({
      name: sub.name,
      description: sub.description,
      creator: admin,
      parentId: SPACE_ID,
      preset: sub.preset,
      ...('flowContext' in sub ? { flowContext: sub.flowContext } : {}),
    })
    if (!room.ok) throw new Error(`seed: provisioning ${sub.name} failed: ${room.error}`)
    if (room.space.id !== sub.id) {
      throw new Error(`seed: ${sub.name} provisioned as "${room.space.id}", but scripts/seed/space.ts says "${sub.id}"`)
    }
    for (const userId of sub.members) {
      if (userId !== ADMIN_USER) await join(sub.id, userId, [], null)
    }
    await putNotes({ spaceId: sub.id, ownerKey: SHARED_OWNER_KEY }, [...sub.notes], admin)
  }
}
