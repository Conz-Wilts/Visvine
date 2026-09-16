/**
 * The space you are standing in is part of the URL: `/s/<space>/<page>`, or
 * `/s/<house>/<room>/<page>` inside a sub-space. A link is then the whole
 * address of a page — shared, bookmarked or restored, it opens the same space
 * for everyone, and two tabs can stand in two spaces.
 *
 * Pure, and read at both ends: `proxy.ts` rewrites a prefixed URL onto the
 * unprefixed route that renders it, and the client resolves the current space
 * from the same parse. The pages themselves never see the prefix.
 */

export const SPACE_URL_PREFIX = '/s'

/**
 * The top-level routes that render inside a space. A path under one of these
 * means nothing without a space; everything else (`/spaces`, `/discover`,
 * `/e/<slug>`, `/invite`, …) is the same page wherever you stand.
 *
 * A room's id is the segment after its house's, so no space may be named one
 * of these (`isSpaceRouteName`) — `/s/acme/events` must stay the house's events.
 */
const SPACE_ROUTE_ROOTS = [
  'home',
  'directory',
  'context',
  'events',
  'resources',
  'channels',
  'admin',
  'settings',
  'tools',
  't',
] as const

const ROOTS: ReadonlySet<string> = new Set(SPACE_ROUTE_ROOTS)

/** Where a space's URL lands when it names no page. */
const SPACE_HOME = '/home'

export interface SpaceUrl {
  /** The top-level space in the URL: the house, when a room is named. */
  houseId: string
  /** The sub-space named after the house, or null. */
  roomId: string | null
  /** The space the page renders in — the room when there is one. */
  spaceId: string
  /** The unprefixed page path (`/directory/note/index.md`), never empty. */
  rest: string
}

/** Whether a name is taken by a space route, and so cannot be a space id. */
export function isSpaceRouteName(id: string): boolean {
  return ROOTS.has(id.toLowerCase()) || id.toLowerCase() === 's'
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * Read a pathname (no search, no hash) as a space URL. Null when it does not
 * start with `/s/<space>`. The segment after the house is a room unless it is
 * a route root, which is what `isSpaceRouteName` keeps unambiguous.
 */
export function parseSpacePath(pathname: string): SpaceUrl | null {
  if (!pathname.startsWith(`${SPACE_URL_PREFIX}/`)) return null
  const segments = pathname.slice(SPACE_URL_PREFIX.length + 1).split('/')
  const house = segments[0] ? decode(segments[0]) : null
  if (!house) return null
  let index = 1
  let room: string | null = null
  const second = segments[1]
  if (second && !ROOTS.has(second)) {
    room = decode(second)
    if (!room) return null
    index = 2
  }
  const tail = segments.slice(index).join('/')
  const rest = tail ? `/${tail}` : SPACE_HOME
  return { houseId: house, roomId: room, spaceId: room ?? house, rest }
}

/** The pathname with any space prefix removed — what the route itself is. */
export function stripSpacePrefix(pathname: string): string {
  return parseSpacePath(pathname)?.rest ?? pathname
}

/** Whether an UNPREFIXED pathname is a page that renders inside a space. */
export function isSpaceScopedPath(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false
  const first = pathname.slice(1).split(/[/?#]/, 1)[0]
  return ROOTS.has(first)
}

/** The minimum a URL needs of a space: its id, and its house when it is a room. */
export interface SpaceUrlTarget {
  id: string
  parentId?: string | null
}

/** `/s/<space>` or `/s/<house>/<room>`. */
export function spaceUrlPrefix(space: SpaceUrlTarget): string {
  const id = encodeURIComponent(space.id)
  return space.parentId
    ? `${SPACE_URL_PREFIX}/${encodeURIComponent(space.parentId)}/${id}`
    : `${SPACE_URL_PREFIX}/${id}`
}

/**
 * Put a space in front of an in-app href. Only an unprefixed space page is
 * changed: an absolute URL, an API path, a page outside every space, or an href
 * that already names a space is returned as it is.
 */
export function withSpace(href: string, space: SpaceUrlTarget | null | undefined): string {
  if (!space || !href.startsWith('/') || href.startsWith('//')) return href
  if (!isSpaceScopedPath(href)) return href
  return `${spaceUrlPrefix(space)}${href}`
}

/**
 * An in-app href under a space known only by id — the server's form, which
 * holds no parent to name. A room addressed this way (`/s/<room>/…`) is
 * re-addressed under its house by the page that opens it.
 */
export function inSpace(spaceId: string, href: string): string {
  return withSpace(href, { id: spaceId })
}

/**
 * The same page in another space, for a switch. Only the route's first segment
 * travels (and the query that picks a Directory view or a console section):
 * an id deeper in the path belongs to the space being left.
 */
export function sameSectionIn(pathnameWithQuery: string, space: SpaceUrlTarget): string {
  const [rawPath, query = ''] = pathnameWithQuery.split('?', 2)
  const segments = stripSpacePrefix(rawPath).split('/').filter(Boolean)
  const root = segments[0]
  if (!root || !ROOTS.has(root) || root === 't' || root === 'tools') {
    return withSpace(SPACE_HOME, space)
  }
  const keep = segments.length === 1 && (root === 'directory' || root === 'admin' || root === 'settings') && query
  return withSpace(keep ? `/${root}?${query}` : `/${root}`, space)
}

/** A canonical prefix differs from the URL's — the room moved, or a house was omitted. */
export function isCanonicalSpaceUrl(url: SpaceUrl, space: SpaceUrlTarget): boolean {
  const parent = space.parentId ?? null
  return parent ? url.houseId === parent && url.roomId === space.id : url.houseId === space.id && url.roomId === null
}
