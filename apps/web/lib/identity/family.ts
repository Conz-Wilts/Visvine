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
