// Pure functions that turn raw notes into the enriched index, the sidebar tree,
// and the force-directed graph. No fs/DOM access so this is unit-testable.
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
  TreeNode,
  GraphData,
  GraphNode,
  GraphLink
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

// Apply a saved manual order to a list of sibling nodes. Nodes whose `name` is
// listed in `names` come first, in that order; any node not listed keeps its
// incoming order (the caller's default sort) and is appended after. Pure —
// returns a new array, never mutates. Stale names (no matching node) are ignored.
export function orderByManual(nodes: TreeNode[], names: string[] | undefined): TreeNode[] {
  if (!names || names.length === 0) return nodes
  const rank = new Map(names.map((name, i) => [name, i]))
  const listed = nodes
    .filter((n) => rank.has(n.name))
    .sort((a, b) => rank.get(a.name)! - rank.get(b.name)!)
  const rest = nodes.filter((n) => !rank.has(n.name))
  return [...listed, ...rest]
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

// Build the force-directed graph: every note is a node, every resolved OKF
// markdown link is a 'link' edge. Folders are not represented — a note nobody
// has linked yet simply sits on its own.
export function buildGraph(metas: NoteMeta[]): GraphData {
  const links: GraphLink[] = []
  const degree = new Map<string, number>()
  const bump = (id: string): void => {
    degree.set(id, (degree.get(id) ?? 0) + 1)
  }
  const validPath = new Set(metas.map((m) => m.path))

  for (const meta of metas) {
    for (const target of meta.linkTargets) {
      if (!validPath.has(target)) {
        continue
      }
      links.push({ source: meta.path, target, kind: 'link' })
      bump(meta.path)
      bump(target)
    }
  }

  const nodes: GraphNode[] = metas.map((meta) => ({
    id: meta.path,
    label: meta.title,
    kind: 'note',
    degree: degree.get(meta.path) ?? 0
  }))

  return { nodes, links }
}

export interface GraphFilter {
  // Keep only notes whose folder equals this (or is nested under it). "" / null = all.
  folder?: string | null
  // Keep only nodes within `depth` hops of `focus` along graph edges. null = all.
  focus?: string | null
  depth?: number | null
}

// Narrow a graph to a folder and/or a neighbourhood around a focus node. Pure:
// returns a new GraphData whose links only ever connect surviving nodes.
export function filterGraph(graph: GraphData, filter: GraphFilter): GraphData {
  const folder = filter.folder?.trim() || null
  const focus = filter.focus ?? null
  const depth = filter.depth ?? null

  let keep = new Set(graph.nodes.map((n) => n.id))

  if (folder) {
    const prefix = `${folder}/`
    keep = new Set(
      graph.nodes
        .filter((n) => {
          const f = n.id.includes('/') ? n.id.slice(0, n.id.lastIndexOf('/')) : ''
          return f === folder || n.id.startsWith(prefix)
        })
        .map((n) => n.id)
    )
  }

  if (focus && depth != null && keep.has(focus)) {
    // BFS over edges among the folder-surviving nodes, out to `depth` hops.
    const adj = new Map<string, Set<string>>()
    for (const link of graph.links) {
      if (!keep.has(link.source) || !keep.has(link.target)) continue
      ;(adj.get(link.source) ?? adj.set(link.source, new Set()).get(link.source)!).add(link.target)
      ;(adj.get(link.target) ?? adj.set(link.target, new Set()).get(link.target)!).add(link.source)
    }
    const reached = new Set<string>([focus])
    let frontier = [focus]
    for (let hop = 0; hop < depth; hop++) {
      const next: string[] = []
      for (const node of frontier) {
        for (const neighbour of adj.get(node) ?? []) {
          if (!reached.has(neighbour)) {
            reached.add(neighbour)
            next.push(neighbour)
          }
        }
      }
      frontier = next
    }
    keep = reached
  }

  const nodes = graph.nodes.filter((n) => keep.has(n.id))
  const links = graph.links.filter((l) => keep.has(l.source) && keep.has(l.target))
  return { nodes, links }
}
