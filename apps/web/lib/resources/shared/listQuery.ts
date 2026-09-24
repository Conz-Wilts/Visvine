// What a resources list asks for, read from a URL and checked. Pure — the
// route parses with it, the client builds its URLs with it, a test pins it.

export const LIST_KINDS = [
  'all', 'image', 'video', 'audio', 'pdf', 'doc', 'sheet', 'slides', 'text', 'code', 'archive', 'other', 'link', 'files',
] as const
export type ListKind = (typeof LIST_KINDS)[number]

const LIST_SORTS = ['recent', 'name', 'size'] as const
export type ListSort = (typeof LIST_SORTS)[number]

export interface ListQuery {
  kind: ListKind
  /** Only what was shared in this channel. */
  channelId: string | null
  /** Only what this person added — `me` is the viewer. */
  by: string | null
  q: string | null
  /** ISO date: only what arrived on or after it. */
  since: string | null
  sort: ListSort
  trash: boolean
  /** Rows to skip — the next page's start. */
  offset: number
  limit: number
}

export const PAGE_SIZE = 60

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function parseListQuery(params: URLSearchParams): ListQuery {
  const since = params.get('since')
  const offset = Number(params.get('offset') ?? 0)
  const limit = Number(params.get('limit') ?? PAGE_SIZE)
  return {
    kind: pick(params.get('kind'), LIST_KINDS, 'all'),
    channelId: params.get('channel') || null,
    by: params.get('by') || null,
    q: params.get('q')?.trim().slice(0, 200) || null,
    since: since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null,
    sort: pick(params.get('sort'), LIST_SORTS, 'recent'),
    trash: params.get('trash') === '1',
    offset: Number.isInteger(offset) && offset > 0 ? Math.min(offset, 10_000) : 0,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : PAGE_SIZE,
  }
}

/** The URL search string for a query, leaving defaults out so keys stay short. */
export function listQueryString(query: Partial<ListQuery>): string {
  const params = new URLSearchParams()
  if (query.kind && query.kind !== 'all') params.set('kind', query.kind)
  if (query.channelId) params.set('channel', query.channelId)
  if (query.by) params.set('by', query.by)
  if (query.q) params.set('q', query.q)
  if (query.since) params.set('since', query.since)
  if (query.sort && query.sort !== 'recent') params.set('sort', query.sort)
  if (query.trash) params.set('trash', '1')
  if (query.offset) params.set('offset', String(query.offset))
  if (query.limit && query.limit !== PAGE_SIZE) params.set('limit', String(query.limit))
  return params.toString()
}
