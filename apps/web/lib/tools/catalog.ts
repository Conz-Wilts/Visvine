/**
 * The component catalog: every component and hook kit 2 exports, what it is
 * for, when the app itself uses its shape, and a snippet that compiles — plus
 * the design rules in brief. Pure. The app's own components kit 2 re-exports
 * are generated from packages/ui (./catalog.generated.ts,
 * scripts/build-tool-catalog.ts); the kit's own are written here.
 *
 * One source, four readers: `get_tool_sdk` hands it to any AI client, the
 * `tool_design` guide carries it into `create_tool` and `write_tool`'s
 * manuals, the in-app builder has it in context from its first turn, and the
 * Workbench's Components panel inserts its snippets. So a Tool built without
 * instructions looks like the app; a person who wants their own look asks for
 * it, and nothing here stops them.
 *
 * `tests/tools-catalog.test.ts` holds it to the kit: every export is listed,
 * nothing listed is missing from the kit, and every snippet compiles.
 */

import { UI_CATALOG } from './catalog.generated'

export interface CatalogEntry {
  name: string
  kind: 'component' | 'hook'
  /** One line: what it is. */
  what: string
  /** When the app draws this shape — the reason to reach for it. */
  when: string
  /** The props or signature that matter, in brief. */
  props: string
  /** A snippet that compiles inside a Tool's default export. */
  snippet: string
  /** Kit imports the snippet needs, beyond the entry itself. */
  imports?: string[]
}

