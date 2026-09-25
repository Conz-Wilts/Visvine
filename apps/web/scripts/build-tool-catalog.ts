/**
 * The Tool catalog's half that is the app's own components, generated from
 * `packages/ui`: for each component kit 2 re-exports from `@visvine/ui`, what
 * its doc comment says it is, the props its interface declares, and where the
 * app itself uses it — beside a snippet and the design rule for it, which are
 * the one part written here by hand.
 *
 * Output lands in lib/tools/catalog.generated.ts and IS COMMITTED, like the
 * icons; `--check` regenerates in memory and fails when the committed file has
 * drifted from packages/ui (tests/tools-catalog.test.ts runs the same check).
 *
 *   pnpm --filter @visvine/web exec tsx scripts/build-tool-catalog.ts
 *   pnpm --filter @visvine/web exec tsx scripts/build-tool-catalog.ts --check
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const APP = join(__dirname, '..')
const UI_SRC = join(APP, '..', '..', 'packages', 'ui', 'src')
const KIT_COMPONENTS = join(APP, 'features', 'tools', 'kit', 'components', 'index.ts')
const OUT = join(APP, 'lib', 'tools', 'catalog.generated.ts')

/**
 * What only a person can say about each component: when a Tool should reach
 * for it (the app's design rule, in brief) and a snippet that compiles inside
 * a Tool's default export. A component kit 2 re-exports without an entry here
 * fails the build — the catalog never lists a component nobody explained.
 */
const CURATED: Record<string, { use: string; snippet: string; imports?: string[]; what?: string }> = {
  Alert: {
    what: 'A notice: a 2px rule in its colour down the left, then the words.',
    use: 'Only when something is actually wrong or needs saying once — a normal state is silent.',
    snippet: `<Alert variant="warning">Two deals have no owner.</Alert>`,
  },
  Avatar: {
    what: "A person's (or a space's) picture, falling back to a silhouette or initials.",
    use: 'Beside a name in a list or a record — the Directory and messages draw people this way.',
    snippet: `<Avatar name="Ada Lovelace" size="sm" />`,
  },
  Checkbox: {
    use: 'A choice that joins a set. A setting that switches something on is a Toggle.',
    snippet: `<Checkbox checked={false} onChange={() => {}} label="Include archived" />`,
  },
  ConfirmDialog: {
    what: 'A modal that asks before a destructive or irreversible act, and can make the person type a name first.',
    use: 'Before anything destructive or irreversible. Pass confirmText for the most dangerous.',
    snippet: `<ConfirmDialog open={false} title="Delete this deal?" confirmLabel="Delete" destructive onConfirm={() => {}} onClose={() => {}} />`,
  },
  IconButton: {
    use: 'A toolbar action that is only an icon; its label is its name for a screen reader.',
    snippet: `<IconButton label="More" onClick={() => {}} icon={<span aria-hidden>⋯</span>} />`,
  },
  LoadingText: {
    what: 'A centred, muted "Loading…" line for a view that has nothing to show yet.',
    use: 'Instead of a spinner when a whole view is waiting.',
    snippet: `<LoadingText />`,
  },
  Menu: {
    use: 'The overflow (⋯) of a row or a toolbar — actions that do not earn a button of their own.',
    snippet: `<Menu label="Deal actions" items={[{ id: 'archive', label: 'Archive', onSelect: () => {} }]} trigger={({ toggle }) => <button type="button" onClick={toggle}>⋯</button>} />`,
  },
  Modal: {
    use: 'A focused task over the page — an edit form, a picker. It floats, so it casts the shadow.',
    snippet: `<Modal open={false} title="Edit deal" onClose={() => {}}>\n  <p>Form here</p>\n</Modal>`,
  },
  Row: {
    what: 'Children side by side, a fixed step apart, centred on one line.',
    use: 'A row of buttons, a label beside its control, a chip beside a name.',
    snippet: `<Row gap={2}>\n  <span>Left</span>\n  <span>Right</span>\n</Row>`,
  },
  SearchInput: {
    what: 'A text input with a search glyph and a clear button.',
    use: 'Above a list that filters as you type — the Directory and the pickers.',
    snippet: `<SearchInput value="" onChange={() => {}} placeholder="Search deals" />`,
  },
  SettingsSection: {
    what: 'A flat settings section: a small bold heading, a muted line, and a hairline between siblings.',
    use: "A Tool's own settings view: small heading, one muted line, hairlines between sections, no card.",
    snippet: `<SettingsSection title="Pipeline">\n  <p>Stages</p>\n</SettingsSection>`,
  },
  Skeleton: {
    use: 'The shape of rows while they load, so the page does not jump when they arrive.',
    snippet: `<Skeleton className="h-4 w-1/3 rounded" />`,
  },
  Toggle: {
    use: 'A setting that switches something on — beside the title it controls, never a second row saying the same.',
    snippet: `<Toggle checked={false} onChange={() => {}} aria-label="Show closed" />`,
  },
}

