// Brain resolution + authorization for the notes feature. Every community has
// exactly ONE brain — its shared brain (ownerKey 'shared'). A user's personal
// context lives in the shared brain of their personal-space community
// (`me:<userId>`, created at onboarding) — there are no per-community personal
// brains anymore. Access to a normal community's brain is gated by the registry
// root entry (see registry.ensureBrainGate): joining the community does not by
// itself grant brain access. Routes call resolveBrain() right after
// requireSession(); it returns either a ResolvedBrain or a ready-to-return
// error Response (mirroring requireSession).

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { isAdmin } from '@/lib/auth'
import type { SessionPayload } from '@/lib/session'
import { provisionPersonalCommunity, personalCommunityId } from '@/lib/onboarding/personalCommunity'
import { SHARED_OWNER_KEY, type Brain, type Actor } from './store'
import type { BrainPrincipal } from './shared/brainTypes'
import { ensureBrainGate, resolveRegistry } from './registry'

// Kept for route/client compat; every scope now resolves to the shared brain.
type Scope = 'shared' | 'personal'

export interface ResolvedBrain extends Brain {
  scope: Scope
  isAdmin: boolean // admin of this community (super admins included)
  /** Set when this community is a personal space (its owner's private brain). */
  isPersonalSpace: boolean
  actor: Actor
}

async function isMember(userId: string, communityId: string): Promise<boolean> {
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { userId: true },
  })
  return membership !== null
}

/**
 * Resolve and authorize the brain a request targets — always the community's
 * shared brain (the `scope` parameter is accepted for compatibility and
 * ignored). Returns a 400/403 Response when the community is missing or the
 * caller isn't a member; a foreign personal space is a 403 like any
 * non-membership.
 */
export async function resolveBrain(
  session: SessionPayload,
  communityId: string | null | undefined,
  scope?: string | null | undefined,
): Promise<ResolvedBrain | Response> {
  void scope
  if (!communityId) {
    return NextResponse.json({ error: 'communityId is required' }, { status: 400 })
  }
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { personalOwnerId: true },
  })
  if (!community) {
    return NextResponse.json({ error: 'Unknown community' }, { status: 404 })
  }
  const admin = await isAdmin(session.userId, communityId, session.email)
  const member = admin || (await isMember(session.userId, communityId))
  if (!member) {
    return NextResponse.json({ error: 'Not a member of this community' }, { status: 403 })
  }
  return {
    communityId,
    ownerKey: SHARED_OWNER_KEY,
    scope: 'shared',
    isAdmin: admin,
    isPersonalSpace: community.personalOwnerId !== null,
    actor: { id: session.userId, name: session.name, email: session.email },
  }
}

/**
 * The caller's personal brain: the shared brain of their personal-space
 * community, provisioning it if onboarding never did (idempotent).
 */
export async function resolvePersonalBrain(identity: {
  userId: string
  name: string
  email?: string | null
}): Promise<Brain> {
  const communityId = personalCommunityId(identity.userId)
  const existing = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true } })
  if (!existing) {
    await provisionPersonalCommunity(identity)
  }
  return { communityId, ownerKey: SHARED_OWNER_KEY }
}

/**
 * The BrainPrincipal for an already-resolved brain — the explicit identity every
 * brainService call takes. Loads the shared brain's folder registry per call so
 * membership changes apply immediately; for normal communities this also
 * materializes the brain gate (root entry) on first touch. Personal spaces are
 * never gated.
 */
export async function principalOf(resolved: ResolvedBrain): Promise<BrainPrincipal> {
  const folders = resolved.isPersonalSpace
    ? await resolveRegistry(resolved.communityId)
    : await ensureBrainGate(resolved.communityId)
  return {
    userId: resolved.actor.id,
    email: resolved.actor.email ?? '',
    name: resolved.actor.name,
    communityId: resolved.communityId,
    communityAdmin: resolved.isAdmin,
    folders,
  }
}

/**
 * Whether the caller may delete/rename a note. In a personal space the caller
 * is the owner. Elsewhere, only community admins or the note's original author
 * may remove/rename it; folder write-gating applies on top in the routes.
 */
export function canRemove(brain: ResolvedBrain, noteCreatedBy: string | null): boolean {
  if (brain.isPersonalSpace) return true
  return brain.isAdmin || noteCreatedBy === brain.actor.id
}
