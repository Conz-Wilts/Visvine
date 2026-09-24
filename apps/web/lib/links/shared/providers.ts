// The providers whose links we know: how to name the thing a URL points at,
// the one canonical address two shares of it agree on, and — for the ones we
// frame — the embed URL WE build. Pure.
//
// The allowlist is this table. A link to anywhere else is a card, never a
// frame: framing an arbitrary site inside our chrome is a phishing surface.
// An embed URL is always built here from the parsed id, never taken from a
// page's oEmbed `html` or any other string the page supplied. `FRAME_HOSTS`
// feeds the CSP's frame-src (lib/security/csp.ts), so the two cannot drift.

export type LinkProvider =
  | 'google-doc'
  | 'google-sheet'
  | 'google-slides'
  | 'google-drive'
  | 'figma'
  | 'youtube'
  | 'loom'
  | 'vimeo'
  | 'web'

export interface ProviderLink {
  provider: LinkProvider
  /** The canonical address: what dedupes shares of the same thing. */
  canonical: string
  /** An embeddable URL for the viewer, or null to draw the card. */
  embedUrl: string | null
  /** Whether the embed is a player (video) rather than a document. */
  player: boolean
}

/** How the viewer's primary action names where the link opens. */
export const PROVIDER_LABEL: Record<LinkProvider, string> = {
  'google-doc': 'Google Docs',
  'google-sheet': 'Google Sheets',
  'google-slides': 'Google Slides',
  'google-drive': 'Google Drive',
  figma: 'Figma',
  youtube: 'YouTube',
  loom: 'Loom',
  vimeo: 'Vimeo',
  web: 'browser',
}

/** Every origin an embed may be served from — the CSP frame-src list. */
export const FRAME_HOSTS = [
  'https://docs.google.com',
  'https://drive.google.com',
  'https://www.youtube-nocookie.com',
  'https://embed.figma.com',
  'https://www.loom.com',
  'https://player.vimeo.com',
] as const

const GOOGLE_DOC_TYPES: Record<string, LinkProvider> = {
  document: 'google-doc',
  spreadsheets: 'google-sheet',
  presentation: 'google-slides',
}

const ID = /^[A-Za-z0-9_-]{6,}$/

function parse(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function youtubeId(url: URL, host: string): string | null {
  if (host === 'youtu.be') return url.pathname.split('/')[1] || null
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') return url.searchParams.get('v')
    const [, kind, id] = url.pathname.split('/')
    if (kind === 'shorts' || kind === 'embed' || kind === 'live') return id || null
  }
  return null
}

/** A known provider's reading of a URL, or null for the open web. */
export function providerOf(value: string): ProviderLink | null {
  const url = parse(value)
  if (!url) return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'docs.google.com') {
    // /document/d/<id>/edit, /spreadsheets/u/0/d/<id>/…
    const d = parts.indexOf('d')
    const provider = GOOGLE_DOC_TYPES[parts[0] ?? '']
    const id = d >= 0 ? parts[d + 1] : undefined
    if (provider && id && ID.test(id)) {
      const base = `https://docs.google.com/${parts[0]}/d/${id}`
      return { provider, canonical: base, embedUrl: `${base}/preview`, player: false }
    }
  }
  if (host === 'drive.google.com') {
    const d = parts.indexOf('d')
    const id = parts[0] === 'file' && d >= 0 ? parts[d + 1] : url.pathname === '/open' ? url.searchParams.get('id') : null
    if (id && ID.test(id)) {
      const base = `https://drive.google.com/file/d/${id}`
      return { provider: 'google-drive', canonical: base, embedUrl: `${base}/preview`, player: false }
    }
  }
  const yt = youtubeId(url, host)
  if (yt && ID.test(yt)) {
    return {
      provider: 'youtube',
      canonical: `https://www.youtube.com/watch?v=${yt}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`,
      player: true,
    }
  }
  if (host === 'figma.com') {
    const [kind, key] = parts
    if (['file', 'design', 'proto', 'board', 'slides'].includes(kind ?? '') && key && ID.test(key)) {
      const node = url.searchParams.get('node-id')
      return {
        provider: 'figma',
        canonical: `https://www.figma.com/${kind}/${key}`,
        embedUrl: `https://embed.figma.com/${kind}/${key}?embed-host=visvine${node ? `&node-id=${encodeURIComponent(node)}` : ''}`,
        player: false,
      }
    }
  }
  if (host === 'loom.com' && (parts[0] === 'share' || parts[0] === 'embed') && parts[1] && ID.test(parts[1])) {
    return {
      provider: 'loom',
      canonical: `https://www.loom.com/share/${parts[1]}`,
      embedUrl: `https://www.loom.com/embed/${parts[1]}`,
      player: true,
    }
  }
  if (host === 'vimeo.com' && parts[0] && /^\d+$/.test(parts[0])) {
    return {
      provider: 'vimeo',
      canonical: `https://vimeo.com/${parts[0]}`,
      embedUrl: `https://player.vimeo.com/video/${parts[0]}`,
      player: true,
    }
  }
  return null
}

/** Query keys that say where a click came from, never what was linked. */
const TRACKING = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|igshid$|ref_src$|ref_url$|_hsenc$|_hsmi$|mkt_tok$|si$|spm$|yclid$)/i

/**
 * The address two shares of one link agree on. A known provider's is its own
 * canonical form (a Sheet's `/edit#gid=0` and `/view` are one Sheet); anything
 * else is normalised — https, lower-case host without `www.`, no fragment, no
 * tracking keys, the rest sorted, no trailing slash. Used to dedupe only: the
 * URL a person opens is the one they shared.
 */
export function canonicalUrl(value: string): string | null {
  const known = providerOf(value)
  if (known) return known.canonical
  const url = parse(value)
  if (!url) return null
  url.hash = ''
  url.protocol = 'https:'
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  if (url.port === '443' || url.port === '80') url.port = ''
  const keep = [...url.searchParams.entries()].filter(([key]) => !TRACKING.test(key))
  keep.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)))
  url.search = ''
  for (const [key, val] of keep) url.searchParams.append(key, val)
  let out = url.toString()
  if (url.pathname !== '/' && out.endsWith('/') && !url.search) out = out.slice(0, -1)
  if (url.pathname === '/' && !url.search) out = out.replace(/\/$/, '')
  return out
}

/** The provider a URL belongs to, `web` for the open web. */
export function linkProviderOf(value: string): LinkProvider {
  return providerOf(value)?.provider ?? 'web'
}

/**
 * A provider's own oEmbed endpoint for a URL, for the providers that publish
 * one — asked before the page itself, because their pages answer a server
 * with consent walls and script shells rather than tags. What it answers is
 * read for text and a thumbnail only; its `html` is never used.
 */
export function oembedEndpointOf(value: string): string | null {
  const known = providerOf(value)
  if (!known) return null
  const target = encodeURIComponent(known.canonical)
  switch (known.provider) {
    case 'youtube':
      return `https://www.youtube.com/oembed?format=json&url=${target}`
    case 'vimeo':
      return `https://vimeo.com/api/oembed.json?url=${target}`
    case 'loom':
      return `https://www.loom.com/v1/oembed?url=${target}`
    case 'figma':
      return `https://www.figma.com/api/oembed?url=${target}`
    default:
      return null
  }
}
