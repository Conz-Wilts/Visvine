/**
 * The component catalog: every component and hook kit 2 exports, what it is
 * for, when the app itself uses its shape, and a snippet that compiles — plus
 * the design rules in brief. Pure. The app's own components kit 2 re-exports
 * are generated from packages/ui (./catalog.generated.ts,
 * scripts/build-tool-catalog.ts); the kit's own are written here.
 *
 * One source, four readers: `get_tool_sdk` hands it to any AI client, the
 * `tool_design` guide carries it into `create_tool` and `write_tool`'s
 * manuals, the starter's COMPONENTS.md is rendered from it, and
 * `visvine-tool dev` draws every component. So a Tool built without
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
    what: 'The app\'s dropdown: a field that opens the app\'s own menu, not the browser\'s.',
    when: 'Any field whose values are a known set — a stage, a round, a status. Never an Input for these: declare the set as the field\'s `enum` and draw it here. Never a raw `<select>`: it opens the system menu, not the app\'s.',
    props: 'options?: { value, label }[] · value · onValueChange(value) · onChange(e) (e.target.value, as a native select) · placeholder? · disabled? · id? · name?',
    snippet: `<Select options={[{ value: 'lead', label: 'Lead' }, { value: 'won', label: 'Won' }]} onValueChange={() => {}} />`,
  },
  {
    name: 'Swatch',
    kind: 'component',
    what: 'A round colour dot — the one mark for "this colour means this thing".',
    when: 'A legend row, a series key, a status beside its label. The chart legends draw the same dot, so never draw your own circle or square for a colour.',
    props: "color: string · size?: 'sm' | 'md'",
    snippet: `<span className="flex items-center gap-2"><Swatch color="var(--vv-accent)" /> Yes</span>`,
  },
  {
    name: 'Segmented',
    kind: 'component',
    what: 'Joined buttons, one of which is on.',
    when: 'Two to five values seen at once — a vote on a scale, a view switch, a filter. More than five, or a form field, is a Select.',
    props: 'options: { value, label }[] · value: string | null · onChange(value) · label · disabled?',
    snippet: `<Segmented label="Vote" value={null} onChange={() => {}} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />`,
  },
  {
    name: 'Modal',
    kind: 'component',
    what: 'A dialog over the page, with the app\'s gutter on its body and its buttons in a footer.',
    when: 'An add or edit form: Fields straight in it (short ones in a grid), buttons in `footer`. Open it from a band button (`surfaces.actions`) so it opens every time, not only from an empty state.',
    props: "onClose · open? · title? · footer? · size?: 'sm' | 'md' | 'lg'",
    snippet: `<Modal
  open={false}
  title="Add company"
  onClose={() => {}}
  footer={<><Button variant="ghost">Cancel</Button><Button variant="primary">Add</Button></>}
>
  <Field label="Name" htmlFor="name">
    <Input id="name" />
  </Field>
  <div className="grid grid-cols-2 gap-4">
    <Field label="Stage" htmlFor="stage">
      <Select id="stage" options={[{ value: 'seed', label: 'Seed' }, { value: 'a', label: 'Series A' }]} />
    </Field>
    <Field label="Raise" htmlFor="raise">
      <Input id="raise" />
    </Field>
  </div>
</Modal>`,
    imports: ['Button', 'Field', 'Input', 'Select'],
  },
  {
    name: 'DatePicker',
    kind: 'component',
    what: 'A date input with an ISO value.',
    when: 'Any date field.',
    props: 'value: string | null · onChange(value) · min? · max?',
    snippet: `<DatePicker value={null} onChange={() => {}} />`,
  },
  {
    name: 'ImageUpload',
    kind: 'component',
    what: 'A picture the viewer adds — a logo, a photo — into the Drive, as them.',
    when: 'A row that carries an image. Declare the folder in permissions.resources.write (and read), store the id in a `format: resource` field.',
    props: "value: string | null · onChange(resourceId) · label · folder? · shape?: 'square' | 'circle' · size?",
    snippet: `<ImageUpload label="Logo" value={null} onChange={() => {}} />`,
  },
  {
    name: 'ResourceImage',
    kind: 'component',
    what: 'A picture from the Drive by id, or the initials of what it is of.',
    when: 'Drawing a stored logo or photo in a list or a header. It falls back to initials, so a row without one still lines up.',
    props: "id · alt · shape?: 'square' | 'circle' · size?",
    snippet: `<ResourceImage id={null} alt="Azonic" size={40} />`,
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
    when: 'Shares of a whole, five slices or fewer — with the counts listed beside it, in a parent with a width (`w-28 shrink-0`). See the tool_charts guide.',
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
  // ── page blocks ──
  {
    name: 'Page',
    kind: 'component',
    what: "The Tool's page: the app's gutter and a steady gap between blocks.",
    when: 'The root of every Tool. Put Toolbar, StatRow, tables and boards straight inside it.',
    props: "width?: 'wide' | 'normal' · className?",
    snippet: `<Page>\n  <StatRow><Stat label="Open" value={12} /></StatRow>\n</Page>`,
    imports: ['StatRow', 'Stat'],
  },
  {
    name: 'Toolbar',
    kind: 'component',
    what: 'One row over a list: search · filters · view switch · the primary action.',
    when: 'Above every list, table or board. The view switch is for two looks at the SAME rows (Board · Table); separate screens are sections.',
    props: 'search? · onSearch? · views?: {value,label}[] · view? · onView? · filters? · actions?',
    snippet: `<Toolbar search="" onSearch={() => {}} views={[{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }]} view="board" onView={() => {}} actions={<Button variant="primary">New deal</Button>} />`,
    imports: ['Button'],
  },
  {
    name: 'StatRow',
    kind: 'component',
    what: 'Two to five Stats in a row over a hairline, stacking when narrow.',
    when: 'The top of a dashboard or a list: the numbers that matter, before the rows.',
    props: 'children: Stat[]',
    snippet: `<StatRow>\n  <Stat label="Pipeline" value="$420k" delta={12} deltaLabel="12%" />\n  <Stat label="Won" value={8} />\n</StatRow>`,
    imports: ['Stat'],
  },
  {
    name: 'Stat',
    kind: 'component',
    what: 'One number over its label, with an optional change and a muted hint.',
    when: 'Inside a StatRow; a total, a count, a rate.',
    props: 'label · value · delta? · deltaLabel? · invert? · icon?: IconName · hint?',
    snippet: `<Stat label="Overdue" value={3} icon="clock" hint="of 24 open" />`,
  },
  {
    name: 'Progress',
    kind: 'component',
    what: 'A thin bar filled to a share, with an optional label and percent.',
    when: 'Goals, capacity, a key result, a budget spent.',
    props: 'value · max? · hue?: Hue · label?',
    snippet: `<Progress value={7} max={10} label="Hiring plan" hue="green" />`,
  },
  {
    name: 'ListDetail',
    kind: 'component',
    what: 'A list on the left and the chosen item on the right, a hairline between.',
    when: 'Anything read one at a time: an inbox, a wiki, a directory, applicants.',
    props: 'items · itemKey · selected · onSelect · renderItem(item, selected) · detail · listHeader? · empty?',
    snippet: `<ListDetail items={[{ id: 'a', name: 'Ana' }]} itemKey={(p) => p.id} selected="a" onSelect={() => {}} renderItem={(p) => <span className="text-sm">{p.name}</span>} detail={<p>Ana</p>} />`,
  },
  {
    name: 'MonthCalendar',
    kind: 'component',
    what: "A month grid with each day's items as coloured rows; ‹ Today › step the month.",
    when: 'Anything with a date that people plan around: content, rota, launches, leave.',
    props: 'month: YYYY-MM-DD · onMonth · items: {id,date,title,hue?}[] · onOpen? · onDay? · rolling? (weeks from last week, for due dates)',
    snippet: `<MonthCalendar month={todayIso()} onMonth={() => {}} items={[{ id: '1', date: todayIso(), title: 'Launch', hue: 'violet' }]} />`,
    imports: ['todayIso'],
  },
  {
    name: 'Icon',
    kind: 'component',
    what: 'A stroke icon by name, in the current colour.',
    when: 'Use the same icons as the Visvine app. For a custom rail icon, call set_tool_icon with SVG markup or an uploaded SVG resource_id.',
    props: 'name: IconName (plus, search, calendar, users, dollar, chart, star, …) · size?',
    snippet: `<Icon name="calendar" className="text-fg-muted" />`,
  },
  // ── records by schema ──
  {
    name: 'FieldValue',
    kind: 'component',
    what: "One field's value drawn for reading: a chip, money, a relative date, a person.",
    when: 'In any cell, card or detail page — so every Tool draws a status or a sum the same way.',
    props: 'field: FieldDef · value · compact?',
    snippet: `<FieldValue field={{ key: 'due', label: 'Due', kind: 'date' }} value="2026-10-01" />`,
  },
  {
    name: 'FieldInput',
    kind: 'component',
    what: "One field's control, chosen by its kind.",
    when: 'An inline edit. For a whole record use RecordForm.',
    props: 'field: FieldDef · value · onChange(value)',
    snippet: `<FieldInput field={{ key: 'stage', label: 'Stage', kind: 'select', options: [{ value: 'Lead' }, { value: 'Won' }] }} value="Lead" onChange={() => {}} />`,
  },
  {
    name: 'RecordForm',
    kind: 'component',
    what: 'Every field of a record, two to a row, from the schema.',
    when: 'Inside your own dialog or page. RecordDialog is this in a Modal with Save.',
    props: 'fields: FieldDef[] · value · onChange · errors? · people? · example?',
    snippet: `<RecordForm fields={[{ key: 'name', label: 'Name', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }]} value={{}} onChange={() => {}} />`,
  },
  {
    name: 'RecordDialog',
    kind: 'component',
    what: "A record's form in the app's dialog with Save, Cancel and Delete.",
    when: 'Adding or editing one record — the band action opens it empty, a row opens it filled.',
    props: 'open · title · fields · initial · onClose · onSave(value) · onDelete? · saveLabel? · people? (peopleOf(fields, rows): a picker for person fields) · example? (a sample row: "e.g." placeholders)',
    snippet: `<RecordDialog open={false} title="New deal" fields={[{ key: 'name', label: 'Name', kind: 'text', required: true }]} initial={{}} onClose={() => {}} onSave={() => {}} />`,
  },
  {
    name: 'RecordTable',
    kind: 'component',
    what: 'A sortable table of collection rows, one column per field, the first bold.',
    when: 'The table view of any list of records.',
    props: 'fields · rows: {id,data}[] · onOpen? · empty? · trailing? · maxHeight?',
    snippet: `<RecordTable fields={[{ key: 'name', label: 'Name', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }]} rows={[{ id: '1', data: { name: 'Acme', value: 12000 } }]} />`,
  },
  {
    name: 'RecordBoard',
    kind: 'component',
    what: "A board with a column per option of a select field; dragging a card sets it.",
    when: 'Anything that moves through stages: deals, hiring, bugs, content, tasks.',
    props: 'fields · groupBy · rows · onMove(row, value) · onOpen? · cardFields? · sumField?',
    snippet: `<RecordBoard fields={[{ key: 'name', label: 'Name', kind: 'text' }, { key: 'stage', label: 'Stage', kind: 'select', options: [{ value: 'Lead' }, { value: 'Won' }] }]} groupBy="stage" rows={[{ id: '1', data: { name: 'Acme', stage: 'Lead' } }]} onMove={() => {}} />`,
  },
  {
    name: 'SampleData',
    kind: 'component',
    what: 'One Sample data label with a Clear action for seeded demonstration rows.',
    when: 'Once per page while sample rows remain — it draws itself at the foot; never prefix each record title.',
    props: 'state: the return value of useSampleRows(collection, rows)',
    snippet: `<SampleData state={{ seeding: false, hasSamples: true, clear: async () => {} }} />`,
  },
  {
    name: 'RecordsEmpty',
    kind: 'component',
    what: 'An empty list with its one way out: "No deals yet" and Add deal.',
    when: "In place of a list, table or board that has no rows.",
    props: 'noun (plural) · onAdd?',
    snippet: `<RecordsEmpty noun="deals" onAdd={() => {}} />`,
  },
  {
    name: 'HueChip',
    kind: 'component',
    what: 'A soft coloured label in one of the app\'s hues.',
    when: 'A status, a stage, a tag. FieldValue draws one for a select field on its own.',
    props: "hue?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | … · children",
    snippet: `<HueChip hue="green">Won</HueChip>`,
  },
  {
    name: 'PersonAvatar',
    kind: 'component',
    what: "A person's initials on their own hue, the same everywhere their name is drawn.",
    when: 'Beside a name in a list, a card or a ranking. FieldValue draws one for a person field on its own.',
    props: "name · size?: 'xs' | 'sm' | 'md'",
    snippet: `<PersonAvatar name="Ana Silva" size="sm" />`,
  },
  {
    name: 'HueDot',
    kind: 'component',
    what: 'A small round swatch of a hue.',
    when: 'Beside a column title or a legend row.',
    props: 'hue?',
    snippet: `<HueDot hue="violet" />`,
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
  {
    name: 'useSampleRows',
    kind: 'hook',
    what: 'Puts sample rows into an empty collection the first time the Tool opens.',
    when: 'Every Tool over a collection: the first look is the Tool working. `clear()` removes exactly those rows.',
    props: 'useSampleRows(collection, rows) → { seeding, hasSamples, clear }',
    snippet: `const { clear } = useSampleRows('deals', [{ name: 'Acme', stage: 'Lead', value: 12000 }])\nvoid clear`,
  },
]

/** Everything a Tool author can reach for: the kit's own, then the app's. */
export const TOOL_CATALOG: readonly CatalogEntry[] = [...KIT_CATALOG, ...UI_CATALOG]

