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

// Build the folder/note tree for the sidebar from the note index.
export function buildTree(metas: NoteMeta[]): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
  const folders = new Map<string, TreeNode>([['', root]])

  const ensureFolder = (folderPath: string): TreeNode => {
    const existing = folders.get(folderPath)
    if (existing) {
      return existing
    }
    const parent = ensureFolder(folderOf(folderPath))
    const node: TreeNode = {
      name: baseName(folderPath),
      path: folderPath,
      kind: 'folder',
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

  sortChildren(root)
  return root
}

// Folders first, then notes, each alphabetically.
function sortChildren(node: TreeNode): void {
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
    sortChildren(child)
  }
}

