/**
 * The Tool compile pipeline: what an author may write, and what comes back when
 * they write something else.
 *
 * The refusals matter more than the happy path here — a Tool bundle is code the
 * server hands to a browser, so "only these imports" and "must export default"
 * are the two things the frame runtime is allowed to assume.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compileToolData,
  compileToolUi,
  sourceHash,
  EXTERNALS,
  TOOL_BUNDLE_LIMITS,
  type CompileDiagnostic,
  type CompileResult,
} from '@/lib/tools/compile'

/** Every diagnostic on a result, whichever arm it took — for failure messages. */
function messages(result: CompileResult): string {
  const list: CompileDiagnostic[] = result.ok ? result.warnings : result.errors
  return list.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n')
}

/** Diagnostics from a result the test expects to have failed. */
function errorsOf(result: CompileResult): CompileDiagnostic[] {
  assert.equal(result.ok, false, `expected the compile to fail\n${messages(result)}`)
  return result.ok ? [] : result.errors
}

/** The refused-because text, asserting the compile failed in the first place. */
function errorText(result: CompileResult): string {
  return errorsOf(result)
    .map((d) => d.message)
    .join('\n')
}

// ── ui.tsx ────────────────────────────────────────────────────────────────────

test('compiles a JSX component into an ESM bundle that imports react/jsx-runtime', async () => {
  const result = await compileToolUi(`
    export default function Board({ title }: { title: string }) {
      return <div className="board"><h1>{title}</h1></div>
    }
  `)

  assert.equal(result.ok, true, messages(result))
  if (!result.ok) return
  assert.match(result.bundle, /from "react\/jsx-runtime"/)
  assert.match(result.bundle, /as default/)
  assert.equal(result.sizeBytes, Buffer.byteLength(result.bundle, 'utf8'))
  assert.deepEqual(result.warnings, [])
})

test('leaves every allowed specifier a bare import for the frame import map', async () => {
  const result = await compileToolUi(`
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import { Card } from '@visvine/tool-kit'

    export default function App() {
      const [n, setN] = useState(0)
      void createRoot
      return <Card onClick={() => setN(n + 1)}>{n}</Card>
    }
  `)

  assert.equal(result.ok, true, messages(result))
  if (!result.ok) return
  for (const specifier of ['react', 'react-dom/client', '@visvine/tool-kit']) {
    assert.ok(
      result.bundle.includes(`from "${specifier}"`),
      `${specifier} should survive as a bare import`,
    )
    assert.ok(EXTERNALS.includes(specifier as (typeof EXTERNALS)[number]))
  }
})

test('refuses any other import, wherever it points', async () => {
  const cases = [
    { label: 'bare package', source: `import _ from 'lodash'\nexport default () => <b>{_.now()}</b>` },
    { label: 'relative path', source: `import { x } from './x'\nexport default () => <b>{x}</b>` },
    { label: 'server path', source: `import fs from 'node:fs'\nexport default () => <b>{String(fs)}</b>` },
    { label: 'url', source: `import { x } from 'https://evil.example/x.js'\nexport default () => <b>{x}</b>` },
    { label: 'side-effect only', source: `import 'lodash'\nexport default () => null` },
    { label: 'dynamic', source: `export default () => { void import('lodash'); return null }` },
    { label: 'unused, so tree-shaken', source: `import _ from 'lodash'\nexport default () => null` },
  ]

  for (const { label, source } of cases) {
    const result = await compileToolUi(source)
    const text = errorText(result)
    assert.match(
      text,
      /Only react, react\/jsx-runtime, react-dom\/client and @visvine\/tool-kit may be imported/,
      `${label} should be refused with the import rule`,
    )
  }
})

test('names all four allowed specifiers in the refusal', async () => {
  const result = await compileToolUi(`import _ from 'lodash'\nexport default () => null`)
  const text = errorText(result)
  for (const specifier of EXTERNALS) {
    assert.ok(
      text.includes(specifier),
      `refusal should name ${specifier}: ${text}`,
    )
  }
})

test('refuses a dynamic import whose specifier is not a literal, even though it compiles clean otherwise', async () => {
  const result = await compileToolUi(
    `const p = 'https://evil.example/x.js'\nexport default function App() {\n  import(p)\n  return null\n}\n`,
  )

  assert.equal(result.ok, false, 'a non-literal dynamic import must not compile clean')
  const text = errorText(result)
  assert.match(text, /Cannot import a non-literal value/)
  assert.match(
    text,
    /Only react, react\/jsx-runtime, react-dom\/client and @visvine\/tool-kit may be imported/,
  )
})

test('catches a non-literal dynamic import even when it is buried in a template splice', async () => {
  const result = await compileToolUi(
    'export default function App() {\n  const x = `${(() => { import(location.href); return 1 })()}`\n  return x\n}\n',
  )

  assert.equal(result.ok, false, 'a dynamic import inside a `${}` splice must still be caught')
  assert.match(errorText(result), /Cannot import a non-literal value/)
})

test('does not mistake the text "import(" inside a string or comment for a real call', async () => {
  const result = await compileToolUi(
    "// import(danger)\nconst s = 'import(evil)'\nexport default () => <b>{s}</b>",
  )

  assert.equal(result.ok, true, messages(result))
})

test('still compiles a legitimate static @visvine/tool-kit import', async () => {
  const result = await compileToolUi(
    `import { Card } from '@visvine/tool-kit'\nexport default () => <Card />`,
  )

  assert.equal(result.ok, true, messages(result))
  if (!result.ok) return
  assert.match(result.bundle, /from "@visvine\/tool-kit"/)
})

