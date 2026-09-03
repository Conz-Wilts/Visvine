// The MCP authoring loop (lib/mcp/appTools.ts), exercised through its handlers
// with a faked service seam — no database, no server, no transport.
//
// Two things are worth testing here and nowhere else. The first is the WRITE →
// DIAGNOSTICS round trip: `write_tool` exists to hand an authoring agent its
// compile errors in the same answer as the write, because that is the loop the
// whole feature is built around, and a response that said only "applied" would
// cost a round trip per typo. The second is the ADMIN REFUSALS on publish and
// install: those gates live in the registry, and the only thing this layer must
// get right is passing the refusal back with its status intact instead of
// flattening it into a 500 an agent can't read.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-mcp.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { ActionError, type ActionCaller } from '@/lib/actions/types'
import { appToolHandlers, type AppToolDeps } from '@/lib/actions/defs/apps'
import type { BuildSummary } from '@/lib/tools/builds'
import type { ToolConfig } from '@/lib/tools/config'
import { EMPTY_PERIMETER } from '@/lib/tools/perimeter'
import type { AuthoredToolDetail } from '@/lib/tools/service'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import type { Target } from '@/lib/actions/resolve'
import type { InstallSummary } from '@/lib/tools/installs'
import type { ToolVersionSummary } from '@/lib/tools/registry'

const SPACE = 'space_1'

const CTX: ActionCaller = {
  userId: 'user_1',
  name: 'Ada',
  email: 'ada@local.dev',
  scopes: ['tools:author', 'tools:install', 'context:read'],
}

const PRINCIPAL = {
  userId: 'user_1',
  email: 'ada@local.dev',
  name: 'Ada',
  spaceId: SPACE,
  spaceAdmin: false,
  access: { grants: [], restricted: [], locked: [] },
} as unknown as ContextPrincipal

const CONTEXT: Context = { spaceId: SPACE, ownerKey: 'shared' }

const TARGET: Target = { principal: PRINCIPAL, context: CONTEXT, resolved: null }

function config(over: Partial<ToolConfig> = {}): ToolConfig {
  return {
    name: 'board',
    title: 'Board',
    description: 'A board over deal notes',
    version: 0,
    surfaces: { rail: { label: 'Board', icon: 'kanban' }, types: [] },
    perimeter: { ...EMPTY_PERIMETER, read: ['deals/**'], write: ['deals/**'] },
    tags: [],
    previewUrl: null,
    ...over,
  }
}

function build(over: Partial<BuildSummary> = {}): BuildSummary {
  return {
    ok: true,
    errors: [],
    warnings: [],
    sizeBytes: 412,
    config: config(),
    configError: null,
    updatedAt: '2026-08-18T00:00:00.000Z',
    iconSvg: null,
    ...over,
  }
}

/** A build that failed the way a typo in ui.tsx fails. */
function brokenBuild(): BuildSummary {
  return build({
    ok: false,
    sizeBytes: 0,
    errors: [{ file: 'ui.tsx', line: 12, column: 5, message: 'Expected "}" but found "<"', text: null }],
    warnings: [{ file: 'data.js', line: null, column: null, message: 'unused handler', text: null }],
  })
}

function detail(over: Partial<AuthoredToolDetail> = {}): AuthoredToolDetail {
  return {
    name: 'board',
    path: 'tools/board/index.md',
    nodeId: 'tool:board',
    title: 'Board',
    description: 'A board over deal notes',
    version: 0,
    invalid: null,
    createdBy: 'user_1',
    build: build(),
    publication: null,
    config: config(),
    sources: {
      'index.md': '---\ntype: tool\n---\n\n# Board\n',
      'ui.tsx': 'export default function App() { return <p>hi</p> }',
      'data.js': 'handlers.hello = async () => ({ ok: true })',
      'icon.svg': null,
    },
    ...over,
  }
}

function install(over: Partial<InstallSummary> = {}): InstallSummary {
  return {
    id: 'inst_1',
    key: `${SPACE}/board`,
    slug: 'board',
    title: 'Board',
    description: 'A board over deal notes',
    version: 3,
    enabled: true,
    requirements: { connectors: ['hubspot'], types: [], agents: [] },
    degraded: true,
    typeClaims: { deal: 'tab' },
    rail: { label: 'Board', icon: 'kanban' },
    types: [{ type: 'deal', mode: 'tab' }],
    pendingVersion: null,
    ...over,
  }
}

