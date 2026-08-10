// A one-line "who can see this path" summary computed purely from grant rows —
// the shape the MCP tools expose so an agent can pick where to store a note.
// Structurally incapable of enumerating members: the input is grant rows only
// (community/alias/user + level + path), never user names, and user grants are
// COUNTED in the output rather than named. Community admins always see
// everything, so every summary ends in "admins".
//
// Pure — no Prisma/Node/DOM imports; usable from server, client, and tests.
import { grantReaches, isRestrictedPath, LEVEL_VIEW, type AccessGrant } from './authz'

type AudienceKind = 'admins-only' | 'everyone' | 'aliases' | 'mixed' | 'you-only'

export interface AudienceSummary {
  audience: AudienceKind
  restricted: boolean
  /** One line, never naming individual members other than "you". */
  line: string
}

const DEFAULT_MAX_ALIASES = 4

/**
 * Summarise who can READ `path`, given every grant row in the community
 * (loadCommunityAccess) and the restricted-folder cuts. O(grants × restricted),
 * bounded by grant rows — not community size — since community-wide access is
 * one row and alias access is one row per alias.
 */
export function audienceSummary(
  path: string,
  grants: AccessGrant[],
  restricted: string[],
  opts: { selfUserId: string; communityName?: string; maxAliases?: number },
): AudienceSummary {
  const reaching = grants.filter(
    (g) => g.level >= LEVEL_VIEW && grantReaches(g, path, restricted),
  )
  const flagged = isRestrictedPath(restricted, path)

  const everyone = reaching.some((g) => g.subjectType === 'community')
  const aliasNames = [...new Set(
    reaching.filter((g) => g.subjectType === 'alias').map((g) => g.subjectId),
  )].sort()
  const userIds = new Set(
    reaching.filter((g) => g.subjectType === 'user').map((g) => g.subjectId),
  )
  const selfReached = userIds.delete(opts.selfUserId)
  const otherUsers = userIds.size

  let audience: AudienceKind
  let line: string
  if (everyone) {
    audience = 'everyone'
    line = `everyone in ${opts.communityName ?? 'this space'}`
  } else if (aliasNames.length === 0 && otherUsers === 0) {
    if (selfReached) {
      audience = 'you-only'
      line = 'you + admins only'
    } else {
      audience = 'admins-only'
      line = 'admins only'
    }
  } else {
    const parts: string[] = []
    if (aliasNames.length > 0) {
      const max = opts.maxAliases ?? DEFAULT_MAX_ALIASES
      const shown = aliasNames.slice(0, max).join(', ')
      const more = aliasNames.length > max ? ` (+${aliasNames.length - max} more)` : ''
      parts.push(`aliases: ${shown}${more}`)
    }
    if (otherUsers > 0) parts.push(`${otherUsers} direct grant${otherUsers === 1 ? '' : 's'}`)
    if (selfReached) parts.push('you')
    audience = otherUsers > 0 ? 'mixed' : 'aliases'
    line = `${parts.join(' + ')} + admins`
  }

  if (flagged) line = `restricted — ${line}`
  return { audience, restricted: flagged, line }
}
