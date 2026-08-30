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

export interface ProvisionInput {
  name: string
  description?: string
  location?: string | null
  visibility?: SpaceVisibility
  /** Becomes the space's first member and holds its Admin alias. */
  creator: { id: string; name: string; email?: string | null }
  /** False = a record: the space exists and nobody is in it yet. */
  joinCreator?: boolean
}

export type ProvisionResult =
  | { ok: true; space: { id: string; name: string; description: string | null; location: string | null; tags: string[]; createdAt: Date; visibility: string } }
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
  const visibility = input.visibility ?? 'private'

  // Only public names have to be unique platform-wide — a private space can be
  // called anything (lib/spaces/publicName.ts).
  if (visibility === 'public') {
    const clash = await findPublicNameConflict(name)
    if (clash) return { ok: false, status: 409, error: publicNameTakenMessage(clash.name), code: 'name_taken' }
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
    },
  }
}