function version(over: Partial<ToolVersionSummary> = {}): ToolVersionSummary {
  return {
    id: 'ver_1',
    iconSvg: null,
    key: `${SPACE}/board`,
    name: 'board',
    version: 3,
    title: 'Board',
    description: 'A board over deal notes',
    status: 'pending',
    submittedAt: '2026-08-18T00:00:00.000Z',
    reviewedAt: null,
    reviewNote: null,
    marketplaceStatus: null,
    marketplaceSubmittedAt: null,
    marketplaceReviewedAt: null,
    marketplaceReviewNote: null,
    sizeBytes: 412,
    sourceSpaceId: SPACE,
    author: { userId: 'user_1', name: 'Ada' },
    perimeter: { ...EMPTY_PERIMETER, read: ['deals/**'] },
    surfaces: { rail: { label: 'Board', icon: 'kanban' }, types: [] },
    releaseNotes: null,
    tags: [],
    previewUrl: null,
    ...over,
  }
}

/**
 * A seam where every method fails loudly. Each test opts into exactly the calls
 * it expects, so a handler that reaches for something extra shows up as a test
 * failure rather than as a silent `undefined`.
 */
function deps(over: Partial<AppToolDeps> = {}): AppToolDeps {
  const unexpected = (name: string) => () => {
    throw new Error(`deps.${name} was not stubbed for this test`)
  }
  return {
    resolveTarget: async () => TARGET,
    featureAccessForbidden: async () => false,
    listAuthoredTools: unexpected('listAuthoredTools'),
    describeAuthoredTool: unexpected('describeAuthoredTool'),
    createTool: unexpected('createTool'),
    writeToolFile: unexpected('writeToolFile'),
    rebuild: unexpected('rebuild'),
    publishTool: unexpected('publishTool'),
    installVersion: unexpected('installVersion'),
    listInstalls: unexpected('listInstalls'),
    latestApprovedVersion: unexpected('latestApprovedVersion'),
    spaceFacts: unexpected('spaceFacts'),
    appOrigin: () => 'https://visvine.test',
    capturePreview: unexpected('capturePreview'),
    ...over,
  } as AppToolDeps
}

/** Assert a handler refuses with a given status, and hand back the error. */
async function refusal(run: Promise<unknown>, status: number): Promise<ActionError> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  )
  assert.ok(err instanceof ActionError, `expected an ActionError, got ${String(err)}`)
  assert.equal(err.status, status)
  return err
}

// ── create ────────────────────────────────────────────────────────────────────

test('create_tool returns the three files, both preview links and the SDK pointer', async () => {
  const seen: unknown[] = []
  const result = await appToolHandlers.createTool(
    CTX,
    { space_id: SPACE, name: 'board', title: 'Board', description: 'A board over deal notes' },
    deps({
      createTool: async (p, context, input) => {
        seen.push([p.userId, context.spaceId, input])
        return { ok: true, name: 'board', build: build() }
      },
    }),
  )

  assert.deepEqual(result.files, [
    'tools/board/index.md',
    'tools/board/ui.tsx',
    'tools/board/data.js',
  ])
  // Both forms, always: the desktop app opens the deep link in place, anything
  // else needs the URL.
  assert.equal(result.desktop_deep_link, 'visvine-desktop://open/tools/preview/board')
  assert.equal(result.preview_url, 'https://visvine.test/tools/preview/board')
  assert.equal(result.build.ok, true)
  assert.ok(
    result.next.some((line) => line.includes('get_tool_sdk')),
    'a new tool must point the agent at the SDK',
  )
  // The principal and context come from resolveTarget, never from the args.
  assert.deepEqual(seen, [
    ['user_1', SPACE, { name: 'board', title: 'Board', description: 'A board over deal notes' }],
  ])
})

test('create_tool passes a service refusal back with its status', async () => {
  const err = await refusal(
    appToolHandlers.createTool(
      CTX,
      { space_id: SPACE, name: 'board', title: 'Board', description: 'x' },
      deps({
        createTool: async () => ({ ok: false, status: 409, error: 'A tool named "board" already exists.' }),
      }),
    ),
    409,
  )
  assert.match(err.message, /already exists/)
})

// ── the write → diagnostics round trip ───────────────────────────────────────

