/**
 * The Tool frame document (lib/tools/frameDocument.ts) — the HTML a sandboxed
 * Tool boots from.
 *
 * The document is the load-bearing half of the sandbox: if a URL in it points
 * anywhere but the origin serving it, `script-src 'self'` blocks it and the
 * Tool is dead; if a specifier is missing from the import map, the bundle
 * cannot resolve its bare imports. Both are asserted here rather than
 * discovered in a browser.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-frame-document.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderFrameDocument, renderFrameErrorDocument } from '@/lib/tools/frameDocument'
import { EXTERNALS } from '@/lib/tools/compile'
import { frameCsp } from '@/lib/tools/csp'
import { VENDOR_FILES } from '@/lib/tools/vendorBundle'
import { CURATED_DEPENDENCIES } from '@visvine/tool-protocol/dependencies'

const SELF = 'https://tools.visvine.com'
const APP = 'https://visvine.com'

const BASE = {
  selfOrigin: SELF,
  appOrigin: APP,
  bundleUrl: `${SELF}/api/tools/runtime/bundle/v_abc?token=t0ken`,
  vendorBase: `${SELF}/api/tools/runtime/vendor`,
  nonce: 'nonceNonceNonce12',
}

/** The `{ imports: … }` object out of the document's `<script type="importmap">`. */
function importMap(html: string): Record<string, string> {
  const m = /<script type="importmap"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  assert.ok(m, 'document has an import map')
  return (JSON.parse(m[1]) as { imports: Record<string, string> }).imports
}

