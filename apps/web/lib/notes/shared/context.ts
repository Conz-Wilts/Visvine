// Pure functions that turn raw notes into the enriched index and the sidebar
// tree. No fs/DOM access so this is unit-testable.
// Link extraction follows the OKF (Open Knowledge Format) v0.1 spec — notes
// link to each other via standard markdown links, not [[wikilinks]] or #tags.

import {
  parseFrontmatter,
  splitFrontmatter,
  extractMarkdownLinks,
  extractHashtags,
  resolveOkfLink,
  unique
} from './markdown'
import type {
  RawNote,
  NoteMeta,
  TreeNode
} from './types'

function stripExtension(path: string): string {
  return path.replace(/\.md$/i, '')
}

function baseName(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] ?? path
}

function folderOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

function titleOf(path: string, frontmatterTitle: unknown): string {
  if (typeof frontmatterTitle === 'string' && frontmatterTitle.trim()) {
    return frontmatterTitle.trim()
  }
  return stripExtension(baseName(path))
}

// Enrich raw notes into NoteMeta, resolving OKF markdown links against the notes.
export function buildNoteIndex(notes: RawNote[]): NoteMeta[] {
  const validPaths = new Set(notes.map((n) => n.path))
  return notes.map((note) => {
    const fm = parseFrontmatter(note.content)
    const { body } = splitFrontmatter(note.content)
    const linkTargets: string[] = []
    const unresolved: string[] = []
    for (const href of extractMarkdownLinks(body)) {
      const resolved = resolveOkfLink(href, note.path)
      if (resolved && validPaths.has(resolved) && resolved !== note.path) {
        linkTargets.push(resolved)
      } else if (!resolved || !validPaths.has(resolved)) {
        unresolved.push(href)
      }
    }
    const frontmatterTags = Array.isArray(fm.tags) ? fm.tags.map((t) => String(t)) : []
    // Inline Roam-style #tags in the body are first-class tags too. Merge them
    // with frontmatter tags, deduped case-insensitively (first-seen spelling wins)
    // so a tag declared both ways counts once.
    const tags: string[] = []
    const seenTags = new Set<string>()
    for (const tag of [...frontmatterTags, ...extractHashtags(body)]) {
      const key = tag.trim().toLowerCase()
      if (!key || seenTags.has(key)) continue
      seenTags.add(key)
      tags.push(tag)
    }
    return {
      path: note.path,
      title: titleOf(note.path, fm.title),
      folder: folderOf(note.path),
      frontmatter: fm,
      tags,
      linkTargets: unique(linkTargets),
      unresolved: unique(unresolved),
      mtime: note.mtime
    }
  })
}

/**
 * A folder's display name: the title its index note declares.
 *
 * A folder IS its index note everywhere else — the folder row opens it, starring
 * the folder stars it — so the name follows the same rule, and `communities/`
 * titled "Companies" reads as Companies wherever it is shown. The path never
 * moves, so links, URLs and grants are unaffected.
 *
 * Read from `frontmatter.title`, NOT `meta.title`: the latter falls back to the
 * filename, which would label every untitled folder "index". Folders without an
 * index, or whose index declares no title, get no title and fall back to their
 * path segment at the point of display. The root is skipped — its label is the
 * space/context name, not its home note's title.
 */
function folderTitles(metas: NoteMeta[]): Map<string, string> {
  const titles = new Map<string, string>()
  for (const meta of metas) {
    if (baseName(meta.path).toLowerCase() !== 'index.md') continue
    const folder = folderOf(meta.path)
    if (!folder) continue
    const declared = meta.frontmatter?.title
    if (typeof declared === 'string' && declared.trim()) titles.set(folder, declared.trim())
  }
  return titles
}

// Build the folder/note tree for the sidebar from the note index.
export function buildTree(metas: NoteMeta[]): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
  const folders = new Map<string, TreeNode>([['', root]])
  // Resolved up front: sortTree keys on `title ?? name`, so a folder must
  // know its title before the tree is sorted.
  const titles = folderTitles(metas)

  const ensureFolder = (folderPath: string): TreeNode => {
    const existing = folders.get(folderPath)
    if (existing) {
      return existing
    }
    const parent = ensureFolder(folderOf(folderPath))
    const title = titles.get(folderPath)
    const node: TreeNode = {
      name: baseName(folderPath),
      path: folderPath,
      kind: 'folder',
      ...(title ? { title } : {}),
      children: []
    }
    parent.children!.push(node)
    folders.set(folderPath, node)
    return node
  }

  for (const meta of [...metas].sort((a, b) => a.path.localeCompare(b.path))) {
    const parent = ensureFolder(meta.folder)
    parent.children!.push({
      name: baseName(meta.path),
      path: meta.path,
      kind: 'note',
      title: meta.title
    })
  }

  sortTree(root)
  return root
}

// Prune the tree to what a query matches. A note is kept when its title, its
// filename or its path contains the needle; a folder is kept when it matches
// itself (with everything under it, so "people" opens the whole namespace) or
// when anything under it does. The shape is preserved rather than flattened:
// where a note lives is half of what it is, and the Directory's other tabs
// filter in place too.
export function filterTree(node: TreeNode, query: string): TreeNode {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return node
  }
  const hits = (n: TreeNode) =>
    (n.title ?? '').toLowerCase().includes(needle) ||
    n.name.toLowerCase().includes(needle) ||
    n.path.toLowerCase().includes(needle)

  const prune = (n: TreeNode): TreeNode | null => {
    if (n.kind === 'note') {
      return hits(n) ? n : null
    }
    if (hits(n)) {
      return n
    }
    const children = (n.children ?? []).map(prune).filter((c): c is TreeNode => c !== null)
    return children.length > 0 ? { ...n, children } : null
  }

  // The root itself is the context, not a match candidate: it always survives,
  // holding whatever is left.
  const children = (node.children ?? []).map(prune).filter((c): c is TreeNode => c !== null)
  return { ...node, children }
}

// Every folder path in a tree — what the sidebar opens while a search is
// running, so a match is never hidden inside a collapsed ancestor.
export function folderPathsIn(node: TreeNode): Set<string> {
  const paths = new Set<string>()
  const walk = (n: TreeNode) => {
    if (n.kind !== 'folder') {
      return
    }
    paths.add(n.path)
    for (const child of n.children ?? []) {
      walk(child)
    }
  }
  walk(node)
  return paths
}

// Folders first, then notes, each alphabetically by display name — a folder's
// index title when it has one, its path segment otherwise. Exported because the
// tree API sorts again after grafting explicitly-created empty folders.
export function sortTree(node: TreeNode): void {
  if (!node.children) {
    return
  }
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'folder' ? -1 : 1
    }
    return (a.title ?? a.name).localeCompare(b.title ?? b.name)
  })
  for (const child of node.children) {
    sortTree(child)
  }
}