test('write_tool answers a broken write with formatted diagnostics, not just a status', async () => {
  const written: unknown[] = []
  const result = await appToolHandlers.writeTool(
    CTX,
    { space_id: SPACE, name: 'board', file: 'ui.tsx', content: 'export default () => <p>' },
    deps({
      writeToolFile: async (_p, _c, name, file, content) => {
        written.push([name, file, content])
        return { ok: true, path: 'tools/board/ui.md', build: brokenBuild() }
      },
    }),
  )

  assert.equal(result.status, 'applied')
  assert.equal(result.build.ok, false)
  // `file:line:column message` — the form an agent can act on without unpacking
  // a structure.
  assert.deepEqual(result.build.errors, ['ui.tsx:12:5 Expected "}" but found "<"'])
  assert.deepEqual(result.build.warnings, ['data.js unused handler'])
  assert.ok(result.fix, 'a failing build must say what to do next')
  // The write still happened — the note is saved, the code just does not run.
  assert.deepEqual(written, [['board', 'ui.tsx', 'export default () => <p>']])
})

test('write_tool on a clean build reports ok and offers no fix', async () => {
  const result = await appToolHandlers.writeTool(
    CTX,
    { space_id: SPACE, name: 'board', file: 'ui.tsx', content: 'export default () => null' },
    deps({
      writeToolFile: async () => ({ ok: true, path: 'tools/board/ui.md', build: build() }),
    }),
  )
  assert.equal(result.build.ok, true)
  assert.deepEqual(result.build.errors, [])
  assert.equal('fix' in result, false)
})

test('write_tool surfaces a config error separately from compile errors', async () => {
  const result = await appToolHandlers.writeTool(
    CTX,
    { space_id: SPACE, name: 'board', file: 'index.md', content: '---\ntitle: Board\n---\n' },
    deps({
      writeToolFile: async () => ({
        ok: true,
        path: 'tools/board/index.md',
        build: build({ ok: false, config: null, configError: 'tool frontmatter must include `type: tool`' }),
      }),
    }),
  )
  // A broken index is a different fix from a syntax error, so it is a different
  // field rather than one more line in `errors`.
  assert.equal(result.build.config_error, 'tool frontmatter must include `type: tool`')
  assert.deepEqual(result.build.errors, [])
})

test('write_tool passes a note-gate denial back as a 403', async () => {
  const err = await refusal(
    appToolHandlers.writeTool(
      CTX,
      { space_id: SPACE, name: 'board', file: 'ui.tsx', content: 'x' },
      deps({
        writeToolFile: async () => ({
          ok: false,
          status: 403,
          error: 'You do not have write access to tools/board.',
        }),
      }),
    ),
    403,
  )
  assert.match(err.message, /write access/)
})

// ── read ─────────────────────────────────────────────────────────────────────

test('read_tool returns every file, or just the one asked for', async () => {
  const d = deps({ describeAuthoredTool: async () => detail() })

  const all = await appToolHandlers.readTool(CTX, { space_id: SPACE, name: 'board' }, d)
  assert.deepEqual(Object.keys(all.files).sort(), ['data.js', 'icon.svg', 'index.md', 'ui.tsx'])
  assert.equal(all.config?.title, 'Board')
  assert.equal(all.build.ok, true)

  const one = await appToolHandlers.readTool(
    CTX,
    { space_id: SPACE, name: 'board', file: 'ui.tsx' },
    d,
  )
  assert.deepEqual(Object.keys(one.files), ['ui.tsx'])
  // Unwrapped source, exactly what write_tool takes back.
  assert.equal(one.files['ui.tsx'], 'export default function App() { return <p>hi</p> }')
})

test('read_tool 404s a tool that is not there, and says how to find one', async () => {
  const err = await refusal(
    appToolHandlers.readTool(
      CTX,
      { space_id: SPACE, name: 'nope' },
      deps({ describeAuthoredTool: async () => null }),
    ),
    404,
  )
  assert.match(err.message, /list_tools/)
})

// ── check ────────────────────────────────────────────────────────────────────