test('reports line and column for a syntax error', async () => {
  const result = await compileToolUi(`export default function App() {\n  return <div>\n}\n`)

  const [first] = errorsOf(result)
  assert.ok(first, 'expected a diagnostic')
  assert.equal(first.line, 3)
  assert.equal(first.column, 0)
  assert.equal(first.text, '}')
  assert.ok(first.message.length > 0)
})

test('requires a default export, since the runtime mounts it', async () => {
  const named = await compileToolUi(`export const Board = () => <div />`)
  assert.match(errorText(named), /must have a default export/)

  const aliased = await compileToolUi(`function Board() { return <div /> }\nexport { Board as default }`)
  assert.equal(aliased.ok, true, messages(aliased))
})

test('caps the source, before esbuild ever sees it', async () => {
  const filler = `// ${'x'.repeat(200)}\n`
  const source = `export default () => null\n${filler.repeat(3_000)}`
  assert.ok(Buffer.byteLength(source, 'utf8') > TOOL_BUNDLE_LIMITS.maxSourceBytes)

  const result = await compileToolUi(source)
  assert.match(errorText(result), /ui\.tsx is \d+ bytes, over the 512000 byte source limit/)
})

test('caps the bundle, which JSX can inflate past a legal source', async () => {
  // Every `<a/>` compiles to a jsx() call with a purity annotation, so a source
  // well inside the source cap still bundles past the bundle cap.
  const source = `export default () => [${'<a/>,'.repeat(40_000)}]`
  assert.ok(Buffer.byteLength(source, 'utf8') < TOOL_BUNDLE_LIMITS.maxSourceBytes)

  const result = await compileToolUi(source)
  assert.match(errorText(result), /The compiled bundle is \d+ bytes, over the 1000000 byte limit/)
})

test('names the file it was given in diagnostics', async () => {
  const result = await compileToolUi(`export default () => <div>`, { filename: 'tools/deals/ui.tsx' })
  const [first] = errorsOf(result)
  assert.ok(first)
  assert.equal(first.line, 1)
})

// ── data.js ───────────────────────────────────────────────────────────────────

test('lowers data.js to es2020 and hands back a plain script', async () => {
  const result = await compileToolData(
    `handlers.list = async (args, ctx) => {\n  let limit = args?.limit\n  limit ||= 25\n  return ctx.context.read({ limit })\n}\n`,
  )

  assert.equal(result.ok, true, messages(result))
  if (!result.ok) return
  assert.match(result.bundle, /handlers\.list = async \(args, ctx\)/)
  // es2020 has no logical assignment, so `||=` must have been lowered.
  assert.ok(!result.bundle.includes('||='), result.bundle)
  // No module wrapper: the isolate evaluates this as a script, not a module.
  assert.ok(!result.bundle.includes('__commonJS'), result.bundle)
  assert.equal(result.sizeBytes, Buffer.byteLength(result.bundle, 'utf8'))
})

test('leaves an exports.<name> assignment exactly where the author put it', async () => {
  const result = await compileToolData(`exports.list = async () => [1, 2, 3]\n`)

  assert.equal(result.ok, true, messages(result))
  if (!result.ok) return
  assert.match(result.bundle, /^exports\.list = async \(\) => \[1, 2, 3\];/)
})

test('refuses module syntax in data.js, and says what to write instead', async () => {
  const cases = [
    `const x = 1\nimport { z } from 'lodash'\nhandlers.a = () => z(x)`,
    `export const handlers = { a: async () => 1 }`,
    `handlers.a = async () => 1\nexport default handlers`,
    `export * from './other'`,
  ]

  for (const source of cases) {
    const result = await compileToolData(source)
    assert.match(errorText(result), /has no module loader/, source)
    assert.match(errorText(result), /handlers\.<name> = async \(args, ctx\)/, source)
  }
})

test('points the module-syntax refusal at the offending line', async () => {
  const [first] = errorsOf(await compileToolData(`handlers.a = () => 1\n  import 'lodash'\n`))
  assert.ok(first)
  assert.equal(first.line, 2)
  assert.equal(first.column, 2)
  assert.equal(first.text, `  import 'lodash'`)
})

test('reports a data.js parse error with its position', async () => {
  const [first] = errorsOf(await compileToolData(`handlers.a = async () => {\n  return (\n`))
  assert.ok(first)
  assert.equal(first.line, 3)
  assert.ok(first.message.length > 0)
})

test('caps the data.js source too', async () => {
  const result = await compileToolData(`// ${'x'.repeat(TOOL_BUNDLE_LIMITS.maxSourceBytes)}`)
  assert.match(errorText(result), /data\.js is \d+ bytes, over the 512000 byte source limit/)
})

// ── build identity ────────────────────────────────────────────────────────────

test('sourceHash is a stable sha256 over the parts, boundaries included', () => {
  const hash = sourceHash(['a', 'b'])
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(hash, sourceHash(['a', 'b']))
  assert.notEqual(hash, sourceHash(['b', 'a']))
  // The separator is what keeps a moved boundary from hashing the same.
  assert.notEqual(hash, sourceHash(['ab']))
})

test('refuses a bare react-dom import — the import map has no entry for it, so it would fail at runtime', async () => {
  // Pins the fix for the import-map bug: react-dom used to be allowed at
  // compile time but absent from IMPORT_MAP_ENTRIES, so the Tool built clean
  // and then failed to resolve in the browser. Now the compiler refuses it and
  // names the fix.
  assert.ok(!(EXTERNALS as readonly string[]).includes('react-dom'))
  const result = await compileToolUi(
    `import { render } from 'react-dom'\nexport default function App() { return <b>{String(render)}</b> }`,
  )
  assert.equal(result.ok, false)
  const text = errorText(result)
  assert.match(text, /Only react, react\/jsx-runtime, react-dom\/client and @visvine\/tool-kit may be imported/)
  assert.match(text, /use react-dom\/client, not react-dom/)
})
