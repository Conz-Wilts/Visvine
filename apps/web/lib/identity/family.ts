/**
 * Recognising the same person inside one space family — a house and its rooms.
 *
 * Across the whole platform a bare name is never enough to merge two people
 * (match.ts, Tier C). Inside one family it is: the house and its rooms are one
 * organisation, and a "Priya Shah" added in Marketing while the house already
 * holds a "Priya Shah" is that Priya far more often than not. So a person added
 * anywhere in the family without a strong id takes the identity the rest of the
 * family already uses for that name — when exactly one does. Two different
 * identities under one name is a real ambiguity and falls back to the global
 * resolver, which only suggests. A human `split` or `rejected` is honoured, so
 * a wrong fold is undone once and stays undone.
 *
 * Pure: attachIdentity.ts reads the family's person nodes and applies this.
 */

import { nameKey, normalizeEmail, linkedinHandle } from './normalize'

/** A name a person node elsewhere in the family goes by, and the identity it carries. */
export interface FamilyCandidate {
  identityId: string
  name: string
}

/**
 * The identity a new person node in the family should take, or null.
 * Only for a node with no email or LinkedIn of its own — a strong id is the
 * global resolver's question, and it answers it better.
 */
export function familyIdentityFor(
  node: { name: string; email?: string | null; linkedinUrl?: string | null },
  candidates: FamilyCandidate[],
  rejected: ReadonlySet<string> = new Set(),
): string | null {
  if (normalizeEmail(node.email) || linkedinHandle(node.linkedinUrl)) return null
  const key = nameKey(node.name)
  if (!key) return null
  const ids = new Set<string>()
  for (const c of candidates) {
    if (rejected.has(c.identityId)) continue
    if (nameKey(c.name) !== key) continue
    ids.add(c.identityId)
  }
  return ids.size === 1 ? [...ids][0] : null
}

// ─── Cleanup: folding what was recorded before the rule ─────────────────────

/** A person node in the family as the cleanup sees it. */
export interface CleanupNode {
  id: string
  spaceId: string
  name: string
  identityId: string | null
}

/** What the cleanup needs to know about an identity before folding it into another. */
export interface CleanupIdentity {
  id: string
  /** Claimed by a registered member. Two claimed identities are two accounts, never one person. */
  claimed: boolean
  email: string | null
  linkedinHandle: string | null
  /** Holds a record in the Visvine space — folding it away would strand that record. */
  global: boolean
}

export type CleanupStep =
  /** Give an identity-less node the identity its family already uses. */
  | { kind: 'attach'; nodeId: string; identityId: string }
  /** Move every node on `from` onto `to`: two identities that are one person. */
  | { kind: 'merge'; from: string; to: string; nodeIds: string[] }
  /** No identity anywhere under this name: resolve the lead as a new add would, then the rest follow it. */
  | { kind: 'resolve'; nodeId: string; followers: string[] }

export interface CleanupPlan {
  steps: CleanupStep[]
  /** Names left alone, and why — the worklist for a human. */
  skipped: Array<{ name: string; reason: string }>
}

/**
 * Plan the fold for one family (a house and its rooms, or a space standing
 * alone). Per name, the same rules a new add follows: one identity per
 * person across the family, never folding two claimed accounts, two
 * different emails or LinkedIns, a Visvine record, a recorded split, or two
 * same-named nodes inside ONE space (that is two people, or a duplicate a
 * human has to look at). The house's node picks the survivor when it has one.
 */
export function planFamilyCleanup(input: {
  houseId: string
  nodes: CleanupNode[]
  identities: Map<string, CleanupIdentity>
  splits: Map<string, ReadonlySet<string>>
}): CleanupPlan {
  const { houseId, nodes, identities, splits } = input
  const steps: CleanupStep[] = []
  const skipped: CleanupPlan['skipped'] = []
  const refused = (nodeId: string, identityId: string) => splits.get(nodeId)?.has(identityId) ?? false
  const alone = (group: CleanupNode[]) => {
    for (const n of group) if (!n.identityId) steps.push({ kind: 'resolve', nodeId: n.id, followers: [] })
  }

  const groups = new Map<string, CleanupNode[]>()
  for (const node of nodes) {
    const key = nameKey(node.name)
    if (!key) {
      alone([node])
      continue
    }
    groups.set(key, [...(groups.get(key) ?? []), node])
  }

  for (const group of groups.values()) {
    const name = group[0].name
    const spaces = new Set(group.map((n) => n.spaceId))
    if (spaces.size < group.length) {
      skipped.push({ name, reason: 'the same name twice in one space' })
      alone(group)
      continue
    }

    const held = [...new Set(group.map((n) => n.identityId).filter((x): x is string => !!x))]
    let target: string | null = held.length === 1 ? held[0] : null

    if (held.length > 1) {
      const rows = held.map((id) => identities.get(id)).filter((x): x is CleanupIdentity => !!x)
      const distinct = (values: Array<string | null>) => new Set(values.filter(Boolean)).size
      const houseHeld = group.find((n) => n.spaceId === houseId)?.identityId ?? null
      const survivor =
        rows.find((r) => r.claimed)?.id ??
        houseHeld ??
        [...held].sort((a, b) => group.filter((n) => n.identityId === b).length - group.filter((n) => n.identityId === a).length || a.localeCompare(b))[0]
      const why =
        rows.length !== held.length ? 'an identity is missing'
        : rows.filter((r) => r.claimed).length > 1 ? 'two member accounts'
        : distinct(rows.map((r) => r.email)) > 1 ? 'different emails'
        : distinct(rows.map((r) => r.linkedinHandle)) > 1 ? 'different LinkedIns'
        : rows.some((r) => r.id !== survivor && r.global) ? 'a Visvine record would be stranded'
        : group.some((n) => refused(n.id, survivor)) ? 'a split was recorded'
        : null
      if (why) {
        skipped.push({ name, reason: why })
      } else {
        for (const from of held) {
          if (from === survivor) continue
          steps.push({ kind: 'merge', from, to: survivor, nodeIds: group.filter((n) => n.identityId === from).map((n) => n.id) })
        }
        target = survivor
      }
    }

    const bare = group.filter((n) => !n.identityId)
    if (bare.length === 0) continue
    if (target) {
      for (const n of bare) {
        if (refused(n.id, target)) steps.push({ kind: 'resolve', nodeId: n.id, followers: [] })
        else steps.push({ kind: 'attach', nodeId: n.id, identityId: target })
      }
    } else if (held.length === 0) {
      const lead = bare.find((n) => n.spaceId === houseId) ?? bare[0]
      steps.push({ kind: 'resolve', nodeId: lead.id, followers: bare.filter((n) => n !== lead).map((n) => n.id) })
    } else {
      alone(bare)
    }
  }
  return { steps, skipped }
}
