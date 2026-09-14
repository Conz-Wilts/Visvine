// Creating a space — the one routine behind the switcher's "Create space" and
// the migration that turns record-only cards into real spaces. Every space
// starts the same way: a row, an Admin holder, seeded access state, a member
// node and a root index. What differs is who is put in it.
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { slugify } from '@/lib/eventUtils'
import { ADMIN_ALIAS_ID, ADMIN_ALIAS_NAME } from '@/lib/types/context'
import { defaultFeatureConfig } from '@/lib/featureAccess'
import { markAccessSeeded } from '@/lib/notes/access'
import { ensureMemberNode } from '@/lib/spaces/memberNode'
import { isReservedSpaceId } from '@/lib/spaces/globalSpace'
import { ensureRootIndex, SHARED_OWNER_KEY } from '@/lib/notes/store'
import { logger } from '@/lib/logger'
import { findPublicNameConflict, publicNameTakenMessage, type SpaceVisibility } from './publicName'
import { findSiblingNameConflict, subspaceParentDenial } from './subspaceAccess'
import { flowsContext, presetByKey, visibilityForListing, type Door, type Listing } from './subspaces'
import { LEVEL_VIEW } from '@/lib/notes/shared/authz'

export interface ProvisionInput {
  name: string
  description?: string
  location?: string | null
  visibility?: SpaceVisibility
  /** Becomes the space's first member and holds its Admin alias. */
  creator: { id: string; name: string; email?: string | null }
  /** False = a record: the space exists and nobody is in it yet. */
  joinCreator?: boolean
  /**
   * Set = a sub-space of that space (docs/sub-spaces.md): one level deep,
   * named uniquely among its siblings, its own tenant otherwise. The caller
   * decides who may create one (the parent's admins, at the route).
   */
  parentId?: string | null
  /**
   * A room's four dials (docs/sub-spaces.md), or a preset that fills them.
   * `listing` decides `visibility` for a room (world ⇔ public). Governance
   * defaults ON: the creator is an admin of the house, so the house's admins
   * hold the room's keys until the room says otherwise.
   */
  preset?: string | null
  listing?: Listing
  houseDoor?: Door
  worldDoor?: Door
  flowContext?: boolean
  flowEvents?: boolean
  flowPeople?: boolean
  parentAdmins?: boolean
}

export type ProvisionResult =
  | { ok: true; space: { id: string; name: string; description: string | null; location: string | null; tags: string[]; createdAt: Date; visibility: string; parentId: string | null } }
  | { ok: false; status: 400 | 403 | 409; error: string; code?: 'name_taken' }

/**
 * Derive a free id from the name: never a reserved id, never one already
 * taken. Not transactional — the PK is the backstop for a race.
 */
async function freeSpaceId(name: string): Promise<string> {
  const base = slugify(name) || 'space'
  let id = isReservedSpaceId(base) ? `${base}-2` : base
  for (let n = 2; await prisma.space.findUnique({ where: { id }, select: { id: true } }); n++) {
    id = `${base}-${n}`
  }
  return id
}

