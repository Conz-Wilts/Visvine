// Pure derived-data helpers over the note index: tag counts and
// link-connectivity insights (orphans / hubs). No fs/DOM access
// so these are unit-testable and usable from either process.

import type { NoteMeta } from './types'

export interface TagCount {
  tag: string
  count: number
}

// Every distinct frontmatter tag across the notes with how many notes carry it,
// sorted by count (desc) then name. Tags are compared case-insensitively but the
// first-seen spelling is kept for display.
export function collectTags(metas: NoteMeta[]): TagCount[] {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const meta of metas) {
    for (const raw of meta.tags) {
      const tag = raw.trim()
      if (!tag) continue
      const key = tag.toLowerCase()
      const existing = counts.get(key)
      if (existing) {
        existing.count += 1
      } else {
        counts.set(key, { tag, count: 1 })
      }
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  )
}

// Notes-relative paths of notes carrying the given tag (case-insensitive).
export function notesWithTag(metas: NoteMeta[], tag: string): Set<string> {
  const want = tag.trim().toLowerCase()
  const out = new Set<string>()
  for (const meta of metas) {
    if (meta.tags.some((t) => t.trim().toLowerCase() === want)) {
      out.add(meta.path)
    }
  }
  return out
}

export interface LinkRef {
  path: string
  title: string
}

export interface HubRef extends LinkRef {
  connections: number
}

export interface LinkInsights {
  orphans: LinkRef[]
  hubs: HubRef[]
}

// Connectivity over real OKF links only (folder-proximity edges are ignored, so
// this reflects connections the author actually made):
// - orphans: notes with no link in either direction.
// - hubs: the most-connected notes (in + out degree), highest first.
export function linkInsights(metas: NoteMeta[], limit = 8): LinkInsights {
  const connections = new Map<string, number>()
  for (const m of metas) connections.set(m.path, 0)
  const bump = (path: string): void => {
    if (connections.has(path)) connections.set(path, (connections.get(path) ?? 0) + 1)
  }
  for (const m of metas) {
    for (const target of m.linkTargets) {
      bump(m.path)
      bump(target)
    }
  }

  const orphans = metas
    .filter((m) => (connections.get(m.path) ?? 0) === 0)
    .map((m) => ({ path: m.path, title: m.title }))
    .sort((a, b) => a.title.localeCompare(b.title))

  const hubs = metas
    .map((m) => ({ path: m.path, title: m.title, connections: connections.get(m.path) ?? 0 }))
    .filter((h) => h.connections > 0)
    .sort((a, b) => b.connections - a.connections || a.title.localeCompare(b.title))
    .slice(0, limit)

  return { orphans, hubs }
}
