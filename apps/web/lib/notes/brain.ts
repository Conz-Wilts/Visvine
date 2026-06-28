// Brain resolution + authorization for the notes feature. A "brain" is one
// independent collection of notes within a community:
//   - the shared Community brain (ownerKey 'shared') — every member can read &
//     edit; only admins or a note's author can delete/rename it.
//   - a member's personal brain (ownerKey = their userId) — private to them.
// Routes call resolveBrain() right after requireSession(); it returns either a
// ResolvedBrain or a ready-to-return error Response (mirroring requireSession).

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { isAdmin } from '@/lib/auth'
import type { SessionPayload } from '@/lib/session'
import { SHARED_OWNER_KEY, type Brain, type Actor } from './store'

export type Scope = 'shared' | 'personal'

export interface ResolvedBrain extends Brain {
  scope: Scope
  isAdmin: boolean // admin of this community (super admins included)
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
 * Resolve and authorize the brain a request targets. `scope` defaults to
 * 'personal'. Returns a 400/403 Response when the community is missing or the
 * caller isn't a member; otherwise the ResolvedBrain.
 */
export async function resolveBrain(
  session: SessionPayload,
  communityId: string | null | undefined,
  scope: string | null | undefined,
): Promise<ResolvedBrain | Response> {
  if (!communityId) {
    return NextResponse.json({ error: 'communityId is required' }, { status: 400 })
  }
  const resolvedScope: Scope = scope === 'shared' ? 'shared' : 'personal'
  const admin = await isAdmin(session.userId, communityId, session.email)
  const member = admin || (await isMember(session.userId, communityId))
  if (!member) {
    return NextResponse.json({ error: 'Not a member of this community' }, { status: 403 })
  }
  return {
    communityId,
    ownerKey: resolvedScope === 'shared' ? SHARED_OWNER_KEY : session.userId,
    scope: resolvedScope,
    isAdmin: admin,
    actor: { id: session.userId, name: session.name, email: session.email },
  }
}

/**
 * Whether the caller may delete/rename a note. Personal-brain notes are always
 * the caller's own. In the shared brain, only community admins or the note's
 * original author may remove/rename it; any member may still edit content.
 */
export function canRemove(brain: ResolvedBrain, noteCreatedBy: string | null): boolean {
  if (brain.scope === 'personal') return true
  return brain.isAdmin || noteCreatedBy === brain.actor.id
}
