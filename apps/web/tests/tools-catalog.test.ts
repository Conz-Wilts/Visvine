/**
 * The component catalog (lib/tools/catalog.ts) is the kit, exactly: every
 * component and hook `@visvine/tool-kit` exports is listed, nothing listed is
 * missing from it, and every snippet compiles as a Tool would compile it. So
 * `get_tool_sdk`, the `tool_design` guide, the starter's COMPONENTS.md and `visvine-tool dev`'s
 * Components panel can never hand an author a component that does not exist.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-catalog.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderCatalog, snippetImports, TOOL_CATALOG } from '@/lib/tools/catalog'
import { compileToolUi } from '@/lib/tools/compile'
import { guideById } from '@/lib/actions/shared/guides'
import { allActions } from '@/lib/actions/registry'
import { generateUiCatalog } from '../scripts/build-tool-catalog'

const KIT = join(__dirname, '..', 'features', 'tools', 'kit')

/** Value exports (not types) of a module, read from its `export { … }` lists. */
function valueExports(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    if (/export\s+type\s*\{/.test(match[0])) continue
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.push(name)
    }
  }
  return names
}

/** What a Tool author can use: every component and every hook, not constants or the provider. */
function kitSurface(): string[] {
  const components = valueExports(readFileSync(join(KIT, 'components', 'index.ts'), 'utf8'))
  const root = valueExports(readFileSync(join(KIT, 'api.ts'), 'utf8'))
  const hooks = root.filter((name) => name.startsWith('use'))
  return [...components, ...hooks].filter((name) => /^[A-Z][a-z]|^use[A-Z]/.test(name)).sort()
}

test('the catalog lists exactly what the kit exports', () => {
  const kit = kitSurface()
  const catalog = TOOL_CATALOG.map((entry) => entry.name).sort()
  assert.deepEqual(
    catalog.filter((name) => !kit.includes(name)),
    [],
    'the catalog names something the kit does not export',
  )
  assert.deepEqual(
    kit.filter((name) => !catalog.includes(name)),
    [],
    'the kit exports something the catalog does not describe — add it to lib/tools/catalog.ts',
  )
})

test('every snippet compiles the way a Tool compiles', async () => {
  for (const entry of TOOL_CATALOG) {
    const imports = snippetImports(entry).join(', ')
    const body =
      entry.kind === 'hook' ? `  ${entry.snippet.split('\n').join('\n  ')}\n  return null` : `  return (\n    <>\n${entry.snippet}\n    </>\n  )`
    const source = `import { ${imports} } from '@visvine/tool-kit'\n\nexport default function App() {\n${body}\n}\n`
    const result = await compileToolUi(source)
    assert.ok(result.ok, `${entry.name}: ${result.ok ? '' : result.errors.map((e) => e.message).join('; ')}\n${source}`)
  }
})

test('each entry says what it is and when the app uses it, in a line or two', () => {
  for (const entry of TOOL_CATALOG) {
    assert.ok(entry.what.length > 0 && entry.what.length <= 120, `${entry.name}: what`)
    assert.ok(entry.when.length > 0 && entry.when.length <= 260, `${entry.name}: when`)
  }
})

test('the catalog reaches every authoring path: the guide, create_tool and write_tool', () => {
  const guide = guideById('tool_design')
  assert.ok(guide)
  assert.ok(guide.body.includes(renderCatalog()))
  for (const name of ['create_tool', 'write_tool']) {
    const def = allActions().find((a) => a.name === name)
    assert.ok((def?.guides ?? []).includes('tool_design'), `${name} does not name tool_design`)
  }
})

test('the app-component half of the catalog is generated from packages/ui, and committed current', () => {
  const committed = readFileSync(join(__dirname, '..', 'lib', 'tools', 'catalog.generated.ts'), 'utf8')
  assert.equal(committed, generateUiCatalog(), 'run scripts/build-tool-catalog.ts')
})
