// Principal resolution — the port of blackbird-brain's src/server/identity.ts.
// Builds the explicit BrainPrincipal every brain-service function takes: the
// session identity plus the community-admin flag and the shared brain's folder
// registry. Routes typically call resolveBrain() (lib/notes/brain.ts) first and
// derive the principal from its result.

import { personalCommunityId } from '@/lib/onboarding/personalCommunity'
import type { BrainPrincipal } from './shared/brainTypes'
import { EMPTY_REGISTRY } from './shared/brainTypes'

/**
 * The principal for a user acting inside their OWN personal-space community
 * (`me:<userId>`): they own it, so they are its admin and no folder gating
 * applies. Pair with resolvePersonalBrain (lib/notes/brain.ts), which
 * provisions the community when onboarding never did.
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
    folders: EMPTY_REGISTRY,
  }
}