/** Every absolute http(s) URL in the document, wherever it appears. */
function urlsIn(html: string): string[] {
  return html.match(/https?:\/\/[^"'\s<>]+/g) ?? []
}

// ── the import map ──

test('the import map names every specifier a Tool may import, pointed at vendorBase', () => {
  const imports = importMap(renderFrameDocument(BASE))
  assert.deepEqual(Object.keys(imports).sort(), [
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    '@dnd-kit/utilities',
    '@tanstack/react-table',
    '@visvine/tool-kit',
    'clsx',
    'date-fns',
    'fuse.js',
    'lucide-react',
    'motion/react',
    'nanoid',
    'papaparse',
    'react',
    'react-dom',
    'react-dom/client',
    'react-hook-form',
    'react/jsx-runtime',
    'zod',
  ])
  for (const url of Object.values(imports)) {
    assert.ok(url.startsWith(`${BASE.vendorBase}/`), `${url} is under vendorBase`)
  }
  // Every mapped file must be one the vendor route can actually build.
  for (const url of Object.values(imports)) {
    const file = url.slice(BASE.vendorBase.length + 1).split('?')[0]
    assert.ok((VENDOR_FILES as readonly string[]).includes(file), `${file} is a vendor file`)
  }
})

test('every external the compiler allows has an import-map entry, and vice versa', () => {
  const imports = importMap(renderFrameDocument(BASE))
  // The two lists must agree exactly: an external without a map entry compiles
  // clean and then fails to resolve in the browser,
  // and a map entry without an external is dead weight nobody can import.
  for (const specifier of EXTERNALS) {
    assert.ok(specifier in imports, `${specifier} is in the import map`)
  }
  // …and the curated dependencies, which a Tool imports once its manifest declares them.
  assert.deepEqual(Object.keys(imports).sort(), [...EXTERNALS, ...Object.keys(CURATED_DEPENDENCIES)].sort())
  assert.ok('react-dom' in imports)
})

test('vendor versions become ?v= cache busters, and are optional', () => {
  const versioned = importMap(
    renderFrameDocument({ ...BASE, vendorVersions: { 'react.js': 'abc123', 'tool-kit.js': 'def456' } }),
  )
  assert.equal(versioned.react, `${BASE.vendorBase}/react.js?v=abc123`)
  assert.equal(versioned['@visvine/tool-kit'], `${BASE.vendorBase}/tool-kit.js?v=def456`)
  // Unversioned entries still resolve — the frame keeps working, it just
  // cannot be cached for a year.
  assert.equal(versioned['react/jsx-runtime'], `${BASE.vendorBase}/react-jsx-runtime.js`)
})

// ── the sandbox invariants ──

test('nothing is loaded from an origin other than selfOrigin', () => {
  const html = renderFrameDocument(BASE)
  const urls = urlsIn(html)
  assert.ok(urls.length > 0)
  for (const url of urls) {
    const allowed = url.startsWith(`${SELF}/`) || url === APP
    assert.ok(allowed, `${url} is selfOrigin or the parent origin string`)
  }
  // The app origin appears once, as the postMessage peer — never as a src,
  // href or import specifier.
  assert.equal(html.split(APP).length - 1, 1)
  assert.match(html, new RegExp(`parentOrigin = "${APP}"`))
})

test('there are no inline event handlers and no non-module scripts', () => {
  const html = renderFrameDocument(BASE)
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no on*= attributes')
  const scripts = html.match(/<script[^>]*>/g) ?? []
  assert.equal(scripts.length, 2)
  assert.ok(scripts.some((s) => s.includes('type="importmap"')))
  assert.ok(scripts.some((s) => s.includes('type="module"')))
})

test('the document carries the CSP nonce the caller put in the header', () => {
  const nonce = 'n0nceN0nceN0nce12'
  const html = renderFrameDocument({ ...BASE, nonce })
  const csp = frameCsp({ appOrigin: APP, selfOrigin: SELF, nonce })
  assert.match(csp, new RegExp(`script-src 'self' 'nonce-${nonce}'`))
  // Both inline scripts and the stylesheet must carry it, or the CSP kills them.
  assert.equal(html.split(`nonce="${nonce}"`).length - 1, 3)
})

test('a bundle URL containing </script is escaped, not closed early', () => {
  const html = renderFrameDocument({
    ...BASE,
    bundleUrl: `${SELF}/api/tools/runtime/bundle/x?token=a</script><script>alert(1)</script>`,
  })
  assert.ok(!html.includes('<script>alert(1)'), 'the injected tag is not live')
  assert.equal((html.match(/<script/g) ?? []).length, 2)
})

test('the frame boots the kit with the parent origin and the bundle as a thunk', () => {
  const html = renderFrameDocument(BASE)
  assert.match(html, /import \{ bootTool \} from '@visvine\/tool-kit';/)
  assert.match(html, /bootTool\(\(\) => import\(bundleUrl\), \{ parentOrigin \}\);/)
  assert.match(html, /<div id="root"><\/div>/)
  assert.match(html, /<noscript>/)
  assert.match(html, /<meta charset="utf-8">/)
  assert.match(html, /color-scheme/)
})

test('the parent-origin global matches the name the kit runtime reads', () => {
  // frameDocument.ts restates this rather than importing it — lib/ is
  // React-free by lint rule and runtime.ts imports React — so pin the two.
  const runtimeSource = readFileSync(join(process.cwd(), 'features/tools/kit/runtime.ts'), 'utf8')
  const declared = /PARENT_ORIGIN_GLOBAL = '([^']+)'/.exec(runtimeSource)
  assert.ok(declared, 'runtime.ts declares PARENT_ORIGIN_GLOBAL')
  assert.match(renderFrameDocument(BASE), new RegExp(`window\\.${declared[1]} = parentOrigin;`))
})

// ── the error card ──

test('the error card is script-free and lists compile diagnostics', () => {
  const html = renderFrameErrorDocument({
    title: 'This Tool did not compile',
    message: 'Fix the problems below and save again.',
    details: [
      { message: 'Expected ">" but found "<"', line: 12, column: 4, text: '  return <div<' },
      { message: 'ui.tsx must have a default export', line: null, column: null, text: null },
    ],
  })
  assert.ok(!html.includes('<script'), 'no scripts at all')
  assert.match(html, /This Tool did not compile/)
  assert.match(html, /line 12:4/)
  assert.match(html, /return &lt;div&lt;/)
  assert.match(html, /ui.tsx must have a default export/)
})

test('the error card escapes a diagnostic that contains markup', () => {
  const html = renderFrameErrorDocument({
    title: '<img src=x onerror=alert(1)>',
    message: 'plain',
    details: [{ message: '</p><script>alert(2)</script>' }],
  })
  assert.ok(!html.includes('<img'))
  assert.ok(!html.includes('<script'))
  // Escaped, not dropped: the author still needs to read their own message.
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /&lt;\/p&gt;&lt;script&gt;alert\(2\)/)
})
