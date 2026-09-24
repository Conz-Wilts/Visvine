/**
 * A fetched page as a model should read it — pure, no DOM, no I/O.
 *
 * An agent's `fetch_url` used to hand the model the raw body: every script,
 * style and attribute of an HTML page, every highlight copy of an API's JSON.
 * The model pays for that text on the turn it arrives and on every turn after,
 * and reads worse for it. This keeps what a reader needs:
 *
 *   HTML  the title, headings as `#`, list items as `- `, table cells joined
 *         with ` | `, and every link as `[text](absolute url)` — links are how
 *         an agent goes anywhere next, so they are never dropped
 *   JSON  the same data, minus search engines' marked-up copies of it
 *         (`_highlightResult`, `_snippetResult`) and with a long list of bare
 *         numbers (child ids, a time series) said as its length, one record
 *         per line when the body is a list under `hits` / `items` /
 *         `results` / `data`
 *   else  as it came
 *
 * Deliberately regex-shaped rather than a parser: the input is untrusted and
 * capped, the output is text for a model, and nothing here executes or
 * resolves anything but a URL against the page's own.
 */

const DROP_BLOCKS = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'nav', 'footer', 'form', 'select']
const LIST_KEYS = ['hits', 'items', 'results', 'data', 'entries', 'records']
const MARKUP_COPY_KEYS = new Set(['_highlightResult', '_snippetResult'])
/** A list of more bare numbers than this reads as its length. */
const NUMBER_LIST_MAX = 12

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

function absolute(href: string, base: string | null): string | null {
  const h = decodeEntities(href.trim())
  if (!h || h.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(h)) return null
  try {
    return base ? new URL(h, base).href : new URL(h).href
  } catch {
    return null
  }
}

const inlineText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

function htmlToReadable(html: string, baseUrl: string | null = null): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ')
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1]
  s = s.replace(/<head[\s\S]*?<\/head>/i, ' ')
  for (const tag of DROP_BLOCKS) s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  s = s.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi, (_m, d, q, u, inner: string) => {
    const text = inlineText(inner)
    const href = absolute(d ?? q ?? u ?? '', baseUrl)
    return text ? (href ? ` [${text}](${href}) ` : ` ${text} `) : ' '
  })
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inlineText(inner)}\n\n`)
  s = s.replace(/<li\b[^>]*>/gi, '\n- ')
  s = s.replace(/<\/(td|th)>/gi, ' | ')
  s = s.replace(/<(br|hr)\b[^>]*>/gi, '\n')
  s = s.replace(/<\/?(p|div|section|article|main|header|aside|tr|table|ul|ol|dl|dt|dd|blockquote|pre|figure|figcaption|tbody|thead)\b[^>]*>/gi, '\n')
  s = decodeEntities(s.replace(/<[^>]+>/g, ' '))
  const lines = s
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').replace(/(\s*\|\s*)+$/, '').replace(/^(\s*\|\s*)+/, '').trim())
    .filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''))
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const heading = title ? `# ${inlineText(title)}` : ''
  return heading && !body.startsWith(heading) ? `${heading}\n\n${body}` : body
}

function withoutMarkupCopies(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > NUMBER_LIST_MAX && value.every((v) => typeof v === 'number')) return `[${value.length} numbers]`
    return value.map(withoutMarkupCopies)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) if (!MARKUP_COPY_KEYS.has(k)) out[k] = withoutMarkupCopies(v)
    return out
  }
  return value
}

function jsonToReadable(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const clean = withoutMarkupCopies(parsed)
  if (clean && typeof clean === 'object' && !Array.isArray(clean)) {
    const obj = clean as Record<string, unknown>
    const key = LIST_KEYS.find((k) => Array.isArray(obj[k]))
    if (key) {
      const rest = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key))
      const list = obj[key] as unknown[]
      return [`${JSON.stringify(rest)}`, `${key} (${list.length}):`, ...list.map((item) => JSON.stringify(item))].join('\n')
    }
  }
  if (Array.isArray(clean)) return clean.map((item) => JSON.stringify(item)).join('\n')
  return JSON.stringify(clean)
}

/** The body as a model should read it; the original when it is neither HTML nor JSON. */
export function readableText(body: string, contentType: string | null, baseUrl: string | null = null): string {
  const type = (contentType ?? '').toLowerCase()
  const head = body.trimStart().slice(0, 200).toLowerCase()
  if (type.includes('json') || ((head.startsWith('{') || head.startsWith('[')) && !type.includes('html'))) {
    return jsonToReadable(body) ?? body
  }
  if (type.includes('html') || head.startsWith('<!doctype html') || head.startsWith('<html')) return htmlToReadable(body, baseUrl)
  return body
}
