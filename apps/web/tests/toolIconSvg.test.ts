/**
 * The Tool icon sanitizer.
 *
 * This is the only thing standing between an author's uploaded SVG and the
 * app's own document — the icon renders in the sidebar rail, outside the Tool
 * iframe and all of its containment. So the tests below lean hard on the
 * rejection side: every known way to smuggle behaviour through an SVG gets its
 * own case, and the "it works" cases exist mostly to prove the rejections
 * aren't just a blanket refusal.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ICON_MAX_BYTES, sanitizeToolIcon } from '../lib/tools/iconSvg'

const wrap = (body: string, viewBox = '0 0 24 24') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`

function accepted(src: string): string {
  const result = sanitizeToolIcon(src)
  assert.equal(result.ok, true, `expected accept, got: ${result.ok ? '' : result.error}`)
  return result.ok ? result.svg : ''
}

function rejected(src: string): string {
  const result = sanitizeToolIcon(src)
  assert.equal(result.ok, false, 'expected reject, but it was accepted')
  return result.ok ? '' : result.error
}

describe('sanitizeToolIcon — what it accepts', () => {
  it('keeps a plain path', () => {
    assert.equal(accepted(wrap('<path d="M20 6 9 17l-5-5" />')), '<path d="M20 6 9 17l-5-5" />')
  })

  it('keeps every allowed shape', () => {
    const body =
      '<circle cx="12" cy="12" r="4" />' +
      '<rect x="1" y="2" width="3" height="4" rx="1" ry="1" />' +
      '<line x1="0" y1="0" x2="9" y2="9" />' +
      '<polyline points="1,2 3,4" />' +
      '<polygon points="1,2 3,4 5,6" />' +
      '<ellipse cx="1" cy="2" rx="3" ry="4" />'
    // rx/ry on <rect> are allowed; everything above survives untouched.
    assert.equal(accepted(wrap(body)), body)
  })

  it('keeps nested groups and their transforms', () => {
    const body = '<g transform="translate(2 2)"><path d="M0 0h4" /></g>'
    assert.equal(accepted(wrap(body)), body)
  })

  it('accepts an icon straight out of assets/icons', () => {
    const real = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"',
      '     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
      '  <path d="M10 11v6" />',
      '  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />',
      '</svg>',
    ].join('\n')
    // The root's own paint attributes are dropped — the renderer supplies them.
    assert.equal(
      accepted(real),
      '<path d="M10 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />',
    )
  })

  it('normalises whitespace in the viewBox rather than failing on it', () => {
    accepted(wrap('<path d="M0 0h4" />', '0  0,24 24'))
  })
})

describe('sanitizeToolIcon — script and behaviour', () => {
  it('rejects <script>', () => {
    rejected(wrap('<script>fetch("/api/me")</script>'))
  })

  it('rejects <script> hidden inside a group', () => {
    rejected(wrap('<g><script>alert(1)</script></g>'))
  })

  it('rejects event handlers', () => {
    assert.match(rejected(wrap('<path d="M0 0h4" onload="alert(1)" />')), /Event handlers/)
    assert.match(rejected(wrap('<path d="M0 0h4" onclick="alert(1)" />')), /Event handlers/)
  })

  it('rejects <foreignObject>, which can carry arbitrary HTML', () => {
    rejected(wrap('<foreignObject><div>hi</div></foreignObject>'))
  })

  it('rejects <animate>, which can rewrite an attribute after render', () => {
    rejected(wrap('<path d="M0 0h4" /><animate attributeName="d" to="M0 0h9" />'))
  })

  it('rejects <style>, a second language to have to reason about', () => {
    rejected(wrap('<style>path{fill:red}</style>'))
  })

  it('rejects a style attribute for the same reason', () => {
    assert.match(rejected(wrap('<path d="M0 0h4" style="fill:red" />')), /not allowed/)
  })
})

describe('sanitizeToolIcon — external references', () => {
  it('rejects <image>', () => {
    rejected(wrap('<image href="https://evil.test/x.png" />'))
  })

  it('rejects <use>, including its xlink spelling', () => {
    rejected(wrap('<use href="#x" />'))
    rejected(wrap('<use xlink:href="https://evil.test/x.svg#y" />'))
  })

  it('rejects <a>', () => {
    rejected(wrap('<a href="https://evil.test"><path d="M0 0h4" /></a>'))
  })

  it('rejects url(...) in an attribute value', () => {
    assert.match(
      rejected(wrap('<path d="M0 0h4" transform="url(#evil)" />')),
      /references something external/,
    )
  })

  it('rejects a data: URI in an attribute value', () => {
    assert.match(
      rejected(wrap('<path d="M0 0h4" transform="data:text/html,x" />')),
      /references something external/,
    )
  })

  it('rejects an entity reference, the classic billion-laughs vector', () => {
    rejected('<!DOCTYPE svg [<!ENTITY x "y">]>' + wrap('<path d="M0 0h4" />'))
    assert.match(
      rejected(wrap('<path d="M0 0h4" transform="&amp;#x41;" />')),
      /references something external/,
    )
  })
})

describe('sanitizeToolIcon — structure', () => {
  it('rejects markup that does not start with <svg>', () => {
    assert.match(rejected('<path d="M0 0h4" />'), /must start with an <svg>/)
  })

  it('rejects a nested <svg>', () => {
    assert.match(rejected(wrap('<svg viewBox="0 0 24 24"><path d="M0 0h4" /></svg>')), /nested/)
  })

  it('rejects a canvas that is not 24×24', () => {
    assert.match(rejected(wrap('<path d="M0 0h4" />', '0 0 16 16')), /24×24/)
    assert.match(rejected('<svg><path d="M0 0h4" /></svg>'), /24×24/)
  })

  it('rejects comments, which are a place to hide a second document', () => {
    rejected(wrap('<!-- <script>alert(1)</script> --><path d="M0 0h4" />'))
  })

  it('rejects stray text between elements', () => {
    assert.match(rejected(wrap('hello<path d="M0 0h4" />')), /stray text/)
  })

  it('rejects unquoted attribute values rather than guessing', () => {
    assert.match(rejected(wrap('<path d=M0 />')), /unquoted or malformed/)
  })

  it('rejects an unbalanced group', () => {
    assert.match(rejected(wrap('<g><path d="M0 0h4" />')), /Unbalanced/)
    assert.match(rejected(wrap('<path d="M0 0h4" /></g>')), /Unbalanced/)
  })

  it('rejects an icon with nothing to draw', () => {
    assert.match(rejected(wrap('')), /empty|nothing to draw/)
    assert.match(rejected('<svg viewBox="0 0 24 24" />'), /empty/)
  })

  it('rejects an id or class, which would reach into the host document', () => {
    assert.match(rejected(wrap('<path d="M0 0h4" id="x" />')), /not allowed/)
    assert.match(rejected(wrap('<path d="M0 0h4" class="x" />')), /not allowed/)
  })
})

describe('sanitizeToolIcon — caps', () => {
  it('rejects an icon over the byte cap', () => {
    const huge = wrap(`<path d="${'M0 0h4'.repeat(ICON_MAX_BYTES)}" />`)
    assert.match(rejected(huge), /under \d+KB/)
  })

  it('rejects an icon with too many shapes', () => {
    assert.match(rejected(wrap('<path d="M0 0h4" />'.repeat(200))), /too many/)
  })
})

describe('sanitizeToolIcon — output is rebuilt, not echoed', () => {
  it('rejects an entity in an attribute rather than decoding it', () => {
    // Decoding is where a sanitizer becomes a bypass: `&lt;script&gt;` that
    // survives as text and is decoded later by the renderer is an injection.
    // Geometry has no use for entities, so they never get that far.
    assert.match(rejected(wrap('<path d="M0 0h4 &lt;" />')), /references something external/)
  })

  it('drops the root element\'s own attributes', () => {
    const out = accepted(
      '<svg viewBox="0 0 24 24" width="999" fill="red" stroke="#f00"><path d="M0 0h4" /></svg>',
    )
    assert.equal(out, '<path d="M0 0h4" />')
  })
})
