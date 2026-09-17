// Folder order: the pure rules.
//
// The tree sorts a folder's rows by name (context.ts#sortTree) until somebody
// drags one: from then on the folder keeps the order it was given. Where that
// order lives is where a placement lives (placedFolders.ts), and for the same
// reasons — on the folder's own index note:
//
//   ---
//   title: Connectors
//   order: [crm.md, app-database.md, archive]
//   ---
//
// It is a fact about that folder, written under the folder's own edit gate, it
// follows the folder through a rename and the trash, it is hand-editable, and
// the tree route already reads every index note's frontmatter.
//
// An entry is the row's name inside the folder (`crm.md`, `archive`), or the
// full path of a row that is only DRAWN there (a placed built-in folder,
// `agents`). Rows the list names come first, in its order; rows it doesn't —
// a note written since — follow, sorted by name as they always were. A stale
// entry names nothing and is dropped on the next write. Another space's
// context stays its own tier below both, whatever the list says.
//
// Pure and client-safe: the sidebar builds the list the route stores.

import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from './markdown'
import type { NoteFrontmatter } from './types'

/** The frontmatter key on a folder's index note naming its rows' order. */
const ORDER_KEY = 'order'
const MAX_ENTRIES = 2000

/** What a row is called in its folder's `order:` list. */
export function orderKeyOf(folder: string, childPath: string): string {
  const prefix = folder ? `${folder}/` : ''
  const rest = childPath.startsWith(prefix) ? childPath.slice(prefix.length) : ''
  return rest && !rest.includes('/') ? rest : childPath
}

/** The `order:` list of a folder's index note, as written. */
export function orderOf(frontmatter: NoteFrontmatter | null | undefined): string[] {
  const raw = (frontmatter as Record<string, unknown> | null | undefined)?.[ORDER_KEY]
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    const key = typeof x === 'string' ? x.trim() : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out.slice(0, MAX_ENTRIES)
}

/** The same note with its `order:` set (or removed when empty); body untouched. */
export function withOrder(content: string, order: string[]): string {
  const fm = parseFrontmatter(content) as Record<string, unknown>
  const { body } = splitFrontmatter(content)
  const next: Record<string, unknown> = { ...fm }
  const clean = orderOf({ [ORDER_KEY]: order } as NoteFrontmatter)
  if (clean.length) next[ORDER_KEY] = clean
  else delete next[ORDER_KEY]
  return joinFrontmatter(next, body)
}

/**
 * Compare two rows of `folder` by its stored order: negative/positive when the
 * list decides, 0 when it has nothing to say (neither is named) and the
 * caller's own sort applies.
 */
export function compareByOrder(rank: ReadonlyMap<string, number>, folder: string, a: string, b: string): number {
  const ra = rank.get(orderKeyOf(folder, a))
  const rb = rank.get(orderKeyOf(folder, b))
  if (ra === undefined && rb === undefined) return 0
  if (ra === undefined) return 1
  if (rb === undefined) return -1
  return ra - rb
}