/** The components kit 2 re-exports from @visvine/ui, read off its index. */
function reexported(): string[] {
  const source = readFileSync(KIT_COMPONENTS, 'utf8')
  const block = /export\s*\{([^}]+)\}\s*from\s*'@visvine\/ui'/.exec(source)
  if (!block) return []
  return block[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
}

/** The file a component is defined in: `Name.tsx`, or the module that exports it by name. */
function fileOf(name: string): string {
  const direct = join(UI_SRC, `${name}.tsx`)
  if (existsSync(direct)) return direct
  const index = readFileSync(join(UI_SRC, 'index.ts'), 'utf8')
  const match = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'\\./([^']+)'`).exec(index)
  if (!match) throw new Error(`Cannot find ${name} in packages/ui`)
  return join(UI_SRC, `${match[1]}.tsx`)
}

function docOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? []
  const block = ranges
    .map((r) => sourceFile.text.slice(r.pos, r.end))
    .filter((text) => text.startsWith('/**'))
    .pop()
  if (!block) return ''
  return block
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The first sentence of a doc comment, cut at a clause when it runs past a line. */
function firstSentence(doc: string): string {
  const match = /^(.+?[.!?])(\s|$)/.exec(doc)
  const sentence = (match ? match[1] : doc).trim()
  if (sentence.length <= 120) return sentence
  const head = sentence.slice(0, 118)
  const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf(' — '), head.lastIndexOf(' ('))
  return `${(cut > 40 ? head.slice(0, cut) : head).replace(/[,\s]+$/, '')}.`
}

interface Found {
  doc: string
  props: string
}

/** The component's own doc and its props, from its declaration and props type. */
function describe(name: string): Found {
  const path = fileOf(name)
  const sourceFile = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let doc = ''
  let propsType: ts.TypeNode | null = null
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      doc = docOf(node, sourceFile)
      propsType = node.parameters[0]?.type ?? null
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name || !decl.initializer) continue
        doc = docOf(node, sourceFile)
        // forwardRef<Element, Props>(function …)
        if (ts.isCallExpression(decl.initializer) && decl.initializer.typeArguments?.[1]) {
          propsType = decl.initializer.typeArguments[1]
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { doc, props: propsType ? propsOf(propsType, sourceFile) : '' }
}

/** A type's members as `name?: type` pairs, resolving a named interface or alias in the same file. */
function propsOf(type: ts.TypeNode, sourceFile: ts.SourceFile): string {
  let members: readonly ts.TypeElement[] | null = ts.isTypeLiteralNode(type) ? type.members : null
  let alias: string | null = null
  if (!members && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const wanted = type.typeName.text
    for (const node of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(node) && node.name.text === wanted) members = node.members
      else if (ts.isTypeAliasDeclaration(node) && node.name.text === wanted) {
        if (ts.isTypeLiteralNode(node.type)) members = node.type.members
        else alias = node.type.getText(sourceFile)
      }
    }
  }
  if (!members) return alias ? `the element's own attributes (${alias})` : type.getText(sourceFile)
  return members
    .filter(ts.isPropertySignature)
    .filter((m) => !['className', 'style', 'children'].includes(m.name.getText(sourceFile)))
    .map((m) => {
      const typeText = readable((m.type?.getText(sourceFile) ?? 'unknown').replace(/\s+/g, ' '), sourceFile)
      const short = typeText.length > 48 ? `${typeText.slice(0, 45)}…` : typeText
      return `${m.name.getText(sourceFile)}${m.questionToken ? '?' : ''}: ${short}`
    })
    .join(' · ')
}

