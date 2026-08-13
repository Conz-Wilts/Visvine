// The pure half of the role-aware clean pass exposed by the MCP clean_context
// tool. Role scoping is the point: a MEMBER's clean reaches only the notes they
// authored, inside the paths they can write, inside the folder they targeted;
// an ADMIN (or a personal-space owner) reaches everything under the target.
// The checks themselves live in ./review.ts and are reused unchanged — this
// module scopes their output and turns issues into an agent-executable
// worklist. Pure — no Prisma/Node/DOM imports.
import { containsPath } from './authz'
import { isIndexPath } from './indexNote'
import { entityKindOfPath } from '../entities'
import type { AutoFix, Issue } from './review'
import type { NoteMeta } from './types'

export type CleanRole = 'admin' | 'member' | 'owner'

export interface CleanScope {
  owns(path: string): boolean
  inTarget(path: string): boolean
  writable(path: string): boolean
  inScope(path: string): boolean
}

/**
 * The caller's reach for one clean pass. `ownedPaths` is required for members
 * (SpaceNote.createdBy === caller); admins and personal-space owners own
 * everything. `targetPath` narrows any role to one folder (or a single note).
 */
export function buildCleanScope(opts: {
  role: CleanRole
  ownedPaths?: ReadonlySet<string>
  targetPath?: string
  canWrite: (path: string) => boolean
}): CleanScope {
  const target = opts.targetPath ?? ''
  const owns =
    opts.role === 'member'
      ? (path: string) => opts.ownedPaths?.has(path) === true
      : () => true
  const inTarget = (path: string) => containsPath(target, path)
  const writable = opts.canWrite
  return {
    owns,
    inTarget,
    writable,
    inScope: (path: string) => owns(path) && inTarget(path) && writable(path),
  }
}

/** The issues the caller can actually act on — everything else is noise to them. */
export function scopeIssues(issues: Issue[], scope: CleanScope): Issue[] {
  return issues.filter((i) => scope.inScope(i.path))
}

/**
 * Fixes the CLEAN pass refuses even though the review surface would apply them:
 * `setStale` on entity notes (people/, communities/, …) and index notes.
 * Entity cards are long-lived reference notes — a brain full of people would
 * otherwise get blanket-staled on its first deep clean; an index note IS a
 * folder and never goes stale. The web review route keeps its own behaviour.
 */
export function filterCleanFixes(fixes: AutoFix[]): AutoFix[] {
  return fixes.filter((f) => {
    if (f.kind !== 'setStale') return true
    return entityKindOfPath(f.path) === null && !isIndexPath(f.path)
  })
}

interface FolderStat {
  path: string
  noteCount: number
  topTags: string[]
  topTypes: string[]
}

export interface FolderStructure {
  perFolder: FolderStat[]
  /** Registered folders with no notes beneath (index stubs excluded). */
  emptyFolders: string[]
  oneNoteFolders: string[]
  largestFolders: Array<{ path: string; noteCount: number }>
}

function topCounts(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k)
}

/**
 * Per-folder shape data an agent can reason over when proposing a better
 * structure: sizes, dominant tags/types, empties and outliers. Index notes
 * count as folder identity, not content — a folder whose only note is its own
 * index stub reads as empty.
 */
export function folderStats(metas: NoteMeta[], folders: string[]): FolderStructure {
  const contentByFolder = new Map<string, NoteMeta[]>()
  for (const m of metas) {
    if (isIndexPath(m.path)) continue
    for (const folder of folders) {
      if (folder !== '' && containsPath(folder, m.path)) {
        ;(contentByFolder.get(folder) ?? contentByFolder.set(folder, []).get(folder)!).push(m)
      }
    }
  }

  const perFolder: FolderStat[] = folders
    .filter((f) => f !== '')
    .map((folder) => {
      const notes = contentByFolder.get(folder) ?? []
      const tags = new Map<string, number>()
      const types = new Map<string, number>()
      for (const m of notes) {
        for (const t of m.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
        const type = typeof m.frontmatter.type === 'string' ? m.frontmatter.type : ''
        if (type) types.set(type, (types.get(type) ?? 0) + 1)
      }
      return { path: folder, noteCount: notes.length, topTags: topCounts(tags, 3), topTypes: topCounts(types, 3) }
    })
    .sort((a, b) => a.path.localeCompare(b.path))

  return {
    perFolder,
    emptyFolders: perFolder.filter((f) => f.noteCount === 0).map((f) => f.path),
    oneNoteFolders: perFolder.filter((f) => f.noteCount === 1).map((f) => f.path),
    largestFolders: [...perFolder]
      .sort((a, b) => b.noteCount - a.noteCount || a.path.localeCompare(b.path))
      .slice(0, 5)
      .filter((f) => f.noteCount > 0)
      .map((f) => ({ path: f.path, noteCount: f.noteCount })),
  }
}

interface WorklistItem {
  path: string
  detail: string
  suggested_action: { tool: string; hint: string }
}

export interface WorklistGroup {
  kind: string
  count: number
  items: WorklistItem[]
}

// What an agent should DO about each issue kind — the executable half of the
// planner/executor split. The tool analyzes; the agent acts through the
// ordinary gated write tools.
const SUGGESTED_ACTIONS: Record<string, { tool: string; hint: string }> = {
  'broken-link': { tool: 'edit_context', hint: 'Open the note, fix or remove the dead link.' },
  duplicate: {
    tool: 'read_context → edit_context → clean_context',
    hint: "Read both notes, merge everything worth keeping into the better one via edit_context, then clean_context action:'trash' the other.",
  },
  oversized: {
    tool: 'edit_context',
    hint: 'Split at ## boundaries into sibling notes; leave leading-slash links behind so nothing is orphaned.',
  },
  orphan: {
    tool: 'append_context',
    hint: 'Mention it with a leading-slash markdown link from a relevant hub or index note so it becomes navigable.',
  },
  schema: { tool: 'edit_context', hint: 'Add the missing frontmatter (a one-line description helps search most).' },
  'unlinked-mention': { tool: 'edit_context', hint: 'Turn the ambiguous plain-text mention into an explicit link to the right note.' },
}

const DEFAULT_ACTION = { tool: 'edit_context', hint: 'Open the note and resolve the issue.' }

/** Group scoped issues by kind, cap each group, attach how-to-fix guidance. */
export function buildWorklist(issues: Issue[], limit: number): WorklistGroup[] {
  const byKind = new Map<string, Issue[]>()
  for (const issue of issues) {
    ;(byKind.get(issue.kind) ?? byKind.set(issue.kind, []).get(issue.kind)!).push(issue)
  }
  return [...byKind.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([kind, list]) => ({
      kind,
      count: list.length,
      items: [...list]
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, limit)
        .map((i) => ({
          path: i.path,
          detail: i.detail,
          suggested_action: SUGGESTED_ACTIONS[kind] ?? DEFAULT_ACTION,
        })),
    }))
}
