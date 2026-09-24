// Reading a link into a preview, the way Slack's unfurler does.
//
// Precedence, strongest first: the page's oEmbed answer, then its JSON-LD
// (schema.org — what the publisher says the thing IS: headline, author, date),
// then Open Graph, then Twitter card tags, then the plain `<title>` / meta
// description. A page image prefers Open Graph over JSON-LD, whose `image` is
// as often a logo as a picture of the story. A URL that is
// itself media (an image, a video, a PDF) previews as that media — its content
// type decides, and no HTML is read. Only the document head is read: that is
// where every one of these tags lives, and it bounds the work on a large page.
//
// Pure — no fetch, no DB. `lib/linkPreview.ts` does the I/O around it;
// `tests/link-unfurl.test.ts` covers it.

export type LinkMediaType = 'article' | 'image' | 'video' | 'audio' | 'file'
type ImageLayout = 'summary' | 'large'

export interface Unfurl {
  title: string | null
  description: string | null
  imageUrl: string | null
  siteName: string | null
  faviconUrl: string | null
  authorName: string | null
  /** ISO date the page says it was published (JSON-LD, then article:published_time). */
  publishedAt: string | null
  mediaType: LinkMediaType
  imageLayout: ImageLayout | null
}

/** The fields an oEmbed response may carry that a preview reads. Never `html`. */
export interface OEmbed {
  title?: unknown
  author_name?: unknown
  provider_name?: unknown
  thumbnail_url?: unknown
  type?: unknown
}

const URL_REGEX = /(https?:\/\/[^\s<>"'`]+)/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/

/** Every distinct http(s) URL in a message's text, trailing punctuation trimmed. */
export function extractUrls(text: string): string[] {
  const found = (text.match(URL_REGEX) ?? []).map((u) => u.replace(TRAILING_PUNCTUATION, ''))
  return Array.from(new Set(found.filter((u) => isHttpUrl(u))))
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The URL two shares of one link agree on: lower-case host, no `www.`, no
 * fragment, no tracking parameters, no trailing slash. Used only to fold
 * duplicates — the URL shown and opened is the one someone shared.
 */
export function normaliseUrl(value: string): string {
  try {
    const u = new URL(value)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^(utm_|fbclid$|gclid$|mc_eid$|ref_src$)/i.test(key)) u.searchParams.delete(key)
    }
    let out = u.toString()
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1)
    if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
    return out.replace(/^http:/, 'https:')
  } catch {
    return value
  }
}

/** What a response's content type says the URL is; null means read it as a page. */
export function mediaTypeOfContentType(contentType: string | null | undefined): LinkMediaType | null {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (!type || type === 'text/html' || type === 'application/xhtml+xml') return null
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

/** The last path segment, decoded — a media URL's name when it has no page. */
function fileNameOfUrl(value: string): string | null {
  try {
    const segment = new URL(value).pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : null
  } catch {
    return null
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** The head of a document: everything before `</head>`, or all of it. */
export function headOf(html: string): string {
  const end = html.search(/<\/head\s*>/i)
  return end === -1 ? html : html.slice(0, end)
}

type Attrs = Record<string, string>

/** Every `<tag …>` in the text, as lower-cased attribute maps, in any attribute order. */
function tagsNamed(html: string, tag: string): Attrs[] {
  const out: Attrs[] = []
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs: Attrs = {}
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
    let a: RegExpExecArray | null
    while ((a = attrRe.exec(m[1]))) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    }
    out.push(attrs)
  }
  return out
}

function clean(value: string | null | undefined, max = 500): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function resolve(href: string | null | undefined, base: string): string | null {
  if (!href) return null
  try {
    const url = new URL(href.trim(), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The oEmbed endpoint a page names for itself, resolved against it. */
export function oembedHrefOf(html: string, baseUrl: string): string | null {
  for (const link of tagsNamed(headOf(html), 'link')) {
    const rel = (link.rel ?? '').toLowerCase()
    const type = (link.type ?? '').toLowerCase()
    if (rel.split(/\s+/).includes('alternate') && type === 'application/json+oembed') {
      return resolve(link.href, baseUrl)
    }
  }
  return null
}

/** The fields a preview reads from a page's schema.org JSON-LD. */
interface LinkedData {
  title: string | null
  description: string | null
  image: string | null
  author: string | null
  publishedAt: string | null
  video: boolean
}

const LD_TYPES = /^(article|newsarticle|blogposting|reportagenewsarticle|techarticle|scholarlyarticle|webpage|videoobject|product|creativework|event|recipe|book|movie|podcastepisode|softwareapplication)$/i

function ldText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return ldText(value[0])
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return ldText(v.name ?? v.url ?? v['@value'])
  }
  return null
}

function ldTypes(node: Record<string, unknown>): string[] {
  const type = node['@type']
  return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string')
}

/**
 * The first schema.org thing a page's `<script type="application/ld+json">`
 * blocks describe, among the kinds a preview can use. Malformed blocks are
 * skipped; nothing in them is ever executed or rendered.
 */
function linkedDataOf(html: string): LinkedData | null {
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const nodes: unknown[] = []
    const visit = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') {
        nodes.push(value)
        const graph = (value as Record<string, unknown>)['@graph']
        if (graph) visit(graph)
      }
    }
    visit(parsed)
    for (const raw of nodes) {
      const node = raw as Record<string, unknown>
      const types = ldTypes(node)
      if (!types.some((t) => LD_TYPES.test(t))) continue
      const title = ldText(node.headline ?? node.name)
      if (!title) continue
      const published = ldText(node.datePublished ?? node.uploadDate ?? node.startDate)
      return {
        title,
        description: ldText(node.description),
        image: ldText(node.image ?? node.thumbnailUrl),
        author: ldText(node.author ?? node.creator),
        publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
        video: types.some((t) => /^videoobject$/i.test(t)),
      }
    }
  }
  return null
}