export async function provisionSpace(input: ProvisionInput): Promise<ProvisionResult> {
  const name = input.name.trim()
  if (!name) return { ok: false, status: 400, error: 'Space name is required' }
  const preset = input.parentId ? presetByKey(input.preset) : null
  const listing: Listing | undefined = input.parentId
    ? input.listing ?? preset?.listing ?? (input.visibility === 'public' ? 'world' : 'house')
    : undefined
  const visibility = listing ? visibilityForListing(listing) : input.visibility ?? 'private'
  const dials = input.parentId
    ? {
        listing,
        houseDoor: input.houseDoor ?? preset?.houseDoor ?? (listing === 'world' ? 'open' : 'ask'),
        worldDoor: input.worldDoor ?? preset?.worldDoor ?? 'open',
        flowContext: input.flowContext ?? preset?.flowContext ?? listing !== 'secret',
        flowEvents: input.flowEvents ?? preset?.flowEvents ?? listing !== 'secret',
        flowPeople: input.flowPeople ?? preset?.flowPeople ?? false,
        parentAdmins: input.parentAdmins ?? preset?.parentAdmins ?? true,
      }
    : {}

  // Only public names have to be unique platform-wide — a private space can be
  // called anything (lib/spaces/publicName.ts).
  if (visibility === 'public') {
    const clash = await findPublicNameConflict(name)
    if (clash) return { ok: false, status: 409, error: publicNameTakenMessage(clash.name), code: 'name_taken' }
  }

  const parentId = input.parentId || null
  if (parentId) {
    const denied = await subspaceParentDenial(parentId)
    if (denied) return { ok: false, status: denied === 'Unknown space' ? 400 : 403, error: denied }
    const sibling = await findSiblingNameConflict(parentId, name)
    if (sibling) return { ok: false, status: 409, error: sibling.message, code: 'name_taken' }
  }

  const id = await freeSpaceId(name)
  const joinCreator = input.joinCreator !== false

  const space = await prisma.$transaction(async (tx) => {
    const created = await tx.space.create({
      data: {
        id,
        name,
        description: input.description?.trim() ?? '',
        location: input.location?.trim() || null,
        visibility,
        parentId,
        ...dials,
        inviteToken: randomUUID(),
        // Most toggleable tools start off, opted in from the console. Core
        // keys — directory, notes, events — are always on and never persisted.
        featureConfig: defaultFeatureConfig() as object,
      },
    })
    if (joinCreator) {
      await tx.spaceMember.create({ data: { userId: input.creator.id, spaceId: id, status: 'active' } })
      // Every space's Person aliases start with the built-in Admin one (the
      // aliases column default). The creator holds it — otherwise nobody could
      // ever manage the space (lib/auth.ts#isAdmin).
      await tx.userAlias.create({
        data: { spaceId: id, userId: input.creator.id, aliasId: ADMIN_ALIAS_ID, addedBy: input.creator.id },
      })
    }
    // A room whose context flows up is read under its space-wide grants
    // (lib/notes/federation.ts). Born with none it would flow nothing, so it
    // starts with everyone in it able to view from the root — the one grant
    // its admins can revoke or narrow later.
    if (parentId && flowsContext({ visibility, parentId, ...dials })) {
      await tx.contextGrant.create({
        data: {
          spaceId: id,
          subjectType: 'space',
          subjectId: '',
          resourcePath: '',
          level: LEVEL_VIEW,
          grantedBy: input.creator.id,
        },
      })
    }
    return created
  })

  // Access here is decided by aliases from the start, so there is nothing to
  // grandfather — without this, the first context touch would hand a root grant
  // to every member and swamp the alias grants (lib/notes/access.ts).
  await markAccessSeeded(id)

  // A new space gets NO node for itself: the space IS the container, not an
  // entity inside it. The creator's person node is the only node it starts
  // with — carrying the Admin alias, bridged to their account. Best-effort:
  // a member without a node is recoverable, a failed create is not.
  const actor = { id: input.creator.id, name: input.creator.name, email: input.creator.email ?? null }
  if (joinCreator) await ensureMemberNode(id, input.creator.id, actor, ADMIN_ALIAS_NAME)

  try {
    await ensureRootIndex({ spaceId: id, ownerKey: SHARED_OWNER_KEY }, name, actor)
  } catch (err) {
    logger.warn('spaces.root_index_failed', { spaceId: id, err })
  }

  // What the house shares with every room reaches this one from birth
  // (lib/tools/share.ts). Dynamic: tools import the store, which imports here.
  if (parentId) {
    try {
      const share = await import('@/lib/tools/share')
      await share.syncSharedToolsIntoRoom(id)
    } catch (err) {
      logger.warn('spaces.shared_tools_failed', { spaceId: id, err })
    }
  }

  return {
    ok: true,
    space: {
      id: space.id,
      name: space.name,
      description: space.description,
      location: space.location,
      tags: space.tags,
      createdAt: space.createdAt,
      visibility: space.visibility,
      parentId: space.parentId,
    },
  }
}