test('check_tool rebuilds and reports perimeter, requirements, surfaces and warnings', async () => {
  const rebuilt: string[] = []
  const result = await appToolHandlers.checkTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({
      describeAuthoredTool: async () => detail(),
      rebuild: async (spaceId, name) => {
        rebuilt.push(`${spaceId}/${name}`)
        return build({
          config: config({
            perimeter: { ...EMPTY_PERIMETER, read: ['deals/**'], connectors: ['hubspot'] },
            surfaces: { rail: { label: 'Board', icon: 'kanban' }, types: [{ type: 'deal', mode: 'page' }] },
          }),
        })
      },
      spaceFacts: async () => ({
        available: { connectors: ['stripe'], types: ['person', 'deal'], agents: [] },
        // `deal` exists but is not member-invented here, so a page claim on it
        // will be downgraded at install time.
        customTypes: [],
      }),
    }),
  )

  assert.deepEqual(rebuilt, [`${SPACE}/board`])
  assert.ok(result.perimeter.some((line) => line.startsWith('Reads deals/**')))
  assert.ok(result.surfaces.some((line) => line.includes('Owns the page for node type "deal"')))
  // hubspot is declared and this space has no such connector — degraded, not refused.
  assert.equal(result.requirements.degraded_here, true)
  assert.deepEqual(result.requirements.missing, ['No connector in this space matches hubspot'])
  assert.ok(
    result.warnings.some((w) => w.includes('downgrade it to a tab')),
    `expected a page-claim warning, got ${JSON.stringify(result.warnings)}`,
  )
  assert.equal(result.ready_to_publish, false)
})

test('check_tool warns about an empty perimeter and a missing description', async () => {
  const result = await appToolHandlers.checkTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({
      describeAuthoredTool: async () => detail(),
      rebuild: async () =>
        build({ config: config({ description: '', perimeter: { ...EMPTY_PERIMETER } }) }),
      spaceFacts: async () => ({
        available: { connectors: [], types: [], agents: [] },
        customTypes: [],
      }),
    }),
  )
  assert.equal(result.warnings.length, 2)
  assert.ok(result.warnings.some((w) => w.includes('perimeter is empty')))
  assert.ok(result.warnings.some((w) => w.includes('`description:`')))
  assert.deepEqual(result.perimeter, [
    'Declares no reach — this tool reads and writes no space data',
  ])
})

test('check_tool says ready_to_publish only when it compiles and lints clean', async () => {
  const clean = await appToolHandlers.checkTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({
      describeAuthoredTool: async () => detail(),
      rebuild: async () => build(),
      spaceFacts: async () => ({
        available: { connectors: [], types: [], agents: [] },
        customTypes: [],
      }),
    }),
  )
  assert.equal(clean.ready_to_publish, true)

  const broken = await appToolHandlers.checkTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({
      describeAuthoredTool: async () => detail(),
      rebuild: async () => brokenBuild(),
      spaceFacts: async () => ({
        available: { connectors: [], types: [], agents: [] },
        customTypes: [],
      }),
    }),
  )
  assert.equal(broken.ready_to_publish, false)
  assert.deepEqual(broken.build.errors, ['ui.tsx:12:5 Expected "}" but found "<"'])
})

// ── list / preview / sdk ─────────────────────────────────────────────────────

test('list_tools reports authored builds and installed state side by side', async () => {
  const result = await appToolHandlers.listTools(
    CTX,
    { space_id: SPACE },
    deps({
      listAuthoredTools: async () => [
        {
          name: 'board',
          path: 'tools/board/index.md',
          nodeId: 'tool:board',
          title: 'Board',
          description: 'A board over deal notes',
          version: 0,
          invalid: null,
          createdBy: 'user_1',
          build: brokenBuild(),
          publication: null,
        },
      ],
      listInstalls: async () => [install()],
    }),
  )

  assert.equal(result.authored[0]?.build.ok, false)
  assert.deepEqual(result.authored[0]?.build.errors, ['ui.tsx:12:5 Expected "}" but found "<"'])
  assert.equal(result.installed[0]?.slug, 'board')
  assert.equal(result.installed[0]?.degraded, true)
  assert.deepEqual(result.installed[0]?.missing, ['No connector in this space matches hubspot'])
})

test('list_tools reports a tool that has never compiled rather than crashing on it', async () => {
  const result = await appToolHandlers.listTools(
    CTX,
    { space_id: SPACE },
    deps({
      listAuthoredTools: async () => [
        {
          name: 'fresh',
          path: 'tools/fresh/index.md',
          nodeId: 'tool:fresh',
          title: 'Fresh',
          description: '',
          version: 0,
          invalid: null,
          createdBy: 'user_1',
          build: null,
          publication: null,
        },
      ],
      listInstalls: async () => [],
    }),
  )
  assert.equal(result.authored[0]?.build.ok, false)
  assert.match(result.authored[0]?.build.errors[0] ?? '', /never been compiled/)
})

