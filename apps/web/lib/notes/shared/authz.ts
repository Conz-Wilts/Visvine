// The grant-based access model for community brains — the pure core of the
// multiplayer-brains permission system. One
// mental model: every brain is a folder tree and access flows DOWN it. A grant
// gives a subject (the whole community, a team, or one member) a level on a
// resource path ('' = the brain root, a folder at any depth, or a single note);
// a RESTRICTED folder cuts inheritance at its boundary (only grants on or
// inside it reach past); a member's effective level on a path is the MAX across
// every grant that reaches it. Grants only ever add — there are no deny rules —
// so "why can Alice see this?" is always answered by one winning grant.
//
// Pure — no Prisma/Node/DOM imports; usable from server, client, and tests.
// The DB side (loading the caller's grant rows, seeding legacy registries)
// lives in lib/notes/access.ts.

// --- levels ---------------------------------------------------------------------

/** Strictly ordered access levels — "does edit imply view?" is a comparison. */
export const LEVEL_VIEW = 10
export const LEVEL_COMMENT = 20
export const LEVEL_EDIT = 30
export const LEVEL_FULL = 40

export type AccessLevelName = 'view' | 'comment' | 'edit' | 'full'

/** The canonical level table — every UI level picker and label renders from
 *  this one list so a new or relabeled level propagates everywhere. */
export const ACCESS_LEVELS: ReadonlyArray<{
  name: AccessLevelName
  level: number
  label: string
  hint: string
}> = [
  { name: 'view', level: LEVEL_VIEW, label: 'Viewer', hint: 'Can read, search, and see the context' },
  { name: 'comment', level: LEVEL_COMMENT, label: 'Commenter', hint: 'Can view and discuss' },
  { name: 'edit', level: LEVEL_EDIT, label: 'Editor', hint: 'Can view, comment, write, create, and move' },
  { name: 'full', level: LEVEL_FULL, label: 'Full access', hint: 'Can edit, share, restrict, and delete' },
]

/** Display label for a level name ('view' → 'Viewer'); 'No access' for null. */
export function levelDisplayLabel(name: AccessLevelName | string | null): string {
  return ACCESS_LEVELS.find((l) => l.name === name)?.label ?? name ?? 'No access'
}

/** The canonical name of a level ('view'…'full'), or null for 0/unknown. */
export function levelName(level: number): AccessLevelName | null {
  let best: AccessLevelName | null = null
  for (const l of ACCESS_LEVELS) if (level >= l.level) best = l.name
  return best
}

/** Parse a client-supplied level name to its integer, or null when invalid. */
export function parseLevel(name: unknown): number | null {
  const hit = ACCESS_LEVELS.find((l) => l.name === name)
  return hit ? hit.level : null
}

// --- grants ---------------------------------------------------------------------

export type GrantSubjectType = 'community' | 'team' | 'user'

export const SUBJECT_TYPES: readonly GrantSubjectType[] = ['community', 'team', 'user']

/** One access grant: *subject* gets *level* on *resource*. */
export interface AccessGrant {
  subjectType: GrantSubjectType
  /** '' for community-wide grants, else a teamId / userId. */
  subjectId: string
  /** '' = brain root, a folder path ('teams/engineering'), or a note path. */
  resourcePath: string
  level: number
}

/**
 * Everything the pure checks need about ONE principal's standing in a brain:
 * the grants that apply to them (community-wide + their teams' + their own,
 * pre-scoped by the loader) and the brain's folder-boundary flags.
 */
export interface BrainAccess {
  grants: AccessGrant[]
  /** Restricted folder paths — inheritance cuts. Never contains '' (the root). */
  restricted: string[]
  /** Locked folder paths — frozen for AI maintenance passes. */
  locked: string[]
}

/** Full access from the root — personal spaces are never folder-gated. */
export const OPEN_ACCESS: BrainAccess = {
  grants: [{ subjectType: 'community', subjectId: '', resourcePath: '', level: LEVEL_FULL }],
  restricted: [],
  locked: [],
}

// --- the tree walk --------------------------------------------------------------

/** Whether `path` sits at or under `ancestor` ('' contains everything). */
export function containsPath(ancestor: string, path: string): boolean {
  return ancestor === '' || path === ancestor || path.startsWith(`${ancestor}/`)
}

/**
 * Whether a grant reaches a path: the grant's resource must contain the path,
 * and every restricted folder covering the path must also contain the grant —
 * a restricted boundary between them cuts the beam, so only grants on or
 * inside the restricted folder operate past it.
 */
export function grantReaches(grant: AccessGrant, path: string, restricted: string[]): boolean {
  if (!containsPath(grant.resourcePath, path)) return false
  for (const cut of restricted) {
    if (cut !== '' && containsPath(cut, path) && !containsPath(cut, grant.resourcePath)) {
      return false
    }
  }
  return true
}

/** The principal's effective level on a path: max across everything that reaches (0 = none). */
export function effectiveLevel(access: BrainAccess, path: string): number {
  let max = 0
  for (const grant of access.grants) {
    if (grant.level > max && grantReaches(grant, path, access.restricted)) max = grant.level
  }
  return max
}

export function canRead(access: BrainAccess, path: string): boolean {
  return effectiveLevel(access, path) >= LEVEL_VIEW
}

export function canWrite(access: BrainAccess, path: string): boolean {
  return effectiveLevel(access, path) >= LEVEL_EDIT
}