/**
 * A type as an author can read it: a local union alias spelled out, and
 * `keyof typeof SIZES` as the keys that object has.
 */
function readable(typeText: string, sourceFile: ts.SourceFile): string {
  const keyof = /^keyof typeof (\w+)$/.exec(typeText)
  for (const node of sourceFile.statements) {
    if (keyof && ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== keyof[1] || !decl.initializer) continue
        let init: ts.Expression = decl.initializer
        while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
        if (!ts.isObjectLiteralExpression(init)) continue
        return init.properties
          .map((p) => (p.name ? p.name.getText(sourceFile).replace(/^['"]|['"]$/g, '') : ''))
          .filter(Boolean)
          .map((key) => `'${key}'`)
          .join(' | ')
      }
    }
    if (!keyof && ts.isTypeAliasDeclaration(node) && node.name.text === typeText && ts.isUnionTypeNode(node.type)) {
      return node.type.getText(sourceFile).replace(/\s+/g, ' ')
    }
  }
  return typeText
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Where the app draws each component: the feature areas that import it from @visvine/ui. */
function usage(names: readonly string[]): Map<string, { count: number; areas: string[] }> {
  const out = new Map(names.map((n) => [n, { count: 0, areas: [] as string[] }]))
  const files = [...walk(join(APP, 'features')), ...walk(join(APP, 'app'))]
  for (const file of files) {
    if (file.includes(join('features', 'tools', 'kit'))) continue
    const text = readFileSync(file, 'utf8')
    const imported = /import\s*\{([^}]+)\}\s*from\s*'@visvine\/ui'/.exec(text)
    if (!imported) continue
    const list = imported[1].split(',').map((p) => p.trim().split(/\s+as\s+/)[0])
    const area = relative(APP, file).split('/').slice(0, 2).join('/').replace(/^features\//, '').replace(/^app\/.*/, 'pages')
    for (const name of names) {
      if (!list.includes(name)) continue
      const row = out.get(name)!
      row.count += 1
      if (!row.areas.includes(area)) row.areas.push(area)
    }
  }
  return out
}

export function generateUiCatalog(): string {
  const names = reexported()
  const missing = names.filter((name) => !CURATED[name])
  if (missing.length) throw new Error(`No catalog entry for ${missing.join(', ')} — add it to CURATED in scripts/build-tool-catalog.ts`)
  const used = usage(names)
  const entries = names.map((name) => {
    const found = describe(name)
    const curated = CURATED[name]
    const where = used.get(name)!
    const shown = where.areas.sort().slice(0, 3).join(', ')
    const more = where.areas.length - 3
    const inApp = more > 0 ? `${shown} and ${more} more` : shown
    return {
      name,
      kind: 'component' as const,
      what: curated.what ?? firstSentence(found.doc),
      when: where.count ? `${curated.use} In the app: ${inApp}.` : curated.use,
      props: found.props || 'className — its size and shape',
      snippet: curated.snippet,
      ...(curated.imports ? { imports: curated.imports } : {}),
    }
  })
  return [
    '// AUTO-GENERATED by apps/web/scripts/build-tool-catalog.ts from packages/ui — do not edit.',
    '// Run it after changing a component kit 2 re-exports, or the curated notes beside them.',
    "import type { CatalogEntry } from './catalog'",
    '',
    '/** The app\'s own components (@visvine/ui) as kit 2 re-exports them. */',
    `export const UI_CATALOG: readonly CatalogEntry[] = ${JSON.stringify(entries, null, 2)}`,
    '',
  ].join('\n')
}

function main(): void {
  const text = generateUiCatalog()
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (current !== text) {
      console.error('lib/tools/catalog.generated.ts is out of date — run scripts/build-tool-catalog.ts')
      process.exit(1)
    }
    console.log('catalog: generated output up to date.')
    return
  }
  writeFileSync(OUT, text, 'utf8')
  console.log(`catalog: ${OUT}`)
}

if (process.argv[1] && process.argv[1].endsWith('build-tool-catalog.ts')) main()
