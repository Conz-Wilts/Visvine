// Unit tests for the Tool build orchestration (lib/tools/builds.ts) and the
// author-facing diagnostics formatter (lib/tools/service.ts#writeErrorsToPlain).
//
// There is no DB here, so the read/compile/persist steps are injected: the
// point of these tests is the ORCHESTRATION — when a compile is skipped, what
// makes a build `ok`, and which diagnostics reach the author — not esbuild
// (tests/tools-compile.test.ts) or Prisma.
//
// Run: node --import tsx --test tests/tools-builds.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { AppToolBuild } from '@prisma/client'

import {
  buildIsCurrent,
  rebuildTool,
  toBuildSummary,
  toolDiagnosticLine,
  toolSourceHash,
  type BuildDiagnostic,
  type ToolBuildDeps,
  type ToolBuildInput,
  type ToolSources,
} from '../lib/tools/builds'
import type { CompileResult } from '../lib/tools/compile'
import { newToolIndexNote, wrapSource } from '../lib/tools/config'
import { writeErrorsToPlain } from '../lib/tools/service'

const SPACE = 'space_test'
const NAME = 'hello'

const UI_CODE = 'export default function App() { return <p>hi</p> }'
const DATA_CODE = "handlers.hello = async () => ({ greeting: 'hi' })"

function sources(over: Partial<ToolSources> = {}): ToolSources {
  return {
    index: newToolIndexNote({ name: NAME, title: 'Hello' }),
    ui: wrapSource(UI_CODE, 'tsx'),
    data: wrapSource(DATA_CODE, 'js'),
    icon: null,
    ...over,
  }
}

const okCompile: CompileResult = { ok: true, bundle: 'BUNDLE', sizeBytes: 6, warnings: [] }

function failCompile(message: string, line: number | null = null): CompileResult {
  return {
    ok: false,
    errors: [{ message, line, column: line === null ? null : 4, text: null }],
    warnings: [],
  }
}

/** A stored row, built from what a rebuild asked to save. */
function rowOf(input: ToolBuildInput): AppToolBuild {
  return {
    id: `build_${input.name}`,
    spaceId: input.spaceId,
    name: input.name,
    sourceHash: input.sourceHash,
    ok: input.ok,
    uiBundle: input.uiBundle,
    dataBundle: input.dataBundle,
    errors: input.errors as unknown as AppToolBuild['errors'],
    warnings: input.warnings as unknown as AppToolBuild['warnings'],
    sizeBytes: input.sizeBytes,
    config: (input.config ?? null) as unknown as AppToolBuild['config'],
    configError: input.configError,
    iconSvg: input.iconSvg,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
  }
}

interface Harness {
  deps: ToolBuildDeps
  /** How many times each compiler ran — the skip assertions read these. */
  calls: { ui: number; data: number; saves: number }
  stored: AppToolBuild | null
}

function harness(
  input: ToolSources,
  opts: { ui?: CompileResult; data?: CompileResult; stored?: AppToolBuild | null } = {},
): Harness {
  const state: Harness = {
    calls: { ui: 0, data: 0, saves: 0 },
    stored: opts.stored ?? null,
    deps: {
      async readSource(_spaceId, path) {
        if (path.endsWith('/index.md')) return input.index
        if (path.endsWith('/ui.md')) return input.ui
        if (path.endsWith('/data.md')) return input.data
        return null
      },
      async compileUi() {
        state.calls.ui++
        return opts.ui ?? okCompile
      },
      async compileData() {
        state.calls.data++
        return opts.data ?? okCompile
      },
      async loadBuild() {
        return state.stored
      },
      async saveBuild(saved) {
        state.calls.saves++
        state.stored = rowOf(saved)
        return state.stored
      },
    },
  }
  return state
}

// ── source identity ───────────────────────────────────────────────────────────

