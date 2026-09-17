// What a move does to who can see the thing moved — pure, so the tree's drop
// popup and its test read the same rules the store applies.
//
// Access is inherited by path prefix (authz.ts#grantReaches), and a move is a
// re-prefix: grants and folder flags ON or UNDER the moved path follow it
// (store.ts renameNote / renameFolder + moveFolderFlags), while everything it
// inherited from its old ancestors is swapped for what the new ones grant —
// or cut, when the destination sits inside a restricted folder. `moveAccessDiff`
// plays that re-prefix over a copy of the space's access and compares the
// audience at the old path with the audience at the new one.
//
// For a folder the comparison is made AT the folder: its subtree keeps its own
// internal shape (own grants, own cuts), so what changes for everything inside
// is exactly what changes for the folder — the inherited part.

import {
  containsPath,
  grantReaches,
  isLockedPath,
  type AccessGrant,
  type ContextAccess,
  type GrantSubjectType,
} from './authz'

/** One subject whose level on the moved item differs across the move (0 = none). */
export interface MoveSubjectChange {
  subjectType: GrantSubjectType
  subjectId: string
  before: number
  after: number
}

export interface MoveAccessDiff {
  gained: MoveSubjectChange[]
  lost: MoveSubjectChange[]
  /** Reaches it on both sides, at a different level. */
  changed: MoveSubjectChange[]
  /** The restricted folder the item moves INTO (outermost cut it was not already inside). */
  entersRestricted: string | null
  /** The restricted folder it moves OUT of. */
  leavesRestricted: string | null
  /** Freeze-for-AI, before and after. */
  lockedBefore: boolean
  lockedAfter: boolean
}

/** `path` as it reads once `from` has become `to` (unchanged when it is not on or under `from`). */
function rePrefixed(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path
}

/** The space's access as the move will leave it. */
function accessAfterMove(access: ContextAccess, from: string, to: string): ContextAccess {
  return {
    grants: access.grants.map((g) => ({ ...g, resourcePath: rePrefixed(g.resourcePath, from, to) })),
    restricted: access.restricted.map((p) => rePrefixed(p, from, to)),
    locked: access.locked.map((p) => rePrefixed(p, from, to)),
  }
}

/** Each subject's effective level at `path`: max over their reaching grants. */
function levelsAt(access: ContextAccess, path: string): Map<string, AccessGrant> {
  const out = new Map<string, AccessGrant>()
  for (const g of access.grants) {
    if (g.level <= 0 || !grantReaches(g, path, access.restricted)) continue
    const key = `${g.subjectType}:${g.subjectId}`
    const held = out.get(key)
    if (!held || g.level > held.level) out.set(key, g)
  }
  return out
}

/** The outermost restricted folder ABOVE `path` that does not also cover `other`.
 *  The item's own cut travels with it, so it is on both sides and never counts:
 *  only a boundary the move crosses does. */
function cutNotShared(restricted: string[], path: string, other: string): string | null {
  const cuts = restricted
    .filter((cut) => cut !== '' && cut !== path && containsPath(cut, path) && !containsPath(cut, other))
    .sort((a, b) => a.length - b.length)
  return cuts[0] ?? null
}

/**
 * Who gains, loses or changes level on the item when `from` becomes `to`.
 * `access` is the WHOLE space's (lib/notes/access.ts#loadSpaceAccess), not one
 * principal's — the question is about everyone.
 */
export function moveAccessDiff(access: ContextAccess, from: string, to: string): MoveAccessDiff {
  const after = accessAfterMove(access, from, to)
  const was = levelsAt(access, from)
  const now = levelsAt(after, to)

  const gained: MoveSubjectChange[] = []
  const lost: MoveSubjectChange[] = []
  const changed: MoveSubjectChange[] = []
  for (const [key, g] of was) {
    const next = now.get(key)
    const row = { subjectType: g.subjectType, subjectId: g.subjectId, before: g.level, after: next?.level ?? 0 }
    if (!next) lost.push(row)
    else if (next.level !== g.level) changed.push(row)
  }
  for (const [key, g] of now) {
    if (!was.has(key)) gained.push({ subjectType: g.subjectType, subjectId: g.subjectId, before: 0, after: g.level })
  }

  return {
    gained,
    lost,
    changed,
    entersRestricted: cutNotShared(after.restricted, to, from),
    leavesRestricted: cutNotShared(access.restricted, from, to),
    lockedBefore: isLockedPath(access.locked, from),
    lockedAfter: isLockedPath(after.locked, to),
  }
}

/** Whether the move changes anything a person dropping the item should be told. */
export function moveChangesAccess(diff: MoveAccessDiff): boolean {
  return (
    diff.gained.length > 0 ||
    diff.lost.length > 0 ||
    diff.changed.length > 0 ||
    diff.entersRestricted !== null ||
    diff.leavesRestricted !== null ||
    diff.lockedBefore !== diff.lockedAfter
  )
}
