/**
 * The Resources file system, as path shape. Pure.
 *
 * `resources/` is a tree: a folder is an index note with no `type:`, and a
 * resource is an index declaring `type: Resource`, at any depth. A resource
 * at the top (`resources/<slug>/index.md`) sits where its kind puts it; one
 * filed deeper is an adopted note, its node pointing at it through
 * `metadata.notePath` (lib/notes/entities.ts#adoptedNotePath). A resource
 * never leaves `resources/`, and it keeps its folder name through a move,
 * because at the top that name is the node's slug.
 */

import { entityFolderOfNotePath, entityNotePath, type EntityNodeLike } from '@/lib/notes/entities'

export const RESOURCES_ROOT = 'resources'

export interface ResourceFolderView {
  /** `resources/design` — the folder's path, which is its address. */
  path: string
  title: string
  description: string | null
}

function bare(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '')
}

/** Is this path inside `resources/` (the root itself excluded)? */
export function isUnderResources(path: string): boolean {
  return bare(path).startsWith(`${RESOURCES_ROOT}/`)
}

/** The folder a note stands at the head of: `resources/a/b/index.md` → `resources/a/b`. */
export function folderOfIndex(path: string): string {
  return bare(path).replace(/\/index\.md$/i, '')
}

/** The folder holding a resource whose note is `notePath`: `resources/design/logo/index.md` → `resources/design`. */
export function parentFolderOfResource(notePath: string): string {
  const folder = folderOfIndex(notePath)
  const cut = folder.lastIndexOf('/')
  return cut < 0 ? '' : folder.slice(0, cut)
}

/**
 * May a resource's own folder move from `from` to `to`? Only within
 * `resources/`, and only under the same name. Null when it may, else why not.
 */
export function resourceMoveDenial(from: string, to: string): string | null {
  const f = bare(from)
  const t = bare(to)
  if (!isUnderResources(t)) return 'A resource lives under resources/ — move it to a folder there'
  const name = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  if (name(f) !== name(t)) return 'A resource keeps its folder name when it moves — rename the resource instead'
  return null
}

/** The breadcrumb for a folder: `resources/design/logos` → [resources, resources/design, resources/design/logos]. */
export function crumbsOf(folder: string): string[] {
  const parts = bare(folder).split('/').filter(Boolean)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** The folder a resource's note heads — `resources/<slug>` at the top, or wherever it is filed. */
export function folderOfResourceNote(node: EntityNodeLike): string | null {
  const note = entityNotePath(node)
  return note ? entityFolderOfNotePath(note) : null
}