test('toolSourceHash changes with any source, and tells absent from empty', () => {
  const base = sources()
  assert.equal(toolSourceHash(base), toolSourceHash(sources()))
  assert.notEqual(toolSourceHash(base), toolSourceHash(sources({ ui: wrapSource('export default 1', 'tsx') })))
  assert.notEqual(toolSourceHash(base), toolSourceHash(sources({ data: null })))
  // A deleted data.js and a blanked one are different acts.
  assert.notEqual(toolSourceHash(sources({ data: null })), toolSourceHash(sources({ data: '' })))
  // Adding an icon is a change like any other source edit.
  assert.notEqual(toolSourceHash(base), toolSourceHash(sources({ icon: wrapSource('<svg />', 'svg') })))
  // The slots are distinct: moving content between them is a change.
  assert.notEqual(
    toolSourceHash({ index: 'a', ui: 'b', data: null, icon: null }),
    toolSourceHash({ index: 'a', ui: null, data: 'b', icon: null }),
  )
})

test('buildIsCurrent is false without a row and true only on a matching hash', () => {
  assert.equal(buildIsCurrent(null, 'abc'), false)
  assert.equal(buildIsCurrent({ sourceHash: 'abc' }, 'abc'), true)
  assert.equal(buildIsCurrent({ sourceHash: 'abc' }, 'def'), false)
})

// ── the rebuild ───────────────────────────────────────────────────────────────

test('a first build compiles both sources and stores an ok row', async () => {
  const h = harness(sources())
  const row = await rebuildTool(SPACE, NAME, h.deps)

  assert.equal(h.calls.ui, 1)
  assert.equal(h.calls.data, 1)
  assert.equal(row.ok, true)
  assert.equal(row.uiBundle, 'BUNDLE')
  assert.equal(row.dataBundle, 'BUNDLE')
  assert.equal(row.sizeBytes, 12) // both bundles
  assert.equal(row.configError, null)
  const summary = toBuildSummary(row)
  assert.equal(summary.config?.title, 'Hello')
  assert.deepEqual(summary.errors, [])
})

test('an unchanged hash skips the compile entirely and returns the stored row', async () => {
  const input = sources()
  const first = harness(input)
  const built = await rebuildTool(SPACE, NAME, first.deps)

  const second = harness(input, { stored: built })
  const again = await rebuildTool(SPACE, NAME, second.deps)

  assert.equal(second.calls.ui, 0)
  assert.equal(second.calls.data, 0)
  assert.equal(second.calls.saves, 0)
  assert.equal(again, built)
})

test('a changed source recompiles even though a row exists', async () => {
  const first = harness(sources())
  const built = await rebuildTool(SPACE, NAME, first.deps)

  const second = harness(sources({ ui: wrapSource('export default () => null', 'tsx') }), {
    stored: built,
  })
  const again = await rebuildTool(SPACE, NAME, second.deps)

  assert.equal(second.calls.ui, 1)
  assert.equal(second.calls.saves, 1)
  assert.notEqual(again.sourceHash, built.sourceHash)
})

test('data.js is optional — a tool without one still builds ok', async () => {
  const h = harness(sources({ data: null }))
  const row = await rebuildTool(SPACE, NAME, h.deps)

  assert.equal(h.calls.data, 0)
  assert.equal(row.ok, true)
  assert.equal(row.dataBundle, null)
  assert.equal(row.sizeBytes, 6)
})

test('a data.js that fails to compile takes the whole build down', async () => {
  const h = harness(sources(), { data: failCompile('Unexpected end of file', 3) })
  const row = await rebuildTool(SPACE, NAME, h.deps)

  assert.equal(row.ok, false)
  // A failed build stores no bundle at all — half a tool must not be servable.
  assert.equal(row.uiBundle, null)
  assert.equal(row.dataBundle, null)
  const errors = toBuildSummary(row).errors
  assert.equal(errors.length, 1)
  assert.equal(errors[0].file, 'data.js')
  assert.equal(errors[0].line, 3)
})

