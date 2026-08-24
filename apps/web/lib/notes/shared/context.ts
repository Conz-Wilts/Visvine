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
function folderTitles(metas: NoteMeta[]): { titles: Map<string, string>; spaces: Map<string, string> } {
  const titles = new Map<string, string>()
  const spaces = new Map<string, string>()
  for (const meta of metas) {
    if (baseName(meta.path).toLowerCase() !== 'index.md') continue
    const folder = folderOf(meta.path)
    if (!folder) continue
    const declared = meta.frontmatter?.title
    if (typeof declared === 'string' && declared.trim()) titles.set(folder, declared.trim())
    // `space: <id>` marks a sub-space's record folder — what the tree route
    // federates the child space's own tree in under.
    const space = meta.frontmatter?.space
    if (typeof space === 'string' && space.trim()) spaces.set(folder, space.trim())
  }
  return { titles, spaces }
}

// Build the folder/note tree for the sidebar from the note index.
export function buildTree(metas: NoteMeta[]): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
  const folders = new Map<string, TreeNode>([['', root]])
  // Resolved up front: sortTree keys on `title ?? name`, so a folder must
  // know its title before the tree is sorted.
  const { titles, spaces } = folderTitles(metas)

  const ensureFolder = (folderPath: string): TreeNode => {
    const existing = folders.get(folderPath)
    if (existing) {
      return existing
    }
    const parent = ensureFolder(folderOf(folderPath))
    const title = titles.get(folderPath)
    const space = spaces.get(folderPath)
    const node: TreeNode = {
      name: baseName(folderPath),
      path: folderPath,
      kind: 'folder',
      ...(title ? { title } : {}),
      ...(space ? { space } : {}),
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

