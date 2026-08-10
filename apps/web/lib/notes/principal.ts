// Principal resolution — the port of blackbird-brain's src/server/identity.ts.
// Builds the explicit BrainPrincipal every brain-service function takes: the
// session identity plus the community-admin flag and the caller's brain access
// (grants + folder boundaries). Routes typically call resolveBrain()
// (lib/notes/brain.ts) first and derive the principal from its result.

import { personalCommunityId } from '@/lib/communities/personalCommunity'
import type { BrainPrincipal } from './shared/brainTypes'
import { OPEN_ACCESS } from './shared/authz'

/**
 * The principal for a user acting inside their OWN personal-space community
 * (`me:<userId>`): they own it, so they are its admin and no folder gating
 * applies (OPEN_ACCESS — personal brains are never grant-gated). Pair with
 * resolvePersonalBrain (lib/notes/brain.ts), which provisions the community
 * on first use.
 */
export function personalPrincipal(identity: {
  userId: string
  email?: string | null
  name: string
}): BrainPrincipal {
  return {
    userId: identity.userId,
    email: identity.email ?? '',
    name: identity.name,
    communityId: personalCommunityId(identity.userId),
    communityAdmin: true,
    access: OPEN_ACCESS,
  }
}
