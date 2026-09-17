// The same person in the other spaces of a family — a house and its rooms.
//
// One `Identity` row is the whole "same person" link: every record of that
// person in the family points at it, and each record keeps its own fields,
// notes and grants. Nothing merges. What a viewer is shown is the records
// they could open themselves: the ones in spaces they actively belong to.
// A room a viewer is not in is not named, so the line never reveals a room's
// existence to someone outside it.
//
// Pure: lib/directory/samePerson.ts reads the rows and the memberships.

interface SamePersonSpace {
  id: string
  name: string
  parent_id: string | null
}

export interface SamePersonRecord {
  node_id: string
  space: SamePersonSpace
}

export interface SamePersonCandidate {
  id: string
  spaceId: string
  space: SamePersonSpace
}

/**
 * The family's other records of one identity that `memberSpaceIds` may open,
 * house first, then rooms by name, never the record being looked at.
 */
export function pickSamePerson(
  self: { id: string; spaceId: string },
  candidates: SamePersonCandidate[],
  memberSpaceIds: ReadonlySet<string>,
): SamePersonRecord[] {
  return candidates
    .filter((c) => c.id !== self.id && c.spaceId !== self.spaceId && memberSpaceIds.has(c.spaceId))
    .sort((a, b) => {
      const houseA = a.space.parent_id ? 1 : 0
      const houseB = b.space.parent_id ? 1 : 0
      return houseA - houseB || a.space.name.localeCompare(b.space.name)
    })
    .map((c) => ({ node_id: c.id, space: c.space }))
}