test('a broken config records configError and refuses to be ok', async () => {
  const h = harness(sources({ index: '---\ntitle: Hello\n---\n\nnot a tool\n' }))
  const row = await rebuildTool(SPACE, NAME, h.deps)

  assert.equal(row.ok, false)
  assert.match(row.configError ?? '', /type: tool/)
  assert.equal(toBuildSummary(row).config, null)
  // The sources still compiled — the author only has the one thing to fix.
  assert.equal(h.calls.ui, 1)
})

test('a missing index note is reported rather than thrown', async () => {
  const h = harness(sources({ index: null }))
  const row = await rebuildTool(SPACE, NAME, h.deps)

  assert.equal(row.ok, false)
  assert.match(row.configError ?? '', /tools\/hello\/index\.md/)
})

test('a missing ui.tsx is an error, not a silent pass', async () => {
  const h = harness(sources({ ui: null }))
  const row = await rebuildTool(SPACE, NAME, h.deps)

  assert.equal(h.calls.ui, 0)
  assert.equal(row.ok, false)
  const errors = toBuildSummary(row).errors
  assert.equal(errors[0].file, 'ui.tsx')
  assert.match(errors[0].message, /missing/)
})

test('a source note that is not a wrapped source is refused before compiling', async () => {
  const h = harness(sources({ ui: '# just some markdown\n' }))
  const row = await rebuildTool(SPACE, NAME, h.deps)

  assert.equal(h.calls.ui, 0)
  assert.equal(row.ok, false)
  assert.match(toBuildSummary(row).errors[0].message, /fenced code block/)
})

test('compile warnings ride along without failing the build', async () => {
  const h = harness(sources(), {
    ui: { ok: true, bundle: 'BUNDLE', sizeBytes: 6, warnings: [{ message: 'unused', line: 2, column: 0, text: null }] },
  })
  const row = await rebuildTool(SPACE, NAME, h.deps)

  assert.equal(row.ok, true)
  const summary = toBuildSummary(row)
  assert.equal(summary.warnings.length, 1)
  assert.equal(summary.warnings[0].file, 'ui.tsx')
})

// ── diagnostics for the author ────────────────────────────────────────────────

test('toolDiagnosticLine reads like an editor jump target', () => {
  const located: BuildDiagnostic = { file: 'ui.tsx', message: 'Expected ">"', line: 12, column: 5, text: null }
  assert.equal(toolDiagnosticLine(located), 'ui.tsx:12:5 Expected ">"')

  const locationless: BuildDiagnostic = { file: 'ui.tsx', message: 'over the limit', line: null, column: null, text: null }
  assert.equal(toolDiagnosticLine(locationless), 'ui.tsx over the limit')

  const noColumn: BuildDiagnostic = { file: 'data.js', message: 'bad', line: 3, column: null, text: null }
  assert.equal(toolDiagnosticLine(noColumn), 'data.js:3:0 bad')
})

test('writeErrorsToPlain lists the config error first, then errors, then warnings', () => {
  const plain = writeErrorsToPlain({
    ok: false,
    configError: 'tool frontmatter must include `type: tool`',
    errors: [{ file: 'ui.tsx', message: 'Expected ">"', line: 12, column: 5, text: null }],
    warnings: [{ file: 'data.js', message: 'unreachable code', line: 4, column: 2, text: null }],
    sizeBytes: 0,
    config: null,
    iconSvg: null,
    updatedAt: '2026-08-18T00:00:00.000Z',
  })
  assert.deepEqual(plain.split('\n'), [
    'index.md tool frontmatter must include `type: tool`',
    'ui.tsx:12:5 Expected ">"',
    'warning: data.js:4:2 unreachable code',
  ])
})

test('writeErrorsToPlain is empty for a clean build', () => {
  assert.equal(
    writeErrorsToPlain({
      ok: true,
      configError: null,
      errors: [],
      warnings: [],
      sizeBytes: 120,
      config: null,
      iconSvg: null,
      updatedAt: '2026-08-18T00:00:00.000Z',
    }),
    '',
  )
})