function ogMediaType(value: string | undefined): LinkMediaType {
  const type = (value ?? '').toLowerCase()
  if (type.startsWith('video')) return 'video'
  if (type.startsWith('music')) return 'audio'
  return 'article'
}

/**
 * A page's preview from its head, with an oEmbed answer laid over it when the
 * page offered one. Null when the page says nothing a preview could show.
 */
export function parseHead(html: string, baseUrl: string, oembed?: OEmbed | null): Unfurl | null {
  const head = headOf(html)
  const meta: Record<string, string> = {}
  for (const tag of tagsNamed(head, 'meta')) {
    const key = (tag.property ?? tag.name ?? tag.itemprop ?? '').toLowerCase()
    if (key && tag.content !== undefined && meta[key] === undefined) meta[key] = tag.content
  }
  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const docTitle = titleMatch ? decodeEntities(titleMatch[1]) : null

  let favicon: string | null = null
  for (const link of tagsNamed(head, 'link')) {
    const rels = (link.rel ?? '').toLowerCase().split(/\s+/)
    if (rels.includes('icon') || rels.includes('apple-touch-icon')) {
      favicon = resolve(link.href, baseUrl)
      if (rels.includes('icon')) break
    }
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const ld = linkedDataOf(head)
  const title = clean(str(oembed?.title) ?? ld?.title ?? meta['og:title'] ?? meta['twitter:title'] ?? docTitle, 300)
  const description = clean(ld?.description ?? meta['og:description'] ?? meta['twitter:description'] ?? meta.description)
  const imageUrl = resolve(
    str(oembed?.thumbnail_url) ?? meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['og:image:url']
      ?? meta['twitter:image'] ?? meta['twitter:image:src'] ?? ld?.image,
    baseUrl,
  )
  const siteName = clean(str(oembed?.provider_name) ?? meta['og:site_name'] ?? meta['application-name'], 120)
  const authorName = clean(str(oembed?.author_name) ?? ld?.author ?? meta.author ?? meta['article:author'], 120)
  const publishedRaw = ld?.publishedAt ?? meta['article:published_time'] ?? null
  const publishedAt = publishedRaw && !Number.isNaN(Date.parse(publishedRaw)) ? new Date(publishedRaw).toISOString() : null
  const oembedType = str(oembed?.type)
  const mediaType: LinkMediaType =
    oembedType === 'video' || ld?.video ? 'video'
      : oembedType === 'photo' ? 'image'
        : ogMediaType(meta['og:type'])
  const card = (meta['twitter:card'] ?? '').toLowerCase()
  const imageLayout: ImageLayout | null = !imageUrl
    ? null
    : card === 'summary' ? 'summary'
      : 'large'

  if (!title && !description && !imageUrl) return null
  return {
    title,
    description,
    imageUrl,
    siteName,
    faviconUrl: favicon ?? resolve('/favicon.ico', baseUrl),
    authorName,
    publishedAt,
    mediaType,
    imageLayout,
  }
}

/** The preview of a URL that is itself media — no page, so its name is its title. */
export function mediaUnfurl(url: string, mediaType: LinkMediaType): Unfurl {
  return {
    title: fileNameOfUrl(url),
    description: null,
    imageUrl: mediaType === 'image' ? url : null,
    siteName: null,
    faviconUrl: resolve('/favicon.ico', url),
    authorName: null,
    publishedAt: null,
    mediaType,
    imageLayout: mediaType === 'image' ? 'large' : null,
  }
}

/** The host a link is labelled with: `nytimes.com`, never `www.nytimes.com`. */
export function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}