/** The kit's own components and hooks. */
const KIT_CATALOG: readonly CatalogEntry[] = [
  // ── layout ──
  {
    name: 'Stack',
    kind: 'component',
    what: 'Vertical or horizontal spacing between children.',
    when: 'Every screen: the page is a column of sections; a row of buttons is a Stack in a row.',
    props: "direction?: 'column' | 'row' · gap?: 'sm' | 'md' | 'lg' · wrap?",
    snippet: `<Stack gap="md">\n  <p>First</p>\n  <p>Second</p>\n</Stack>`,
  },
  {
    name: 'PageHeader',
    kind: 'component',
    what: "A section's title with its actions at the trailing end.",
    when: 'Only inside the frame for a sub-view. The band already names the Tool and its section — never repeat the page title.',
    props: 'title · description? · actions?',
    snippet: `<PageHeader title="This week" actions={<Button size="sm">Export</Button>} />`,
    imports: ['Button'],
  },
  {
    name: 'Card',
    kind: 'component',
    what: 'A section with an optional title and actions, set off by a hairline.',
    when: 'To group part of a page. The app is flat — a section, not a box.',
    props: 'title? · actions? · flush?',
    snippet: `<Card title="Totals">\n  <p>12 open</p>\n</Card>`,
  },
  {
    name: 'Tabs',
    kind: 'component',
    what: 'A tab strip inside the frame.',
    when: 'For a switch INSIDE one section. A Tool\'s own sections belong in `surfaces.nav`, which the app draws on its band — never a tab strip at the top of the frame.',
    props: 'tabs: { id, label }[] · active · onChange(id)',
    snippet: `<Tabs tabs={[{ id: 'open', label: 'Open' }, { id: 'done', label: 'Done' }]} active="open" onChange={() => {}} />`,
  },
  // ── states ──
  {
    name: 'EmptyState',
    kind: 'component',
    what: 'What a list shows when there is nothing in it.',
    when: 'Only where empty is exceptional. The app hides an empty section rather than captioning it.',
    props: 'title · description? · action?',
    snippet: `<EmptyState title="No deals" />`,
  },
  {
    name: 'Spinner',
    kind: 'component',
    what: 'A small loading indicator.',
    when: 'While a query is loading and there is nothing to show yet.',
    props: "size?: 'sm' | 'lg' · label?",
    snippet: `<Spinner />`,
  },
  {
    name: 'Banner',
    kind: 'component',
    what: 'A notice with a tone — the app\'s rule-and-words notice, with a title and an action.',
    when: 'Only when something is actually wrong or needs a decision. A normal state is silent.',
    props: "tone?: 'info' | 'success' | 'warn' | 'danger' · title? · action?",
    snippet: `<Banner tone="warn" title="Two deals have no owner" />`,
  },
  {
    name: 'Chip',
    kind: 'component',
    what: 'The app\'s chip: a small label for a status or a type, muted or in a tone.',
    when: 'A row\'s status or type, the way the Directory labels a record.',
    props: "tone?: 'neutral' | 'accent' | 'danger' | 'warn' | 'info'",
    snippet: `<Chip tone="accent">Won</Chip>`,
  },
  // ── actions and inputs ──
  {
    name: 'Button',
    kind: 'component',
    what: 'The app\'s button.',
    when: 'Labels are one to three words that name the act: Save, Run now, New deal. One primary per view.',
    props: "variant?: 'primary' | 'secondary' | 'ghost' | 'danger' · size?: 'sm' | 'md' · loading? · loadingText? · any button attribute",
    snippet: `<Button variant="primary" onClick={() => {}}>Save</Button>`,
  },
  {
    name: 'Field',
    kind: 'component',
    what: 'A label over an input, with an error line.',
    when: 'Every form row. The label names; it does not explain — no sentence under an input.',
    props: 'label · htmlFor? · error?',
    snippet: `<Field label="Owner" htmlFor="owner">\n  <Input id="owner" />\n</Field>`,
    imports: ['Input'],
  },
  {
    name: 'Input',
    kind: 'component',
    what: 'A text input styled like the app’s.',
    when: 'Any single-line value. Never a password — a Tool never asks for one, and the checks block it.',
    props: 'any input attribute',
    snippet: `<Input placeholder="Search" onChange={() => {}} />`,
  },
  {
    name: 'Textarea',
    kind: 'component',
    what: 'A multi-line input.',
    when: 'A note or a comment.',
    props: 'any textarea attribute',
    snippet: `<Textarea rows={3} aria-label="Note" />`,
  },
  {
    name: 'Select',
    kind: 'component',
    what: 'A native select.',
    when: 'Choosing one of a few known values.',
    props: 'options?: { value, label }[] · any select attribute',
    snippet: `<Select options={[{ value: 'lead', label: 'Lead' }, { value: 'won', label: 'Won' }]} onChange={() => {}} />`,
  },
  {
    name: 'DatePicker',
    kind: 'component',
    what: 'A date input with an ISO value.',
    when: 'Any date field.',
    props: 'value: string | null · onChange(value) · min? · max?',
    snippet: `<DatePicker value={null} onChange={() => {}} />`,
  },
  // ── data ──
  {
    name: 'Table',
    kind: 'component',
    what: 'Rows under column headers.',
    when: 'A short list of records with a few facts each.',
    props: 'columns: { key, header, render(row) }[] · rows · rowKey(row) · onRowClick?',
    snippet: `<Table\n  columns={[{ key: 'title', header: 'Title', render: (row: { title: string }) => row.title }]}\n  rows={[{ title: 'Acme' }]}\n  rowKey={(row) => row.title}\n/>`,
  },
  {
    name: 'DataTable',
    kind: 'component',
    what: 'A table that sorts and virtualises.',
    when: 'The Directory\'s table shape: many records, sortable columns.',
    props: 'Table\'s props · sortable columns · defaultSort? · maxHeight? · virtualize?',
    snippet: `<DataTable\n  columns={[{ key: 'title', header: 'Title', render: (row: { title: string }) => row.title, sortable: true }]}\n  rows={[{ title: 'Acme' }]}\n  rowKey={(row) => row.title}\n/>`,
  },
  {
    name: 'KanbanBoard',
    kind: 'component',
    what: 'Columns of cards a person drags between.',
    when: 'Records that move through stages. A move is yours to write — usually a `context.write` of the note\'s status.',
    props: 'onMove({ cardId, fromColumnId, toColumnId, index }) · children: KanbanColumn',
    snippet: `<KanbanBoard onMove={() => {}}>\n  <KanbanColumn id="lead" title="Lead">\n    <KanbanCard id="acme">Acme</KanbanCard>\n  </KanbanColumn>\n</KanbanBoard>`,
    imports: ['KanbanColumn', 'KanbanCard'],
  },
  {
    name: 'KanbanColumn',
    kind: 'component',
    what: 'One column of a KanbanBoard.',
    when: 'Inside a KanbanBoard.',
    props: 'id · title · count? · actions? · empty?',
    snippet: `<KanbanBoard onMove={() => {}}>\n  <KanbanColumn id="won" title="Won" count={0} />\n</KanbanBoard>`,
    imports: ['KanbanBoard'],
  },
  {
    name: 'KanbanCard',
    kind: 'component',
    what: 'One draggable card.',
    when: 'Inside a KanbanColumn.',
    props: 'id · onClick?',
    snippet: `<KanbanBoard onMove={() => {}}>\n  <KanbanColumn id="lead" title="Lead">\n    <KanbanCard id="acme" onClick={() => {}}>Acme</KanbanCard>\n  </KanbanColumn>\n</KanbanBoard>`,
    imports: ['KanbanBoard', 'KanbanColumn'],
  },
  {
    name: 'Markdown',
    kind: 'component',
    what: 'A note body rendered the way the app renders notes, sanitised.',
    when: 'Showing what a note says.',
    props: 'source · onLinkClick?',
    snippet: `<Markdown source="**Acme** signed." />`,
  },
  {
    name: 'LineChart',
    kind: 'component',
    what: 'A line chart in the app\'s chart palette.',
    when: 'A value over time.',
    props: 'data · x · series: (key | { key, label?, color? })[] · height? · formatValue?',
    snippet: `<LineChart data={[{ week: 'W1', deals: 3 }, { week: 'W2', deals: 5 }]} x="week" series={['deals']} />`,
  },
  {
    name: 'BarChart',
    kind: 'component',
    what: 'A bar chart in the app\'s chart palette.',
    when: 'Comparing a few counts.',
    props: "LineChart's props · stacked?",
    snippet: `<BarChart data={[{ stage: 'Lead', n: 4 }, { stage: 'Won', n: 2 }]} x="stage" series={['n']} />`,
  },
  {
    name: 'AreaChart',
    kind: 'component',
    what: 'An area chart in the app\'s chart palette.',
    when: 'A total over time made of parts.',
    props: "LineChart's props · stacked?",
    snippet: `<AreaChart data={[{ m: 'Jan', a: 1, b: 2 }]} x="m" series={['a', 'b']} stacked />`,
  },
  {
    name: 'PieChart',
    kind: 'component',
    what: 'A pie or donut in the app\'s chart palette.',
    when: 'Shares of a whole, few slices.',
    props: 'data · nameKey · valueKey · donut?',
    snippet: `<PieChart data={[{ name: 'Won', n: 2 }, { name: 'Lost', n: 1 }]} nameKey="name" valueKey="n" donut />`,
  },
  {
    name: 'Recharts',
    kind: 'component',
    what: 'The chart library itself, for a chart the four above do not draw.',
    when: 'Rarely. Colour it with `useChartColors()` so it matches.',
    props: 'the Recharts namespace',
    snippet: `<Recharts.ResponsiveContainer width="100%" height={120}>\n  <Recharts.LineChart data={[{ x: 1, y: 2 }]}>\n    <Recharts.Line dataKey="y" />\n  </Recharts.LineChart>\n</Recharts.ResponsiveContainer>`,
  },
  // ── hooks ──
  {
    name: 'useVisvine',
    kind: 'hook',
    what: 'The bridge: notes, records, files, connectors, agents, actions, the space\'s AI, state, the host\'s dialogs.',
    when: 'Every Tool that touches the space. Everything it reaches is inside the permissions its manifest declares, bound to this space.',
    props: 'context.list/read/search/write/append/links · records.query/get/update · resources.list/get/read/blob · connectors.call · agents.run · actions.run · ai.complete/decide · collections.insert/list/get/update/delete/count (useCollection, useCollectionCount) · data.call · state.get/set (per viewer by default) · ui.toast/confirm/download/openRecord/openResource · install.settings/bindings · viewer · navigate(path)',
    snippet: `const visvine = useVisvine()`,
  },
  {
    name: 'useQuery',
    kind: 'hook',
    what: 'Run a bridge read when its inputs change; hand back data, error, loading and reload.',
    when: 'Every read that feeds the screen.',
    props: 'useQuery(fn, deps) → { data, error, loading, reload }',
    snippet: `const visvine = useVisvine()\nconst notes = useQuery(() => visvine.context.list('deals/**'), [])`,
    imports: ['useVisvine'],
  },
  {
    name: 'useLiveQuery',
    kind: 'hook',
    what: 'useQuery that reloads when a note inside the perimeter changes.',
    when: 'A board or list others edit while it is open.',
    props: 'useLiveQuery(fn, deps, { paths?, pollMs? })',
    snippet: `const visvine = useVisvine()\nconst notes = useLiveQuery(() => visvine.context.list('deals/**'), [], { paths: ['deals/**'] })`,
    imports: ['useVisvine'],
  },
  {
    name: 'usePagedList',
    kind: 'hook',
    what: 'A list read a page at a time.',
    when: 'A folder that may hold more than one page of notes.',
    props: 'usePagedList(glob, { pageSize? }) → { items, loading, hasMore, loadMore, reload }',
    snippet: `const list = usePagedList('deals/**')`,
  },
  {
    name: 'useCollection',
    kind: 'hook',
    what: 'A collection\'s rows, reloaded when anyone\'s write to it reaches the viewer.',
    when: 'The Tool\'s own data — votes, sign-ups, check-ins — declared under `collections`.',
    props: 'useCollection(name, { where?, mine?, order?, limit? }) → { data: rows, loading, error, reload }',
    snippet: `const { data: rows } = useCollection('votes', { mine: true })`,
  },
  {
    name: 'useCollectionCount',
    kind: 'hook',
    what: 'How many rows a collection holds, or its tally per value of one field.',
    when: 'A poll\'s results, a sign-up count.',
    props: 'useCollectionCount(name, { where?, mine?, groupBy? }) → { data: { total, groups? } }',
    snippet: `const { data: tally } = useCollectionCount('votes', { groupBy: 'choice' })`,
  },
  {
    name: 'useSubject',
    kind: 'hook',
    what: 'What the Tool is being shown about, on a type page tab; null on its own page.',
    when: 'A Tool that claims a tab on a type\'s page (`surfaces.types`).',
    props: 'useSubject() → { kind, path, type, title } | null',
    snippet: `const subject = useSubject()`,
  },
  {
    name: 'useSection',
    kind: 'hook',
    what: 'The active one of the Tool\'s own sections, and a way to switch it.',
    when: 'A Tool that declares `surfaces.nav`. The app draws the sections; the Tool draws the active one\'s content.',
    props: 'useSection() → [section, go(id)]',
    snippet: `const [section] = useSection()`,
  },
  {
    name: 'useBandAction',
    kind: 'hook',
    what: 'Run a handler when a band button the Tool declared is pressed.',
    when: 'A Tool that declares `surfaces.actions` — the app draws the button beside the ⋯ menu.',
    props: 'useBandAction(id, handler)',
    snippet: `useBandAction('new-deal', () => {})`,
  },
  {
    name: 'useTheme',
    kind: 'hook',
    what: 'The app\'s theme tokens as CSS custom properties.',
    when: 'Rarely — the kit and `var(--vv-*)` already follow the theme.',
    props: 'useTheme() → Record<string, string>',
    snippet: `const theme = useTheme()`,
  },
  {
    name: 'useChartColors',
    kind: 'hook',
    what: 'The chart palette, for a chart drawn with Recharts directly.',
    when: 'With Recharts.',
    props: 'useChartColors() → string[]',
    snippet: `const colors = useChartColors()`,
  },
]

