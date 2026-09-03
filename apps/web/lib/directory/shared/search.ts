// The pure half of the directory finder (GET /api/nodes/search): which DB
// `type` spellings a picker kind matches, and how raw rows collapse into the
// list the finder renders. Nothing here touches the database —
// lib/directory/search.ts runs the query and hands the rows here.

import { isGlobalSpace } from '@/lib/spaces/globalSpace'

/**
 * Maps a picker node type to the set of (lowercased) DB `type` values that
 * should match. New nodes are stored lowercase-canonical, but older rows may be
 * capitalized or pluralized — callers always compare LOWER(n.type) and accept
 * the common spellings.
 */
const TYPE_ALIASES: Record<string, string[]> = {
  person: ['person', 'people'],
  // Organisations have worn several retired spellings before settling on
  // `space`. All of them must match, or the duplicate check that guards the
  // note-first create surface silently finds nothing on older data.
  space: ['space', 'spaces', 'community', 'communities', 'group', 'groups', 'organization', 'organisation', 'org', 'company'],
  resource: ['resource', 'resources'],
  event: ['event', 'events'],
}

export function dbTypesFor(type: string): string[] {
  const key = type.toLowerCase()
  return TYPE_ALIASES[key] ?? [key]
}

/** One row of the finder's node query, as the database returns it. */
export interface SearchRow {
  id: string
  name: string
  subtitle: string | null
  location: string | null
  tags: string[]
  image_url: string | null
  space_id: string | null
  identity_id: string | null
  metadata: unknown
  space_name: string | null
}

/** One entry the finder renders — a node collapsed per identity, or a live space. */
export interface SearchResult {
  id: string
  identity_id: string | null
  global?: boolean
  name: string
  subtitle: string | null
  location: string | null
  tags: string[]
  image_url: string | null
  space_id: string | null
  space_name: string | null
  spaces: string[]
  metadata: Record<string, unknown> | null
}

/** How many fields a row has filled — used to pick the best representative per identity. */
export function fieldScore(r: SearchRow): number {
  let n = 0
  if (r.subtitle) n++
  if (r.location) n++
  if (r.tags?.length) n++
  if (r.image_url) n++
  if ((r.metadata as Record<string, unknown> | null)?.email) n++
  return n
}

/**
 * Collapse rows to one entry per canonical identity so the finder shows e.g.
 * "Craig Piggott" once even when several spaces each have their own node for
 * him. Rows without an identity yet are kept distinct by node id. The Visvine
 * record is the canonical row for its identity: it leads the group whatever
 * the field count, so a pick binds to the record; otherwise the fullest row
 * represents. Global-record entries sort first.
 */
export function collapseByIdentity(rows: readonly SearchRow[]): SearchResult[] {
  const groups = new Map<string, { rep: SearchRow; spaces: Set<string> }>()
  for (const r of rows) {
    const key = r.identity_id ?? `node:${r.id}`
    const existing = groups.get(key)
    if (!existing) {
      const spaces = new Set<string>()
      if (r.space_name) spaces.add(r.space_name)
      groups.set(key, { rep: r, spaces })
    } else {
      if (r.space_name) existing.spaces.add(r.space_name)
      if (
        isGlobalSpace(r.space_id) ||
        (!isGlobalSpace(existing.rep.space_id) && fieldScore(r) > fieldScore(existing.rep))
      ) {
        existing.rep = r
      }
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => Number(isGlobalSpace(b.rep.space_id)) - Number(isGlobalSpace(a.rep.space_id)))
    .map(({ rep, spaces }) => ({
      id: rep.id,
      identity_id: rep.identity_id,
      global: isGlobalSpace(rep.space_id),
      name: rep.name,
      subtitle: rep.subtitle,
      location: rep.location,
      tags: rep.tags,
      image_url: rep.image_url,
      space_id: rep.space_id,
      space_name: rep.space_name,
      spaces: Array.from(spaces),
      metadata: rep.metadata as Record<string, unknown> | null,
    }))
}

/**
 * Spaces lead, and swallow any directory record of the same name: if Movac
 * runs a space here, "Movac the card in someone's directory" is the same
 * organisation and offering both would just ask the user to pick between two
 * spellings of one answer. At most `limit` entries come back.
 */
export function mergeSearchResults(
  spaceMatches: readonly SearchResult[],
  nodeResults: readonly SearchResult[],
  limit = 10,
): SearchResult[] {
  const claimedNames = new Set(spaceMatches.map((c) => c.name.trim().toLowerCase()))
  return [
    ...spaceMatches,
    ...nodeResults.filter((n) => !claimedNames.has(n.name.trim().toLowerCase())),
  ].slice(0, limit)
}