/** The rules a Tool keeps to look like the app — the same ones the app keeps. */
const TOOL_DESIGN_RULES: readonly string[] = [
  'Build from blocks, not from divs. A page is `Page` holding a `Toolbar`, a `StatRow`, and a `RecordBoard` / `RecordTable` / `ListDetail` / `MonthCalendar` over rows described once as `FieldDef[]`; adding and editing is `RecordDialog`. Write your own layout only for what no block draws.',
  'Never an empty first look: seed a collection with 8–15 fictional, realistic rows through `useSampleRows` (plausible people, complete fields, dates around today). `SampleData` labels them once and offers Clear; no Sample/Example prefixes in names. Preserve the demo rows at hand-over and remove only temporary interaction-test rows.',
  'The app draws the chrome. The rail row, the band (your sections as tabs, your band buttons, the ⋯ menu) and every state are the app\'s. Draw only content: never a page title, a top tab strip or a header that repeats what the band says.',
  'Lay out with Tailwind classes: grid, flex, gap, padding, widths and text sizes (with sm:/md:/lg: variants) are all compiled in, and the role colours (`text-fg-muted`, `bg-surface-subtle`, `border-line-subtle`, `bg-accent`). A grid of cards is `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`.',
  'Flat surfaces: sections separated by hairlines, no cards around everything, no shadows except on things that float.',
  'Labels name, they do not explain: one to three words. No sentence under a field, no caption explaining a screen — if a screen needs text to explain itself, change the screen.',
  'Say only the exceptional. Hide an empty section rather than captioning it; show a warning only when something is actually wrong.',
  'State is data, joined by ·: `12 open · 3 overdue · updated 5m ago`, one muted line.',
  'Colour comes from the theme: the kit, or `var(--vv-*)` in your own styles — never a hex, never a painted page background (the frame is transparent over the app\'s own).',
  'Full bleed. The frame IS the page: the root fills it with the app\'s page gutter (`px-6 py-5`) and nothing else — never an outer border, a rounded box, a card or a max-width container around the whole Tool.',
  'Views are sections. Two or more screens (a board and a detail, companies and predictions) are `surfaces.nav` sections read with `useSection` — the app draws them as tabs on its band. Never draw your own tab strip at the top of the frame. Two looks at the SAME rows (Board · Table) are the Toolbar\'s view switch.',
  'The main act is always one press away. A Tool that adds things declares that act in `surfaces.actions` and handles it with `useBandAction`, so it works on the first item and the fiftieth — an empty state may offer it too, never only there.',
  'Pick the control for the data. A known set of values is a Select (or Segmented for two to five shown at once), a date a DatePicker, a yes/no a Toggle, a share of a whole a PieChart, a tally a BarChart — free text only for what is truly free.',
  'The page scrolls. The frame grows to the Tool\'s height up to the pane and then scrolls, so let content take its natural height: never squeeze a screen to fit (`h-full`, `h-screen`, `overflow-hidden` on the root, flex children forced to share one viewport). A long list is just long.',
  'One size, one shape. Sizes come from the kit and Tailwind\'s scale (text-sm body, text-xs muted meta, controls at their own height), and a thing drawn in two places is drawn by one component: a piece used twice — a legend row, a vote bar, a company header — is a component in `src/<module>.tsx` imported by both, never copied.',
  'Lay out by importance: the main act and the numbers that matter at the top, supporting detail below; a large chart beside its legend on wide screens (`lg:grid-cols-2`), stacked on narrow ones — never a chart alone in a wide empty band.',
  'No 100vh and no position: fixed — they measure the frame, not the window. A dialog is the kit\'s Modal, which the app extends over the whole page.',
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