/** Everything a Tool author can reach for: the kit's own, then the app's. */
export const TOOL_CATALOG: readonly CatalogEntry[] = [...KIT_CATALOG, ...UI_CATALOG]

/** The rules a Tool keeps to look like the app — the same ones the app keeps. */
const TOOL_DESIGN_RULES: readonly string[] = [
  'The app draws the chrome. The rail row, the band (your sections as tabs, your band buttons, the ⋯ menu) and every state are the app\'s. Draw only content: never a page title, a top tab strip or a header that repeats what the band says.',
  'Flat surfaces: sections separated by hairlines, no cards around everything, no shadows except on things that float.',
  'Labels name, they do not explain: one to three words. No sentence under a field, no caption explaining a screen — if a screen needs text to explain itself, change the screen.',
  'Say only the exceptional. Hide an empty section rather than captioning it; show a warning only when something is actually wrong.',
  'State is data, joined by ·: `12 open · 3 overdue · updated 5m ago`, one muted line.',
  'Colour comes from the theme: the kit, or `var(--vv-*)` in your own styles — never a hex, never a painted page background (the frame is transparent over the app\'s own).',
  'No 100vh and no position: fixed — they measure the frame, not the window. The host sizes the frame to your content.',
  'A Tool may choose its own look when a person asks for one. These rules are the default, not a wall.',
]

