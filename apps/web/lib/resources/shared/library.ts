// Resources: everything unstructured a space holds, in one list, the way
// Slack's Files browser holds every file shared anywhere.
//
// Four sources feed it (lib/resources/library.ts reads them): Drive files
// (uploaded in the tab, by an AI, or dropped into a channel), links added as
// resources, links shared in channel messages, and event images. Each arrives
// as a `LibraryItem`; this module folds them into the one list — a link shared
// many times is one row, and a link someone ADDED as a resource is that row,
// carrying how often it was shared.
//
// Pure — no DB, no React. `tests/resource-library.test.ts` covers it.

import { normaliseUrl } from '@/lib/links/shared/unfurl'

type LibraryKind = 'file' | 'link'
export type LibraryFilter = 'all' | 'files' | 'links'
/** Where an item came from: the Drive, a channel, an event, or added as a resource. */
type LibrarySource = 'drive' | 'channel' | 'event' | 'added'

const LIBRARY_FILTERS: readonly LibraryFilter[] = ['all', 'files', 'links']
const LIBRARY_PAGE = 60

export interface LibraryItem {
  /** Stable across reads: `file:<id>`, `link:<normalised url>`, `event:<node id>`. */
  key: string
  kind: LibraryKind
  source: LibrarySource
  name: string
  /** A file's type (`image`, `pdf`, …); null for a link. */
  fileType: string | null
  fileSize: number | null
  /** The link itself, or a file's `/raw` address. */
  url: string | null
  /** What the row draws: an image file, a link's og image, an event's cover. */
  thumbUrl: string | null
  faviconUrl: string | null
  siteName: string | null
  description: string | null
  /** The in-app page the row opens; null opens `url` in a new tab. */
  href: string | null
  addedBy: string | null
  channel: { id: string; name: string } | null
  /** How many messages shared this link (links only; 0 elsewhere). */
  shares: number
  createdAt: string
}

export interface LibraryPage {
  items: LibraryItem[]
  /** Pass back as `before` for the next page; null when this was the last. */
  nextBefore: string | null
}

export function isLibraryFilter(value: string | null | undefined): value is LibraryFilter {
  return !!value && (LIBRARY_FILTERS as readonly string[]).includes(value)
}

export function linkKey(url: string): string {
  return `link:${normaliseUrl(url)}`
}

/**
 * Fold every link share onto one row per URL. An added link wins the row and
 * keeps its own name and page; a row made only of shares takes the newest
 * share's channel and date. Either way `shares` counts the messages.
 */
function foldLinks(items: LibraryItem[]): LibraryItem[] {
  const out: LibraryItem[] = []
  const links = new Map<string, LibraryItem>()
  for (const item of items) {
    if (item.kind !== 'link') {
      out.push(item)
      continue
    }
    const held = links.get(item.key)
    if (!held) {
      links.set(item.key, { ...item })
      continue
    }
    const shares = held.shares + item.shares
    const itemWins =
      (item.source === 'added' && held.source !== 'added') ||
      (item.source === held.source && item.createdAt > held.createdAt)
    const winner = itemWins ? item : held
    const loser = itemWins ? held : item
    links.set(item.key, {
      ...winner,
      thumbUrl: winner.thumbUrl ?? loser.thumbUrl,
      faviconUrl: winner.faviconUrl ?? loser.faviconUrl,
      siteName: winner.siteName ?? loser.siteName,
      description: winner.description ?? loser.description,
      channel: winner.channel ?? loser.channel,
      shares,
    })
  }
  return [...out, ...links.values()]
}

function matches(item: LibraryItem, q: string): boolean {
  const hay = [item.name, item.siteName, item.url, item.fileType, item.channel?.name, item.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word))
}

/** The one list: folded, filtered, newest first, cut to a page. */
export function foldLibrary(
  items: LibraryItem[],
  opts: { filter?: LibraryFilter; q?: string; limit?: number } = {},
): LibraryPage {
  const limit = opts.limit ?? LIBRARY_PAGE
  const q = opts.q?.trim() ?? ''
  const folded = foldLinks(items)
    .filter((item) =>
      opts.filter === 'files' ? item.kind === 'file' : opts.filter === 'links' ? item.kind === 'link' : true,
    )
    .filter((item) => !q || matches(item, q))
    .sort((a, b) => (a.createdAt === b.createdAt ? a.key.localeCompare(b.key) : a.createdAt < b.createdAt ? 1 : -1))
  const page = folded.slice(0, limit)
  const more = folded.length > limit
  return { items: page, nextBefore: more ? page[page.length - 1].createdAt : null }
}
