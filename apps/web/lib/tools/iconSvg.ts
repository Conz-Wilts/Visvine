/**
 * The sanitizer for a Tool author's own icon.
 *
 * A Tool runs inside a sandboxed, cookie-less iframe with `connect-src 'none'`
 * — but its ICON does not. The icon is drawn in the sidebar rail and the
 * marketplace, in the app's own document, under the viewer's session. None of
 * the Tool runtime's containment applies to it. This module is the entire
 * boundary, so it is written as an allowlist and nothing else: an element or an
 * attribute that is not named here does not survive, and anything structurally
 * surprising is rejected outright rather than repaired.
 *
 * The output is re-serialised from what was parsed, never echoed through from
 * the input. That is the property that matters: whatever the author sent, what
 * gets rendered is a document this file built out of geometry it recognised.
 *
 * Pure and dependency-free so tests/toolIconSvg.test.ts can hammer it without a
 * DOM, a database or a network.
 */
import { resolveToolIconName } from '@/lib/icons/toolIcons'
import { ICON_SVGS } from '@/lib/icons/svg.generated'

/** Elements an icon may contain. Geometry only — no text, no references. */
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
])

/**
 * Attributes a child element may carry.
 *
 * No `id`, `class` or `style`: an icon has no business naming things in the
 * host document, and `style` is a second expression language to have to reason
 * about. Stroke is inherited; fill is limited to `none` or `currentColor`,
 * so geometry can use the same theme-owned fills as the app's icons.
 */
const ALLOWED_ATTRS = new Set([
  'fill',
  // path / polyline / polygon
  'd', 'points',
  // circle / ellipse
  'cx', 'cy', 'r', 'rx', 'ry',
  // rect
  'x', 'y', 'width', 'height',
  // line
  'x1', 'y1', 'x2', 'y2',
  // shape-level stroke tuning and rules
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'fill-rule', 'clip-rule',
  'transform',
])

/**
 * Attribute values that may not contain a reference of any kind.
 *
 * Defence in depth, NOT the boundary — ALLOWED_ATTRS excludes URL-bearing
 * attributes except fill, whose value must pass an exact two-value allowlist.
 * Presentation attributes are parsed as CSS; this regex alone cannot make
 * an attribute that accepts URLs safe.
 */
const REFERENCE_RE = /url\s*\(|data:|javascript:|&#|&\w+;/i

/**
 * Caps. An icon is a handful of paths; anything near these is not an icon, and
 * the point of a cap is to fail fast rather than to be generous.
 */
export const ICON_MAX_BYTES = 16 * 1024
const ICON_MAX_ELEMENTS = 64
const ICON_MAX_ATTR_LENGTH = 4_000

export type IconResult =
  | { ok: true; svg: string }
  | { ok: false; error: string }

function fail(error: string): IconResult {
  return { ok: false, error }
}

interface Element {
  tag: string
  attrs: Record<string, string>
  selfClosing: boolean
  closing: boolean
}

/**
 * Tokenise the markup into elements, refusing anything that isn't one.
 *
 * Not a general SVG parser and not trying to be. Comments, CDATA, processing
 * instructions, DOCTYPEs and entity declarations are all rejected rather than
 * skipped — every one of them is a known vector for smuggling markup past a
 * naive reader, and a legitimate icon has no reason to contain any of them.
 */
function tokenize(src: string): Element[] | { error: string } {
  const elements: Element[] = []
  let i = 0

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      if (src.slice(i).trim()) return { error: 'stray text outside an element' }
      break
    }
    if (src.slice(i, lt).trim()) return { error: 'stray text between elements' }

    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      return { error: 'comments, doctypes and processing instructions are not allowed' }
    }

    const gt = src.indexOf('>', lt)
    if (gt === -1) return { error: 'unterminated tag' }

    const raw = src.slice(lt + 1, gt).trim()
    const closing = raw.startsWith('/')
    const selfClosing = raw.endsWith('/')
    const inner = raw.replace(/^\//, '').replace(/\/$/, '').trim()

    const nameMatch = /^([A-Za-z][A-Za-z0-9]*)/.exec(inner)
    if (!nameMatch) return { error: 'unparseable tag' }
    const tag = nameMatch[1].toLowerCase()

    // Null-prototype: on a plain `{}`, an attribute literally named
    // `__proto__` hits Object.prototype's setter and never becomes an own key,
    // so it would slip past the allowlist below by disappearing rather than by
    // being refused. Dropping is the safe direction, but an attribute that
    // routes around the check at all is the wrong shape for this file.
    const attrs: Record<string, string> = Object.create(null)
    if (!closing) {
      const attrSrc = inner.slice(nameMatch[0].length)
      // Quoted values only. An unquoted value is where parser disagreements
      // live, so it is a rejection rather than a best guess.
      const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"|([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*'([^']*)'/g
      let m: RegExpExecArray | null
      while ((m = attrRe.exec(attrSrc))) {
        const name = (m[1] ?? m[3]).toLowerCase()
        attrs[name] = m[2] ?? m[4]
      }
      // Whatever the attribute matcher did not consume is, by definition,
      // something it did not understand — an unquoted value, a bare word, a
      // stray quote. Rejecting the residue is what keeps "parsed nothing" from
      // reading as "no attributes".
      const residue = attrSrc.replace(attrRe, '').trim()
      if (residue) return { error: `unquoted or malformed attribute near "${residue.slice(0, 24)}"` }
    }

    elements.push({ tag, attrs, selfClosing, closing })
    if (elements.length > ICON_MAX_ELEMENTS * 2) return { error: 'too many elements' }
    i = gt + 1
  }

  return elements
}