test('preview_tool hands back both links and refuses to pretend a broken tool renders', async () => {
  const ok = await appToolHandlers.previewTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({ describeAuthoredTool: async () => detail() }),
  )
  assert.equal(ok.desktop_deep_link, 'visvine-desktop://open/tools/preview/board')
  assert.equal(ok.preview_url, 'https://visvine.test/tools/preview/board')
  assert.match(ok.renders, /renders the working copy/)

  const broken = await appToolHandlers.previewTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({ describeAuthoredTool: async () => detail({ build: brokenBuild() }) }),
  )
  assert.match(broken.renders, /error card/)
})

test('get_tool_sdk returns the guide, the type definitions and the bridge methods', async () => {
  const sdk = await appToolHandlers.getToolSdk(CTX, {})
  assert.match(sdk.guide, /Building a Visvine Tool/)
  assert.match(sdk.tool_kit_dts, /declare module '@visvine\/tool-kit'/)
  assert.ok(sdk.bridge_methods.includes('context.read'))
  assert.ok(sdk.bridge_methods.includes('data.call'))
  assert.deepEqual(Object.keys(sdk.files).sort(), ['data.js', 'index.md', 'ui.tsx'])
})

// ── publish / install: the admin gates ───────────────────────────────────────

test('publish_tool refuses a non-admin with the registry\'s own 403', async () => {
  const err = await refusal(
    appToolHandlers.publishTool(
      CTX,
      { space_id: SPACE, name: 'board' },
      deps({
        publishTool: async () => ({
          ok: false,
          status: 403,
          error: 'Only space admins can publish a tool.',
        }),
      }),
    ),
    403,
  )
  assert.match(err.message, /Only space admins/)
})

test('publish_tool explains the review gate and passes the note through', async () => {
  const notes: unknown[] = []
  const result = await appToolHandlers.publishTool(
    CTX,
    { space_id: SPACE, name: 'board', note: 'Adds the archive column' },
    deps({
      publishTool: async (_p, _c, name, opts) => {
        notes.push([name, opts.note])
        return { ok: true, version: version(), warning: null }
      },
    }),
  )
  assert.deepEqual(notes, [['board', 'Adds the archive column']])
  assert.equal(result.status, 'pending')
  assert.equal(result.version, 3)
  // A member's publish waits on their own admins, and the answer has to say so
  // — an author told only "published" assumes it is live.
  assert.equal(result.scope, 'space')
  assert.match(result.published, /waiting on an admin of this space/)
  assert.match(result.published, /NOT on the marketplace/)
  // …and that publishing never lists anything is the sentence this whole
  // surface exists to make unmissable.
  assert.match(result.marketplace, /separate act/)
  assert.ok(result.preview_url.endsWith('/tools/preview/board'))
  assert.ok(result.perimeter.length > 0)
})

test('publish_tool carries the version-bump warning rather than hiding it', async () => {
  const result = await appToolHandlers.publishTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({
      publishTool: async () => ({
        ok: true,
        version: version(),
        warning: 'Published as version 3, but tools/board/index.md could not be updated.',
      }),
    }),
  )
  assert.match(result.warning ?? '', /could not be updated/)
})

test('install_tool refuses a non-admin', async () => {
  const err = await refusal(
    appToolHandlers.installTool(
      CTX,
      { space_id: SPACE, version_id: 'ver_1' },
      deps({
        installVersion: async () => ({
          ok: false,
          status: 403,
          error: 'Only a space admin can install a tool.',
        }),
      }),
    ),
    403,
  )
  assert.match(err.message, /admin/)
})

test('install_tool needs one of version_id or key', async () => {
  const err = await refusal(appToolHandlers.installTool(CTX, { space_id: SPACE }, deps()), 400)
  assert.match(err.message, /version_id or key/)
})

