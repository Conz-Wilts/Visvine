// The Visvine global space: one public space, owned by the platform, whose
// shared context holds the canonical public record of every person the
// platform knows about — one `people/<slug>.md` note and one person node per
// Identity that appears somewhere public (a public space's directory, or a
// member's own profile).
//
// It is a real Space row so that everything built for a space — the context
// tree, search, entity folders, publications — works on it unchanged. What
// makes it special is who may read and write it, and both rules live in code,
// keyed on this id:
//
//   - every signed-in user may READ it (lib/auth.ts#spaceMemberForbidden);
//     nobody is a member and nobody joins;
//   - a person's own record is WRITTEN by that person (the Identity's claimed
//     user) or a super-admin, and maintained by lib/global/record.ts; nothing
//     else in it is writable by anyone but a super-admin.
//
// Other spaces do not connect person nodes to MEMBERS any more; they bind them
// to the global record (lib/global/binding.ts), which may or may not be claimed.

import prisma from '@/lib/prisma'

export const GLOBAL_SPACE_ID = 'visvine'
export const GLOBAL_SPACE_NAME = 'Visvine'

export function isGlobalSpace(spaceId: string | null | undefined): boolean {
  return spaceId === GLOBAL_SPACE_ID
}

/** Space ids nobody may create a space under — see app/api/spaces/route.ts. */
export function isReservedSpaceId(id: string): boolean {
  return isGlobalSpace(id) || id.startsWith('me:')
}

/**
 * Create the global space if it is missing. Idempotent; safe to call from any
 * write path that is about to put a record in it. Public so the finder's
 * existing visibility clauses (app/api/nodes/search/route.ts) surface its
 * nodes to everyone without a special case.
 */
export async function ensureGlobalSpace(): Promise<string> {
  await prisma.space.upsert({
    where: { id: GLOBAL_SPACE_ID },
    create: {
      id: GLOBAL_SPACE_ID,
      name: GLOBAL_SPACE_NAME,
      description:
        'The public record. Everyone the platform knows about, gathered from public spaces and member profiles.',
      visibility: 'public',
      tags: ['global'],
    },
    update: { visibility: 'public', personalOwnerId: null },
  })
  return GLOBAL_SPACE_ID
}
