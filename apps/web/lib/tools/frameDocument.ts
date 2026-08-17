/**
 * The HTML a Tool's iframe loads — pure string building, no I/O, no env.
 *
 * This document is the entire bridge between the sandbox and a Tool's compiled
 * bundle, and it is deliberately tiny: a charset, one import map, one empty
 * root, one module script and a stylesheet that does nothing but stop the
 * frame looking like a 1997 web page. Everything else a Tool sees comes from
 * `@visvine/tool-kit`.
 *
 * What the CSP forces (lib/tools/csp.ts):
 *
 *   • Every executable script here is INLINE — an import map has no reliable
 *     external form across browsers — so `script-src` must carry a nonce and
 *     the caller must pass the same one it put in the header. Without a nonce
 *     the document renders and does nothing, which is why `nonce` being
 *     optional is a convenience for tests, not a supported way to serve it.
 *   • No inline event handlers anywhere. `'unsafe-inline'` is not in the
 *     policy, and adding it to allow one `onclick` would re-open the whole
 *     script surface.
 *   • Nothing is loaded from an origin other than `selfOrigin`: the bundle and
 *     all four vendor modules are served by the runtime routes on the tools
 *     host. `appOrigin` appears exactly once, as a string — the postMessage
 *     target the frame is allowed to talk to — and is never fetched.
 */
import type { VendorFileName } from './vendorBundle'

/**
 * Restated from features/tools/kit/runtime.ts#PARENT_ORIGIN_GLOBAL, which
 * cannot be imported here: it pulls in React and lib/ is React-free by lint
 * rule. tests/tools-frame-document.test.ts pins the two together.
 */
const PARENT_ORIGIN_GLOBAL = '__VISVINE_PARENT_ORIGIN'

/** Bare specifier → vendor file. The compile pipeline's EXTERNALS, resolved. */
const IMPORT_MAP_ENTRIES: ReadonlyArray<readonly [string, VendorFileName]> = [
  ['react', 'react.js'],
  ['react/jsx-runtime', 'react-jsx-runtime.js'],
  ['react-dom/client', 'react-dom-client.js'],
  ['@visvine/tool-kit', 'tool-kit.js'],
]

/**
 * Minimal, on purpose. `color-scheme` is what makes form controls and the
 * default canvas follow the host's theme — the frame is a separate document,
 * so it inherits nothing — and the host sizes the iframe from the Tool's own
 * height (runtime.ts observes it), so the body must not stretch or scroll.
 */
const BASE_STYLE = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light dark}
html,body{margin:0;padding:0}
body{background:transparent;font:inherit}
#root{min-height:0}
.vv-frame-error{margin:0;padding:24px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.vv-frame-error h1{margin:0 0 8px;font-size:15px;font-weight:600}
.vv-frame-error p{margin:0 0 12px;opacity:.75}
.vv-frame-error ol{margin:0;padding-left:20px}
.vv-frame-error li{margin:0 0 6px}
.vv-frame-error code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;opacity:.8}
`.trim()

/** Text going into element content or an attribute value. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A JSON/JS literal safe to put inside a `<script>` body. `<` is escaped
 * because the HTML parser ends the element at a literal `</script`, wherever
 * it appears — including inside a string.
 */
function scriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** ` nonce="…"`, or nothing. */
function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${escapeHtml(nonce)}"` : ''
}

function page(opts: { nonce?: string; head?: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visvine Tool</title>
<style${nonceAttr(opts.nonce)}>${BASE_STYLE}</style>${opts.head ?? ''}
</head>
<body>
${opts.body}
</body>
</html>
`
}

export interface FrameDocumentOptions {
  /** The origin serving this document — the tools origin, or the app's own in the same-origin fallback. */
  selfOrigin: string
  /** The Visvine page embedding the frame; the only postMessage peer the bridge will talk to. */
  appOrigin: string
  /** Absolute URL of this Tool's compiled ESM bundle. */
  bundleUrl: string
  /** Absolute URL prefix the four vendor modules are served under, without a trailing slash. */
  vendorBase: string
  /**
   * ETag per vendor file, appended as `?v=…`. Omitting one only costs the
   * year-long immutable cache for that file — the URL still resolves.
   */
  vendorVersions?: Partial<Record<VendorFileName, string>>
  /** The CSP nonce. Required in practice — see the module comment. */
  nonce?: string
}

function vendorUrl(opts: FrameDocumentOptions, file: VendorFileName): string {
  const version = opts.vendorVersions?.[file]
  return `${opts.vendorBase}/${file}${version ? `?v=${encodeURIComponent(version)}` : ''}`
}

/**
 * The document a Tool frame boots from.
 *
 * The module script imports the kit first (imports are evaluated before any
 * statement here runs), declares the parent origin the way runtime.ts
 * documents, then hands `bootTool` a thunk — so a bundle that throws while
 * evaluating fails inside the kit's error handling and renders a card, rather
 * than dying at import time with a blank frame.
 */
export function renderFrameDocument(opts: FrameDocumentOptions): string {
  const imports = Object.fromEntries(
    IMPORT_MAP_ENTRIES.map(([specifier, file]) => [specifier, vendorUrl(opts, file)]),
  )
  const nonce = nonceAttr(opts.nonce)
  const head = `
<script type="importmap"${nonce}>${scriptLiteral({ imports })}</script>`
  const body = `<div id="root"></div>
<noscript>This Visvine Tool needs JavaScript to run.</noscript>
<script type="module"${nonce}>
import { bootTool } from '@visvine/tool-kit';
const parentOrigin = ${scriptLiteral(opts.appOrigin)};
window.${PARENT_ORIGIN_GLOBAL} = parentOrigin;
const bundleUrl = ${scriptLiteral(opts.bundleUrl)};
bootTool(() => import(bundleUrl), { parentOrigin });
</script>`
  return page({ nonce: opts.nonce, head, body })
}

/**
 * One line of an error card — a compile diagnostic, reduced to what a reader
 * needs. Structural on purpose: callers pass a `CompileDiagnostic` straight in.
 */
interface FrameErrorDetail {
  message: string
  line?: number | null
  column?: number | null
  text?: string | null
}

export interface FrameErrorOptions {
  title: string
  message: string
  details?: FrameErrorDetail[]
  nonce?: string
}

function detailItem(detail: FrameErrorDetail): string {
  const where =
    typeof detail.line === 'number'
      ? ` <code>line ${detail.line}${typeof detail.column === 'number' ? `:${detail.column}` : ''}</code>`
      : ''
  const source = detail.text ? `<br><code>${escapeHtml(detail.text.trim())}</code>` : ''
  return `<li>${escapeHtml(detail.message)}${where}${source}</li>`
}

/**
 * The in-pane failure surface: a bad frame link, a Tool that is gone, and —
 * the case this exists for — a working copy whose `ui.tsx` does not compile,
 * with the author's own diagnostics listed. Script-free, so it renders under
 * the same CSP with or without a nonce.
 */
export function renderFrameErrorDocument(opts: FrameErrorOptions): string {
  const details = opts.details?.length
    ? `\n<ol>${opts.details.map(detailItem).join('')}</ol>`
    : ''
  return page({
    nonce: opts.nonce,
    body: `<div class="vv-frame-error">
<h1>${escapeHtml(opts.title)}</h1>
<p>${escapeHtml(opts.message)}</p>${details}
</div>`,
  })
}