test('install_tool resolves a key to its newest approved version', async () => {
  const installed: unknown[] = []
  const result = await appToolHandlers.installTool(
    CTX,
    { space_id: SPACE, key: `${SPACE}/board` },
    deps({
      latestApprovedVersion: async (key) => (key === `${SPACE}/board` ? version({ id: 'ver_9', status: 'approved' }) : null),
      installVersion: async (spaceId, versionId, actor) => {
        installed.push([spaceId, versionId, actor])
        return { ok: true, install: install(), downgraded: ['deal'], conflicts: [] }
      },
    }),
  )
  assert.deepEqual(installed, [[SPACE, 'ver_9', { userId: 'user_1', email: 'ada@local.dev' }]])
  assert.equal(result.href, '/t/board')
  // Missing dependencies never block the install — they show as a checklist.
  assert.equal(result.requirements.degraded, true)
  assert.deepEqual(result.requirements.missing, ['No connector in this space matches hubspot'])
  assert.deepEqual(result.downgraded_to_tab, ['deal'])
})

test('install_tool 404s a key with nothing approved behind it', async () => {
  const err = await refusal(
    appToolHandlers.installTool(
      CTX,
      { space_id: SPACE, key: `${SPACE}/ghost` },
      deps({ latestApprovedVersion: async () => null }),
    ),
    404,
  )
  assert.match(err.message, /No approved version/)
})

test('install_tool names the install already holding a claimed type page', async () => {
  const result = await appToolHandlers.installTool(
    CTX,
    { space_id: SPACE, version_id: 'ver_1' },
    deps({
      installVersion: async () => ({
        ok: true,
        install: install(),
        downgraded: [],
        conflicts: [{ type: 'deal', heldBy: 'pipeline' }],
      }),
    }),
  )
  assert.deepEqual(result.conflicts, ['"deal" page is already owned by the pipeline tool'])
})

// ── the `tools` feature gate ─────────────────────────────────────────────────

test('every space-scoped handler refuses when the tools feature key is off, before touching the service', async () => {
  const forbidden = deps({ featureAccessForbidden: async () => true })
  const cases: Array<[string, () => Promise<unknown>]> = [
    [
      'create_tool',
      () =>
        appToolHandlers.createTool(
          CTX,
          { space_id: SPACE, name: 'board', title: 'Board', description: 'x' },
          forbidden,
        ),
    ],
    ['list_tools', () => appToolHandlers.listTools(CTX, { space_id: SPACE }, forbidden)],
    ['read_tool', () => appToolHandlers.readTool(CTX, { space_id: SPACE, name: 'board' }, forbidden)],
    [
      'write_tool',
      () =>
        appToolHandlers.writeTool(
          CTX,
          { space_id: SPACE, name: 'board', file: 'ui.tsx', content: 'x' },
          forbidden,
        ),
    ],
    ['check_tool', () => appToolHandlers.checkTool(CTX, { space_id: SPACE, name: 'board' }, forbidden)],
    ['preview_tool', () => appToolHandlers.previewTool(CTX, { space_id: SPACE, name: 'board' }, forbidden)],
    ['publish_tool', () => appToolHandlers.publishTool(CTX, { space_id: SPACE, name: 'board' }, forbidden)],
    [
      'install_tool',
      () => appToolHandlers.installTool(CTX, { space_id: SPACE, version_id: 'ver_1' }, forbidden),
    ],
  ]
  for (const [name, run] of cases) {
    const err = await refusal(run(), 403)
    assert.match(
      err.message,
      /The Tools feature is not available to you in this space/,
      `${name} did not refuse with the shared feature-gate message`,
    )
  }
})

// ── headless render (ticket 3.5) ─────────────────────────────────────────────

test('preview_tool renders only when asked, and passes the image and console errors through', async () => {
  const requests: unknown[] = []
  const rendered = await appToolHandlers.previewTool(
    CTX,
    { space_id: SPACE, name: 'board', screenshot: true },
    deps({
      describeAuthoredTool: async () => detail(),
      capturePreview: async (req) => {
        requests.push(req)
        return {
          available: true,
          image_base64: 'aGVsbG8=',
          mime: 'image/png',
          width: 1024,
          height: 768,
          rendered: true,
          console_errors: ['console.error: boom'],
        }
      },
    }),
  )
  // Rendered as the caller, in the target space, with the image on.
  assert.deepEqual(requests, [
    {
      appOrigin: 'https://visvine.test',
      spaceId: SPACE,
      name: 'board',
      viewer: { userId: 'user_1', name: 'Ada', email: 'ada@local.dev' },
      image: true,
      budgetMs: 10_000,
    },
  ])
  assert.equal(rendered.screenshot?.available, true)
  assert.equal(rendered.screenshot?.png_base64, 'aGVsbG8=')
  assert.equal(rendered.screenshot?.jpeg_base64, null)
  assert.deepEqual(rendered.screenshot?.console_errors, ['console.error: boom'])
  assert.equal(rendered.preview_url, 'https://visvine.test/tools/preview/board')

  // Without the flag no browser is touched (capturePreview is unstubbed and would throw).
  const plain = await appToolHandlers.previewTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({ describeAuthoredTool: async () => detail() }),
  )
  assert.equal('screenshot' in plain, false)
})

