/**
 * The kit's batteries (charts, DataTable, DatePicker, Markdown, Kanban, live
 * and paged hooks): that they ship in `tool-kit.js`, that the bundle stays
 * inside its budget, and that the documented `.d.ts` names every export the
 * kit actually has — the SDK an authoring agent reads must not drift from the
 * module a Tool imports.
 *
 * Builds the vendor bundle with esbuild, so it takes a few seconds.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-kit-batteries.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVendorFiles, VENDOR_FILES } from '@/lib/tools/vendorBundle'
import { EXTERNALS } from '@/lib/tools/compile'
import { TOOL_AUTHOR_GUIDE, TOOL_KIT_DTS } from '@/lib/tools/sdkDocs'
import { STATE_MAX_BYTES } from '@/lib/tools/state'
import { LIVE_QUERY_POLL_MS } from '@/features/tools/kit/hooks'

/**
 * The budget for `tool-kit.js`, minified. Measured at ~775 KB with recharts,
 * react-markdown (+ remark-gfm, rehype-sanitize) and the kit itself; the
 * budget leaves room for growth without letting a stray dependency double it.
 */
const KIT_BUNDLE_BUDGET_BYTES = 1_500_000

/** Every value export a Tool may import from `@visvine/tool-kit`. */
const KIT_VALUE_EXPORTS = [
  // hooks
  'VisvineProvider',
  'useVisvine',
  'useSubject',
  'useTheme',
  'useQuery',
  'useLiveQuery',
  'usePagedList',
  'LIVE_QUERY_POLL_MS',
  'BridgeCallError',
  // components
  'Banner',
  'Button',
  'Card',
  'Chip',
  'EmptyState',
  'Field',
  'Input',
  'PageHeader',
  'Select',
  'Spinner',
  'Stack',
  'Table',
  'Tabs',
  'Textarea',
  // batteries
  'LineChart',
  'BarChart',
  'AreaChart',
  'PieChart',
  'Recharts',
  'useChartColors',
  'CHART_COLOR_SLOTS',
  'DataTable',
  'DatePicker',
  'Markdown',
  'KanbanBoard',
  'KanbanColumn',
  'KanbanCard',
  // the app's own (@visvine/ui), kit 2
  'Alert',
  'Avatar',
  'Checkbox',
  'ConfirmDialog',
  'IconButton',
  'LoadingText',
  'Menu',
  'Modal',
  'Row',
  'SearchInput',
  'SettingsSection',
  'Skeleton',
  'Toggle',
] as const

const built = buildVendorFiles()

/** The names in the module's final `export { a as B, ... }` statement. */
function exportedNames(code: string): Set<string> {
  const names = new Set<string>()
  const re = /export\{([^}]*)\}/g
  for (const match of code.matchAll(re)) {
    for (const part of match[1].split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const asIndex = trimmed.lastIndexOf(' as ')
      names.add(asIndex >= 0 ? trimmed.slice(asIndex + 4).trim() : trimmed)
    }
  }
  return names
}

test('tool-kit.js builds and stays inside its size budget', async () => {
  const files = await built
  const kit = files['tool-kit.js']
  const bytes = Buffer.byteLength(kit.code, 'utf8')
  assert.ok(bytes > 100_000, `the kit should carry recharts and markdown; got ${bytes} bytes`)
  assert.ok(bytes <= KIT_BUNDLE_BUDGET_BYTES, `tool-kit.js is ${bytes} bytes, over the ${KIT_BUNDLE_BUDGET_BYTES} budget`)
})

test('the kit bundle exports every documented name and the booter', async () => {
  const names = exportedNames((await built)['tool-kit.js'].code)
  for (const name of KIT_VALUE_EXPORTS) assert.ok(names.has(name), `${name} is exported from tool-kit.js`)
  assert.ok(names.has('bootTool'))
})

