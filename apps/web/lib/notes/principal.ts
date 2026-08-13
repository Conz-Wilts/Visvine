// Principal resolution. Builds the explicit ContextPrincipal every context-service function takes: the
// session identity plus the space-admin flag and the caller's context access
// (grants + folder boundaries). Routes typically call resolveContext()
// (lib/notes/resolve.ts) first and derive the principal from its result.

import { personalSpaceId } from '@/lib/spaces/personalSpace'
import type { ContextPrincipal } from './shared/contextTypes'
import { OPEN_ACCESS } from './shared/authz'

/**
 * The principal for a user acting inside their OWN personal-space space
 * (`me:<userId>`): they own it, so they are its admin and no folder gating
 * applies (OPEN_ACCESS — personal contexts are never grant-gated). Pair with
 * resolvePersonalContext (lib/notes/resolve.ts), which provisions the space
 * on first use.
 */
export function personalPrincipal(identity: {
  userId: string
  email?: string | null
  name: string
}): ContextPrincipal {
  return {
    userId: identity.userId,
    email: identity.email ?? '',
    name: identity.name,
    spaceId: personalSpaceId(identity.userId),
    spaceAdmin: true,
    access: OPEN_ACCESS,
  }
}
