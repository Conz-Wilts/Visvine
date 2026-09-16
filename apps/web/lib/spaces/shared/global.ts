// The global space's identity, as plain data. Pure and leaf so a client
// component can ask "is this the global record?" without pulling the server
// half (lib/spaces/globalSpace.ts, which imports prisma) into the bundle.

import { isSpaceRouteName } from './spaceUrl'

export const GLOBAL_SPACE_ID = 'visvine'
export const GLOBAL_SPACE_NAME = 'Visvine'

/**
 * The Visvine global space: the public record every signed-in user reads and
 * nobody is a member of. It is a real, public Space row, so anything listing
 * public spaces has to exclude it by id — there is nothing to join and no
 * membership to hold.
 */
export function isGlobalSpace(spaceId: string | null | undefined): boolean {
  return spaceId === GLOBAL_SPACE_ID
}

/**
 * Space ids nobody may create a space under — see app/api/spaces/route.ts. A
 * page route is one too: a room's id sits where the page does in its URL
 * (lib/spaces/shared/spaceUrl.ts).
 */
export function isReservedSpaceId(id: string): boolean {
  return isGlobalSpace(id) || id.startsWith('me:') || isSpaceRouteName(id)
}
