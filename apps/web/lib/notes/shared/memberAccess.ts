// What ONE member can reach in a space's context, and why — the read side of
// the grant model (authz.ts) as a console needs it: every grant that applies to
// a person, tagged with where it came from, plus the one-line summary a member
// list shows beside their name.
//
// Pure — no Prisma/Node/DOM imports; usable from server, client, and tests.

import {
  effectiveLevel,
  levelDisplayLabel,
  levelName,
  readableRoots,
  LEVEL_VIEW,
  type AccessGrant,
  type GrantSubjectType,
} from './authz'

/** How a grant reaches a member: held by every member, by an alias they wear, or theirs alone. */
type ReachVia =
  | { kind: 'everyone' }
  | { kind: 'alias'; aliasId: string; name: string; color: string }
  | { kind: 'direct' }

export interface Reach<G extends AccessGrant = AccessGrant> {
  grant: G
  via: ReachVia
}

export interface MemberStanding {
  userId: string
  /** The aliases the member holds, by stable id — what alias grants key on. */
  aliases: Array<{ id: string; name: string; color: string }>
}

/**
 * Every grant that applies to this member, in the order a reader wants: what
 * everyone has, then each alias they wear, then what is theirs alone. Grants for
 * aliases they do not hold, other people and channels are left out.
 */
export function reachFor<G extends AccessGrant>(
  grants: readonly G[],
  member: MemberStanding,
): Reach<G>[] {
  const byAlias = new Map(member.aliases.map((a) => [a.id, a]))
  const rank: Record<GrantSubjectType, number> = { space: 0, alias: 1, channel: 2, user: 3 }
  const out: Reach<G>[] = []
  for (const grant of grants) {
    // A channel grant follows channel membership (a private channel, a file
    // shared in one): not a standing an admin manages per member.
    if (grant.subjectType === 'channel') continue
    if (grant.subjectType === 'space') out.push({ grant, via: { kind: 'everyone' } })
    else if (grant.subjectType === 'alias') {
      const alias = byAlias.get(grant.subjectId)
      if (alias) out.push({ grant, via: { kind: 'alias', aliasId: alias.id, ...alias } })
    } else if (grant.subjectId === member.userId) out.push({ grant, via: { kind: 'direct' } })
  }
  return out.sort(
    (a, b) =>
      rank[a.grant.subjectType] - rank[b.grant.subjectType] ||
      a.grant.resourcePath.localeCompare(b.grant.resourcePath),
  )
}

/**
 * One line for a member list: "Editor of everything", "Viewer in 3 places",
 * "No access". The root wins when it is reachable, because then every count is
 * a detail of it; otherwise the count is of the distinct places their
 * visibility starts (readableRoots), at the best level any of them carries.
 */
export function accessSummary(
  grants: readonly AccessGrant[],
  member: MemberStanding,
  restricted: string[],
): { label: string; level: number } {
  const access = { grants: reachFor(grants, member).map((r) => r.grant), restricted, locked: [] }
  const atRoot = effectiveLevel(access, '')
  if (atRoot >= LEVEL_VIEW) {
    return { label: `${levelDisplayLabel(levelName(atRoot))} of everything`, level: atRoot }
  }
  const roots = readableRoots(access)
  if (roots.length === 0) return { label: 'No access', level: 0 }
  const best = Math.max(...access.grants.map((g) => g.level))
  return {
    label: `${levelDisplayLabel(levelName(best))} in ${roots.length} ${roots.length === 1 ? 'place' : 'places'}`,
    level: best,
  }
}