test('preview_tool says why a screenshot is unavailable and keeps the links', async () => {
  const result = await appToolHandlers.previewTool(
    CTX,
    { space_id: SPACE, name: 'board', screenshot: true },
    deps({
      describeAuthoredTool: async () => detail(),
      capturePreview: async () => ({ available: false, reason: 'Headless rendering is off in this deployment' }),
    }),
  )
  assert.equal(result.screenshot?.available, false)
  assert.match(result.screenshot?.reason ?? '', /off in this deployment/)
  assert.equal(result.desktop_deep_link, 'visvine-desktop://open/tools/preview/board')
})

test('check_tool { render } folds runtime console errors into the warnings, image-free', async () => {
  const requests: Array<{ image?: boolean }> = []
  const result = await appToolHandlers.checkTool(
    CTX,
    { space_id: SPACE, name: 'board', render: true },
    deps({
      describeAuthoredTool: async () => detail(),
      rebuild: async () => build(),
      spaceFacts: async () => ({ available: { connectors: [], types: [], agents: [] }, customTypes: [] }),
      capturePreview: async (req) => {
        requests.push(req)
        return {
          available: true,
          image_base64: null,
          mime: null,
          width: 1024,
          height: 768,
          rendered: false,
          console_errors: ['uncaught: TypeError: x is undefined'],
        }
      },
    }),
  )
  assert.equal(requests[0]?.image, false)
  assert.equal(result.runtime?.available, true)
  assert.equal(result.runtime?.rendered, false)
  assert.ok(result.warnings.some((w) => /Runtime: uncaught: TypeError/.test(w)))
  assert.ok(result.warnings.some((w) => /did not mount/.test(w)))
  assert.equal(result.ready_to_publish, false)

  // A broken build never launches a browser — there is nothing to render.
  const broken = await appToolHandlers.checkTool(
    CTX,
    { space_id: SPACE, name: 'board', render: true },
    deps({
      describeAuthoredTool: async () => detail(),
      rebuild: async () => brokenBuild(),
      spaceFacts: async () => ({ available: { connectors: [], types: [], agents: [] }, customTypes: [] }),
    }),
  )
  assert.equal('runtime' in broken, false)
})

// ── marketplace metadata + trusted publishers (tickets 4.1, 4.2) ─────────────

test('publish_tool passes release_notes through and echoes tags and notes back', async () => {
  const seen: unknown[] = []
  const result = await appToolHandlers.publishTool(
    CTX,
    { space_id: SPACE, name: 'board', release_notes: 'Adds the archive column' },
    deps({
      publishTool: async (_p, _c, name, opts) => {
        seen.push([name, opts])
        return {
          ok: true,
          version: version({ tags: ['crm', 'kanban'], releaseNotes: 'Adds the archive column' }),
          warning: null,
        }
      },
    }),
  )
  assert.deepEqual(seen, [['board', { note: undefined, releaseNotes: 'Adds the archive column' }]])
  assert.deepEqual(result.tags, ['crm', 'kanban'])
  assert.equal(result.release_notes, 'Adds the archive column')
})

test("publish_tool says an admin's publish is live here — and still not public", async () => {
  const result = await appToolHandlers.publishTool(
    CTX,
    { space_id: SPACE, name: 'board' },
    deps({
      publishTool: async () => ({
        ok: true,
        version: version({ status: 'approved', reviewNote: 'published by an admin' }),
        warning: null,
      }),
    }),
  )
  assert.equal(result.status, 'approved')
  assert.match(result.published, /APPROVED in this space/)
  // Approved in a space is still not public, and the wording may never blur it.
  assert.match(result.published, /NOT on the marketplace/)
})