/**
 * Sanitize an author's SVG into the markup we are willing to render.
 *
 * Returns the serialised children of the root only — the root `<svg>` is
 * rebuilt by the renderer from the same `IconBase` chrome every owned glyph
 * uses, so an uploaded icon cannot set its own viewBox, size, paint or anything
 * else about the box it sits in.
 */
export function sanitizeToolIcon(input: string): IconResult {
  const src = input.trim()
  if (!src) return fail('The icon is empty.')
  if (Buffer.byteLength(src, 'utf8') > ICON_MAX_BYTES) {
    return fail(`The icon must be under ${Math.round(ICON_MAX_BYTES / 1024)}KB.`)
  }

  const tokens = tokenize(src)
  if (!Array.isArray(tokens)) return fail(`The icon could not be read: ${tokens.error}.`)
  if (tokens.length === 0) return fail('The icon has no elements.')

  const root = tokens[0]
  if (root.closing || root.tag !== 'svg') return fail('The icon must start with an <svg> element.')

  // The box is fixed. Rescaling silently would move every stroke off the pixel
  // grid the rest of the chrome is drawn to, so a different box is a rejection
  // with an instruction, not a repair.
  const viewBox = (root.attrs.viewbox ?? '').trim().replace(/[\s,]+/g, ' ')
  if (viewBox !== '0 0 24 24') {
    return fail('The icon must be drawn on a 24×24 canvas (viewBox="0 0 24 24").')
  }

  const out: string[] = []
  let depth = 0
  let drawn = 0

  for (let i = 0; i < tokens.length; i++) {
    const el = tokens[i]

    if (el.tag === 'svg') {
      // The root's opening tag was consumed above and its closing tag is the
      // last thing we expect to see; an <svg> anywhere else is a nested
      // document, which is a rejection rather than something to flatten.
      if (el.closing) {
        if (i !== tokens.length - 1) return fail('The icon may not contain a nested <svg>.')
        continue
      }
      if (i !== 0) return fail('The icon may not contain a nested <svg>.')
      if (el.selfClosing) return fail('The icon is empty.')
      continue
    }

    if (!ALLOWED_ELEMENTS.has(el.tag)) {
      return fail(`<${el.tag}> is not allowed in an icon — use paths and basic shapes only.`)
    }

    if (el.closing) {
      if (el.tag === 'g') {
        depth--
        if (depth < 0) return fail('Unbalanced <g> in the icon.')
        out.push('</g>')
      }
      continue
    }

    for (const [name, value] of Object.entries(el.attrs)) {
      if (name.startsWith('on')) return fail(`Event handlers (${name}) are not allowed in an icon.`)
      if (name === 'href' || name.endsWith(':href') || name === 'xlink:href') {
        return fail('Links and external references are not allowed in an icon.')
      }
      if (!ALLOWED_ATTRS.has(name)) {
        return fail(`The attribute "${name}" is not allowed in an icon.`)
      }
      if (name === 'fill' && value !== 'none' && value !== 'currentColor') {
        return fail('The fill attribute must be none or currentColor.')
      }
      if (value.length > ICON_MAX_ATTR_LENGTH) return fail(`The "${name}" attribute is too long.`)
      if (REFERENCE_RE.test(value)) {
        return fail(`The "${name}" attribute references something external, which icons may not do.`)
      }
    }

    const attrs = Object.entries(el.attrs)
      .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
      .join('')

    if (el.tag === 'g' && !el.selfClosing) {
      depth++
      out.push(`<g${attrs}>`)
      continue
    }

    drawn++
    if (drawn > ICON_MAX_ELEMENTS) return fail('The icon has too many shapes.')
    out.push(`<${el.tag}${attrs} />`)
  }

  if (depth !== 0) return fail('Unbalanced <g> in the icon.')
  if (drawn === 0) return fail('The icon has nothing to draw.')

  // Check the answer, don't just trust the walk that produced it.
  //
  // Everything above is careful, but "careful" is a property of code as written
  // and this is the one function where a regression is a stored XSS in app
  // chrome. So the output is re-read against the grammar it is supposed to be
  // in — allowed tags, allowed attributes, every value double-quoted with no
  // raw quote or angle bracket inside. Anything else means a bug upstream of
  // here, and the right response to that is to emit nothing.
  const svg = out.join('')
  if (!isWellFormedOutput(svg)) return fail('The icon could not be safely rewritten.')

  return { ok: true, svg }
}

/**
 * Whether `svg` is inside the narrow grammar {@link sanitizeToolIcon} emits:
 * a sequence of `</g>`, `<g …>` and self-closing allowed shapes, whose
 * attributes are all allowlisted and whose values carry no `"`, `<` or `>`.
 */
function isWellFormedOutput(svg: string): boolean {
  const TOKEN = /<\/g>|<([a-z]+)((?:\s+[a-z0-9-]+="[^"<>]*")*)\s*\/?>/y
  let i = 0
  while (i < svg.length) {
    TOKEN.lastIndex = i
    const m = TOKEN.exec(svg)
    if (!m) return false
    if (m[1] !== undefined) {
      if (!ALLOWED_ELEMENTS.has(m[1]) || m[1] === 'svg') return false
      for (const attr of m[2].matchAll(/\s+([a-z0-9-]+)=/g)) {
        if (!ALLOWED_ATTRS.has(attr[1])) return false
      }
    }
    i = TOKEN.lastIndex
  }
  return true
}

/** Attribute values are re-serialised, so the quoting is ours to guarantee. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** An app icon's SVG by any name a model might use for it, or null. */
export function namedIconSvg(name: string): string | null {
  const resolved = resolveToolIconName(name)
  return resolved ? ICON_SVGS[resolved] : null
}
