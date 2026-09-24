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
 * One linear pass over the tags rather than a parser: the input is untrusted
 * and capped, the output is text for a model, and nothing here executes or
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

const DROP = new Set(DROP_BLOCKS)
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'aside', 'tr', 'table', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'figure', 'figcaption', 'tbody', 'thead'])
/** Past this the page is read no further: every step below is linear, and a model reads the top anyway. */
const MAX_HTML_CHARS = 400_000

/**
 * One pass over the tags, left to right — never a pattern that scans ahead for
 * a closing tag, so a page of a thousand unclosed tags costs what its length
 * does. Text is kept, dropped blocks are skipped to their close (or the end),
 * and an anchor or heading is written out when it closes.
 */
function htmlToReadable(html: string, baseUrl: string | null = null): string {
  const src = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html
  const tag = /<!--|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g
  const out: string[] = []
  let title: string | null = null
  let skipping: string | null = null
  let inTitle = false
  let anchor: { href: string | null; start: number } | null = null
  let heading: { level: number; start: number } | null = null
  let at = 0
  const text = (from: number, to: number) => {
    if (!skipping && to > from) out.push(src.slice(from, to))
  }
  const closeAnchor = () => {
    if (!anchor) return
    const inner = inlineText(out.splice(anchor.start).join(''))
    out.push(inner ? (anchor.href ? ` [${inner}](${anchor.href}) ` : ` ${inner} `) : ' ')
    anchor = null
  }
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    if (m[0] === '<!--') {
      text(at, m.index)
      const end = src.indexOf('-->', tag.lastIndex)
      at = tag.lastIndex = end === -1 ? src.length : end + 3
      continue
    }
    text(at, m.index)
    at = tag.lastIndex
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    if (skipping) {
      if (closing && name === skipping) skipping = null
      continue
    }
    if (name === 'title') {
      if (!closing) inTitle = true
      else if (inTitle) {
        title = inlineText(out.splice(out.length - 1, 1).join(''))
        inTitle = false
      }
      continue
    }
    if (DROP.has(name)) {
      if (!closing) skipping = name
      continue
    }
    if (name === 'a') {
      closeAnchor()
      if (!closing) {
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3])
        anchor = { href: href ? absolute(href[1] ?? href[2] ?? href[3] ?? '', baseUrl) : null, start: out.length }
      }
      continue
    }
    const h = /^h([1-6])$/.exec(name)
    if (h) {
      closeAnchor()
      if (!closing) heading = { level: Number(h[1]), start: out.length }
      else if (heading) {
        const inner = inlineText(out.splice(heading.start).join(''))
        out.push(`\n\n${'#'.repeat(heading.level)} ${inner}\n\n`)
        heading = null
      }
      continue
    }
    if (name === 'li' && !closing) out.push('\n- ')
    else if ((name === 'td' || name === 'th') && closing) out.push(' | ')
    else if (name === 'br' || name === 'hr') out.push('\n')
    else if (BLOCK.has(name)) out.push('\n')
  }
  text(at, src.length)
  closeAnchor()
  const lines = decodeEntities(out.join('').replace(/<[^>]*>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').replace(/(\s*\|\s*)+$/, '').replace(/^(\s*\|\s*)+/, '').trim())
    .filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''))
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const headingLine = title ? `# ${title}` : ''
  return headingLine && !body.startsWith(headingLine) ? `${headingLine}\n\n${body}` : body
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