/** The kit imports a snippet uses, the entry's own name first. */
export function snippetImports(entry: CatalogEntry): string[] {
  return [...new Set([entry.name, ...(entry.imports ?? [])])]
}

/** The whole catalog as a model reads it: rules, then each entry with its snippet. */
export function renderCatalog(): string {
  const lines: string[] = ['## Design rules', '', ...TOOL_DESIGN_RULES.map((rule) => `- ${rule}`), '']
  for (const kind of ['component', 'hook'] as const) {
    lines.push(kind === 'component' ? '## Components' : '## Hooks', '')
    for (const entry of TOOL_CATALOG.filter((e) => e.kind === kind)) {
      lines.push(`### ${entry.name}`, '', `${entry.what} ${entry.when}`, '', `Props: ${entry.props}`, '', '```tsx', entry.snippet, '```', '')
    }
  }
  return lines.join('\n').trimEnd()
}

const KIT_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]@visvine\/tool-kit['"];?/

/**
 * Where a snippet goes when the author has not put the caret anywhere: on its
 * own line just inside the last closing tag of the file — the root element
 * the default export returns — indented one step past it. Null when the file
 * has no JSX to put it in.
 */
function defaultInsertion(source: string): { at: number; indent: string } | null {
  const lines = source.split('\n')
  let offset = source.length
  for (let i = lines.length - 1; i >= 0; i--) {
    offset -= lines[i].length + (i < lines.length - 1 ? 1 : 0)
    const match = /^(\s*)<\//.exec(lines[i])
    if (match) return { at: offset, indent: `${match[1]}  ` }
  }
  return null
}

/**
 * Insert a catalog snippet into a Tool's source and make sure every kit name
 * it uses is imported — merged into the existing
 * `import { … } from '@visvine/tool-kit'`, or a new one at the top. With no
 * caret, a component lands inside the root element (`defaultInsertion`) and a
 * hook at the end. Returns the new source and where the caret lands after it.
 */
export function insertSnippet(source: string, at: number | null, entry: CatalogEntry): { source: string; cursor: number } {
  const fallback = at === null && entry.kind === 'component' ? defaultInsertion(source) : null
  let position: number
  let block: string
  if (fallback) {
    position = fallback.at
    block = `${entry.snippet
      .split('\n')
      .map((line) => `${fallback.indent}${line}`)
      .join('\n')}\n`
  } else {
    position = Math.max(0, Math.min(at ?? source.length, source.length))
    block = entry.snippet
  }
  let text = `${source.slice(0, position)}${block}${source.slice(position)}`
  let cursor = position + block.length
  const needed = snippetImports(entry)
  const existing = KIT_IMPORT.exec(text)
  if (existing) {
    const have = existing[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const missing = needed.filter((name) => !have.includes(name))
    if (missing.length > 0) {
      const merged = `import { ${[...have, ...missing].join(', ')} } from '@visvine/tool-kit'`
      text = `${text.slice(0, existing.index)}${merged}${text.slice(existing.index + existing[0].length)}`
      if (existing.index < position) cursor += merged.length - existing[0].length
    }
  } else {
    const line = `import { ${needed.join(', ')} } from '@visvine/tool-kit'\n`
    text = `${line}${text}`
    cursor += line.length
  }
  return { source: text, cursor }
}