test('the kit bundle imports only the externals the frame can resolve', async () => {
  const code = (await built)['tool-kit.js'].code
  // esbuild's minified ESM: `import*as x from"…"`, `import{…}from"…"`, `export*from"…"`.
  const re = /(?:import(?:\*as [\w$]+|\{[^}]*\}|[\w$]+)? ?from|export\*from)"([^"]+)"/g
  const specifiers = new Set(Array.from(code.matchAll(re), (m) => m[1]))
  assert.ok(specifiers.has('react'), 'the kit imports react from the map')
  for (const specifier of specifiers) {
    assert.ok(
      (EXTERNALS as readonly string[]).includes(specifier),
      `${specifier} is imported by tool-kit.js but is not an external the import map serves`,
    )
  }
  // The batteries are bundled IN — none of them may leak out as an import.
  assert.ok(!specifiers.has('recharts'))
  assert.ok(!specifiers.has('react-markdown'))
  assert.equal(code.includes('Dynamic require of'), false)
})

test('kit 1 keeps its own components and stylesheet, for the Tools written against it', async () => {
  const files = await built
  const kit1 = files['tool-kit-1.js'].code
  assert.ok(kit1.includes('vv-btn'), 'kit 1 paints with its own rules')
  assert.ok(!files['tool-kit.js'].code.includes('vv-btn--'), 'kit 2 paints with the app\'s components')
  assert.ok(files['tool-kit.css'].code.includes('--vv-color-accent'), 'kit 2 ships the design tokens')
})

test('every vendor file builds', async () => {
  const files = await built
  for (const name of VENDOR_FILES) {
    assert.ok(files[name].code.length > 0, `${name} built`)
    assert.match(files[name].etag, /^[0-9a-f]{40}$/)
  }
})

// ── the documented surface ──

test('TOOL_KIT_DTS declares every value export of the kit', () => {
  for (const name of KIT_VALUE_EXPORTS) {
    const declared = new RegExp(`export (?:function|const|class) ${name}\\b`)
    assert.match(TOOL_KIT_DTS, declared, `${name} is declared in TOOL_KIT_DTS`)
  }
})

test('TOOL_KIT_DTS names the paged and live API', () => {
  assert.match(TOOL_KIT_DTS, /listPage\(glob\?: string, cursor\?: string \| null\): Promise<ContextPage<ContextEntry>>/)
  assert.match(TOOL_KIT_DTS, /searchPage\(query: string, opts\?: \{ k\?: number; cursor\?: string \| null \}\)/)
  assert.match(TOOL_KIT_DTS, /export interface ContextPage<T>/)
  assert.match(TOOL_KIT_DTS, /export function useLiveQuery<T>/)
  assert.match(TOOL_KIT_DTS, /export function usePagedList\(/)
})

test('the guide documents the batteries, live data as best-effort, paging and the state cap', () => {
  for (const name of ['DataTable', 'DatePicker', 'Markdown', 'LineChart', 'KanbanBoard', 'Recharts', 'useLiveQuery', 'usePagedList']) {
    assert.ok(TOOL_AUTHOR_GUIDE.includes(name), `guide mentions ${name}`)
  }
  assert.match(TOOL_AUTHOR_GUIDE, /best-effort/)
  assert.ok(TOOL_AUTHOR_GUIDE.includes(`${LIVE_QUERY_POLL_MS / 1000}\nseconds`) || TOOL_AUTHOR_GUIDE.includes(`${LIVE_QUERY_POLL_MS / 1000} seconds`) || TOOL_AUTHOR_GUIDE.includes('every 30'))
  assert.ok(TOOL_AUTHOR_GUIDE.includes(STATE_MAX_BYTES.toLocaleString('en-US')), 'guide carries the state byte cap')
  assert.ok(!TOOL_AUTHOR_GUIDE.includes('Import only `react` and `@visvine/tool-kit`'), 'the import rule names react-dom/client')
})

test('the state cap is 64KB', () => {
  assert.equal(STATE_MAX_BYTES, 64 * 1024)
})