/** full = edit + share, restrict, and delete within the subtree. */
export function canManage(access: BrainAccess, path: string): boolean {
  return effectiveLevel(access, path) >= LEVEL_FULL
}

/**
 * Whether a folder should appear at all for this principal: they can read the
 * folder itself, or some readable grant starts strictly inside it (a deep team
 * grant must surface its ancestor folders or the subtree is unreachable).
 */
export function folderVisible(access: BrainAccess, folderPath: string): boolean {
  if (canRead(access, folderPath)) return true
  return access.grants.some(
    (g) =>
      g.level >= LEVEL_VIEW &&
      g.resourcePath !== folderPath &&
      containsPath(folderPath, g.resourcePath),
  )
}

/** Whether a path sits inside any restricted boundary (drives read auditing). */
export function isRestrictedPath(restricted: string[], path: string): boolean {
  return restricted.some((cut) => cut !== '' && containsPath(cut, path))
}

/** Whether a path is frozen for AI maintenance (locked folder). */
export function isLockedPath(locked: string[], path: string): boolean {
  return locked.some((f) => f !== '' && containsPath(f, path))
}

/**
 * The subtree roots where this principal's visibility STARTS: the distinct
 * resource paths of their readable grants (a grant always reaches its own
 * resource). Inner restricted folders may still cut deeper reads — per-path
 * checks (canRead) stay the source of truth; this powers overview UIs.
 */
export function readableRoots(access: BrainAccess): string[] {
  const roots = new Set<string>()
  for (const g of access.grants) if (g.level >= LEVEL_VIEW) roots.add(g.resourcePath)
  return [...roots].sort()
}

/**
 * The visibility signature: everything read-filtering depends on for a fixed
 * corpus. Two principals with equal signatures see the same filterVisible
 * output, so vault views can be shared (lib/notes/vaultCache.ts). Write levels
 * don't affect visibility, so only readable grant paths participate. JSON
 * encoding keeps every root distinct — '' (the brain root) must never collapse
 * into "no roots", and paths may contain any delimiter character.
 */
export function accessSignature(access: BrainAccess): string {
  const reads = JSON.stringify(readableRoots(access))
  const cuts = JSON.stringify([...access.restricted].sort())
  return `r:${reads}|x:${cuts}`
}

/**
 * The one grant that answers "why can this subject act here": the highest
 * reaching level, tie-broken toward the most specific resource, then the most
 * specific subject (user > team > community). Null when nothing reaches.
 */
export function winningGrant(
  grants: AccessGrant[],
  path: string,
  restricted: string[],
): AccessGrant | null {
  const specificity: Record<GrantSubjectType, number> = { user: 2, team: 1, community: 0 }
  let win: AccessGrant | null = null
  for (const g of grants) {
    if (!grantReaches(g, path, restricted)) continue
    if (
      !win ||
      g.level > win.level ||
      (g.level === win.level &&
        (g.resourcePath.length > win.resourcePath.length ||
          (g.resourcePath.length === win.resourcePath.length &&
            specificity[g.subjectType] > specificity[win.subjectType])))
    ) {
      win = g
    }
  }
  return win
}

// --- legacy registry migration ----------------------------------------------------

/** A grant row produced by migrating the pre-grant folder registry. */
interface MigratedGrant extends AccessGrant {
  grantedBy: string
}

export interface MigratedRegistry {
  grants: MigratedGrant[]
  restricted: string[]
  locked: string[]
}

const LEGACY_LEVELS: Record<string, number> = {
  read: LEVEL_VIEW,
  write: LEVEL_EDIT,
  admin: LEVEL_FULL,
}

/**
 * Map a legacy `folders.json` registry (lib/notes/shared/brainTypes.ts) onto
 * grant rows — the one-time migration lib/notes/access.ts runs per community.
 * The mapping preserves who could READ what exactly:
 * - every folder member becomes a direct user grant at the folder's path
 *   (read→view, write→edit, admin→full); the ROOT entry's members become
 *   root grants — the brain gate, expressed as rows;
 * - a PRIVATE registered folder becomes a RESTRICTED folder (the cut keeps
 *   non-members out, exactly as the old refines-the-root ACL did);
 * - a PUBLIC folder gains a community-wide view grant (it was readable by every
 *   member, even those outside the root gate). Under the additive model, root
 *   writers now also keep their write level INSIDE public folders — a
 *   deliberate widening (the old model narrowed there; deny-on-top is the one
 *   semantic the new system refuses to keep).
 */
export function migrateLegacyRegistry(cfg: {
  folders: Array<{
    id: string
    visibility: string
    locked?: boolean
    members: Array<{ userId: string; level: string; grantedBy?: string }>
  }>
}): MigratedRegistry {
  const grants: MigratedGrant[] = []
  const restricted: string[] = []
  const locked: string[] = []
  for (const folder of cfg.folders) {
    if (folder.locked && folder.id !== '') locked.push(folder.id)
    if (folder.visibility === 'public') {
      grants.push({
        subjectType: 'community',
        subjectId: '',
        resourcePath: folder.id,
        level: LEVEL_VIEW,
        grantedBy: 'migration',
      })
    } else if (folder.id !== '') {
      restricted.push(folder.id)
    }
    for (const member of folder.members) {
      const level = LEGACY_LEVELS[member.level]
      if (!level) continue
      grants.push({
        subjectType: 'user',
        subjectId: member.userId,
        resourcePath: folder.id,
        level,
        grantedBy: member.grantedBy || 'migration',
      })
    }
  }
  return { grants, restricted, locked }
}
