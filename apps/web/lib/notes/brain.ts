// Brain resolution + authorization for the notes feature. Every space has
// exactly ONE brain — its shared brain (ownerKey 'shared'). A user's personal
// context lives in the shared brain of their personal-space space
// (`me:<userId>`, provisioned on first use) — there are no per-space personal
// brains anymore. Access to a normal space's brain is grant-gated
// (lib/notes/access.ts): joining the space does not by itself grant brain
// access until a grant reaches you. Routes call resolveBrain() right after
// requireSession(); it returns either a ResolvedBrain or a ready-to-return
// error Response (mirroring requireSession).

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { isAdmin } from '@/lib/auth'
import type { SessionPayload } from '@/lib/session'
import { provisionPersonalSpace, personalSpaceId } from '@/lib/spaces/personalSpace'
import { SHARED_OWNER_KEY, type Brain, type Actor } from './store'
import type { BrainPrincipal } from './shared/brainTypes'
import { OPEN_ACCESS } from './shared/authz'
import { principalCanManage } from './shared/permissions'
import { brainAccessFor, ensureAccessSeeded } from './access'

// Kept for route/client compat; every scope now resolves to the shared brain.
type Scope = 'shared' | 'personal'

export interface ResolvedBrain extends Brain {
  scope: Scope
  isAdmin: boolean // admin of this space (super admins included)
  /** Set when this space is a personal space (its owner's private brain). */
  isPersonalSpace: boolean
  actor: Actor
}

async function isMember(userId: string, spaceId: string): Promise<boolean> {
  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { userId: true },
  })
  return membership !== null
}

/**
 * Resolve and authorize the brain a request targets — always the space's
 * shared brain (the `scope` parameter is accepted for compatibility and
 * ignored). Returns a 400/403 Response when the space is missing or the
 * caller isn't a member; a foreign personal space is a 403 like any
 * non-membership.
 */
export async function resolveBrain(
  session: SessionPayload,
  spaceId: string | null | undefined,
  scope?: string | null | undefined,
): Promise<ResolvedBrain | Response> {
  void scope
  if (!spaceId) {
    return NextResponse.json({ error: 'spaceId is required' }, { status: 400 })
  }
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { personalOwnerId: true },
  })
  if (!space) {
    return NextResponse.json({ error: 'Unknown space' }, { status: 404 })
  }
  // A personal space's owner administers it by definition — it holds no
  // aliases, and never will (grants don't apply there at all).
  const admin =
    space.personalOwnerId === session.userId ||
    (await isAdmin(session.userId, spaceId, session.email))
  const member = admin || (await isMember(session.userId, spaceId))
  if (!member) {
    return NextResponse.json({ error: 'Not a member of this space' }, { status: 403 })
  }
  return {
    spaceId,
    ownerKey: SHARED_OWNER_KEY,
    scope: 'shared',
    isAdmin: admin,
    isPersonalSpace: space.personalOwnerId !== null,
    actor: { id: session.userId, name: session.name, email: session.email },
  }
}

/**
 * The caller's personal brain: the shared brain of their personal-space
 * space, provisioning it on first use (idempotent). This is the only
 * place personal spaces get created.
 */
export async function resolvePersonalBrain(identity: {
  userId: string
  name: string
  email?: string | null
}): Promise<Brain> {
  const spaceId = personalSpaceId(identity.userId)
  const existing = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true } })
  if (!existing) {
    await provisionPersonalSpace(identity)
  }
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/**
 * The BrainPrincipal for an already-resolved brain — the explicit identity every
 * brainService call takes. Loads the caller's grant rows per call so membership,
 * alias, and grant changes apply immediately; for normal spaces this also
 * seeds the grant rows on first touch (migrating a legacy registry, or
 * grandfathering current members — lib/notes/access.ts). Personal spaces are
 * never gated (OPEN_ACCESS).
 */
export async function principalOf(resolved: ResolvedBrain): Promise<BrainPrincipal> {
  let access = OPEN_ACCESS
  if (!resolved.isPersonalSpace) {
    await ensureAccessSeeded(resolved.spaceId)
    access = await brainAccessFor(resolved.spaceId, resolved.actor.id)
  }
  return {
    userId: resolved.actor.id,
    email: resolved.actor.email ?? '',
    name: resolved.actor.name,
    spaceId: resolved.spaceId,
    spaceAdmin: resolved.isAdmin,
    access,
  }
}

/**
 * Whether the caller may delete/rename a note. In a personal space the caller
 * is the owner. Elsewhere: space admins, the note's original author, or a
 * FULL-level grant holder at the note's path (full = manage the subtree,
 * deletes included — pass the principal to enable that check). Folder
 * write-gating applies on top in the routes.
 */
export function canRemove(
  brain: ResolvedBrain,
  noteCreatedBy: string | null,
  manage?: { principal: BrainPrincipal; path: string },
): boolean {
  if (brain.isPersonalSpace) return true
  if (brain.isAdmin || noteCreatedBy === brain.actor.id) return true
  return manage ? principalCanManage(manage.principal, manage.path) : false
}
