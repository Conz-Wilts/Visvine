// Spaces nest (docs/sub-spaces.md). These are the pure rules — no database —
// so the create route, the settings route, the join paths and the tests all
// agree on one answer. The DB side (ancestor walks, sibling lookups) is
// lib/spaces/tree.ts.

export type SpaceVisibility = 'public' | 'private' | 'inherit'

/** Root → child → grandchild, and no further. */
export const MAX_SPACE_DEPTH = 3

export function isSpaceVisibility(value: unknown): value is SpaceVisibility {
  return value === 'public' || value === 'private' || value === 'inherit'
}

/** The visibility a freshly created space gets when the caller names none. */
export function defaultVisibility(parentId: string | null | undefined): SpaceVisibility {
  return parentId ? 'inherit' : 'private'
}

/**
 * Why `visibility` is not allowed on a space with this parent, or null when it
 * is. A root cannot inherit (there is nothing to inherit from); a public child
 * needs a public parent, because joining a public child requires joining its
 * parent first and a private parent cannot be joined.
 */
export function visibilityDenial(
  visibility: SpaceVisibility,
  parent: { visibility: string | null } | null,
): string | null {
  if (!parent && visibility === 'inherit') {
    return 'Only a space inside another space can inherit its visibility.'
  }
  if (parent && visibility === 'public' && parent.visibility !== 'public') {
    return 'A space can only be public when the space it lives in is public.'
  }
  return null
}

/**
 * Why a space cannot be created under `parent`, or null when it can.
 * `parentDepth` is 1 for a root space.
 */
export function parentDenial(parent: {
  personalOwnerId: string | null
  isGlobal: boolean
  depth: number
}): string | null {
  if (parent.personalOwnerId) return 'A personal space cannot contain other spaces.'
  if (parent.isGlobal) return 'Visvine cannot contain other spaces.'
  if (parent.depth >= MAX_SPACE_DEPTH) {
    return `Spaces nest at most ${MAX_SPACE_DEPTH} deep.`
  }
  return null
}

/**
 * The comparison key for a space name — used both for public names and for
 * sibling names: case- and whitespace-insensitive, so "Blackbird  VC" can't sit
 * next to "blackbird vc".
 *
 * MUST stay identical to the SQL index expressions
 * `lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))` behind both the public
 * name index and the sibling name index, or the app check and the database
 * backstop will disagree.
 */
export function normalizePublicName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function siblingNameTakenMessage(existingName: string, parentName: string): string {
  return `${parentName} already has a space named "${existingName}". Choose a different name.`
}

/**
 * Can `userId` see and read a space with this visibility, given what they hold?
 * `parentMember` is their active membership in the PARENT, which is what an
 * `inherit` child is visible through. Admin standing (own or inherited from an
 * ancestor) is checked by the caller and short-circuits this.
 */
export function canSeeSpace(
  visibility: string | null,
  standing: { member: boolean; parentMember: boolean },
): boolean {
  if (standing.member) return true
  if (visibility === 'public') return true
  if (visibility === 'inherit') return standing.parentMember
  return false
}

/**
 * Whether joining a child is possible and what it takes. A child's member is
 * always a member of its parent: a public parent is joined on the way in, a
 * private one has to have been joined already.
 */
export function joinChildDenial(
  parent: { name: string; visibility: string | null } | null,
  parentMember: boolean,
): string | null {
  if (!parent || parentMember) return null
  if (parent.visibility === 'public') return null
  return `Join ${parent.name} first — this space lives inside it.`
}

/**
 * Order ids so every space comes before its parent: the order a depth-first
 * delete has to run in under the Restrict FK.
 */
export function childrenFirst(spaces: Array<{ id: string; parentId: string | null }>): string[] {
  const byParent = new Map<string | null, string[]>()
  for (const s of spaces) {
    const list = byParent.get(s.parentId) ?? []
    list.push(s.id)
    byParent.set(s.parentId, list)
  }
  const out: string[] = []
  const visit = (id: string) => {
    for (const child of byParent.get(id) ?? []) visit(child)
    out.push(id)
  }
  const ids = new Set(spaces.map((s) => s.id))
  for (const s of spaces) {
    if (s.parentId === null || !ids.has(s.parentId)) visit(s.id)
  }
  return out
}

/** The trail from the root down to `spaceId`, for the switcher's breadcrumb. */
export function spacePath<T extends { id: string; parentId?: string | null }>(
  spaceId: string,
  byId: Map<string, T>,
): T[] {
  const trail: T[] = []
  let cur = byId.get(spaceId)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    trail.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return trail
}
