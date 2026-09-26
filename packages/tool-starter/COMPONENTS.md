<!-- Generated from the Visvine server’s own SDK docs — edits here are overwritten. -->

# The kit's components

What a Tool draws with: the app's own components and the kit's data-bound
ones, on the same tokens — so a Tool looks like the rest of Visvine by
default, and follows the viewer's theme. `npx visvine-tool dev` draws every
one of them under **Components**. A Tool may choose its own look when the
person it is for asks for one; these are the default, not a wall.

## Design rules

- Build from blocks, not from divs. A page is `Page` holding a `Toolbar`, a `StatRow`, and a `RecordBoard` / `RecordTable` / `ListDetail` / `MonthCalendar` over rows described once as `FieldDef[]`; adding and editing is `RecordDialog`. Write your own layout only for what no block draws.
- Never an empty first look: seed a collection with 8–15 fictional, realistic rows through `useSampleRows` (plausible people, complete fields, dates around today). `SampleData` labels them once and offers Clear; no Sample/Example prefixes in names. Preserve the demo rows at hand-over and remove only temporary interaction-test rows.
- The app draws the chrome. The rail row, the band (your sections as tabs, your band buttons, the ⋯ menu) and every state are the app's. Draw only content: never a page title, a top tab strip or a header that repeats what the band says.
- Lay out with Tailwind classes: grid, flex, gap, padding, widths and text sizes (with sm:/md:/lg: variants) are all compiled in, and the role colours (`text-fg-muted`, `bg-surface-subtle`, `border-line-subtle`, `bg-accent`). A grid of cards is `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`.
- Flat surfaces: sections separated by hairlines, no cards around everything, no shadows except on things that float.
- Labels name, they do not explain: one to three words. No sentence under a field, no caption explaining a screen — if a screen needs text to explain itself, change the screen.
- Say only the exceptional. Hide an empty section rather than captioning it; show a warning only when something is actually wrong.
- State is data, joined by ·: `12 open · 3 overdue · updated 5m ago`, one muted line.
- Colour comes from the theme: the kit, or `var(--vv-*)` in your own styles — never a hex, never a painted page background (the frame is transparent over the app's own).
- Full bleed. The frame IS the page: the root fills it with the app's page gutter (`px-6 py-5`) and nothing else — never an outer border, a rounded box, a card or a max-width container around the whole Tool.
- Views are sections. Two or more screens (a board and a detail, companies and predictions) are `surfaces.nav` sections read with `useSection` — the app draws them as tabs on its band. Never draw your own tab strip at the top of the frame. Two looks at the SAME rows (Board · Table) are the Toolbar's view switch.
- The main act is always one press away. A Tool that adds things declares that act in `surfaces.actions` and handles it with `useBandAction`, so it works on the first item and the fiftieth — an empty state may offer it too, never only there.
- Pick the control for the data. A known set of values is a Select (or Segmented for two to five shown at once), a date a DatePicker, a yes/no a Toggle, a share of a whole a PieChart, a tally a BarChart — free text only for what is truly free.
- The page scrolls. The frame grows to the Tool's height up to the pane and then scrolls, so let content take its natural height: never squeeze a screen to fit (`h-full`, `h-screen`, `overflow-hidden` on the root, flex children forced to share one viewport). A long list is just long.
- One size, one shape. Sizes come from the kit and Tailwind's scale (text-sm body, text-xs muted meta, controls at their own height), and a thing drawn in two places is drawn by one component: a piece used twice — a legend row, a vote bar, a company header — is a component in `src/<module>.tsx` imported by both, never copied.
- Lay out by importance: the main act and the numbers that matter at the top, supporting detail below; a large chart beside its legend on wide screens (`lg:grid-cols-2`), stacked on narrow ones — never a chart alone in a wide empty band.
- No 100vh and no position: fixed — they measure the frame, not the window. A dialog is the kit's Modal, which the app extends over the whole page.
- A Tool may choose its own look when a person asks for one. These rules are the default, not a wall.

## Components

### Stack

Vertical or horizontal spacing between children. Every screen: the page is a column of sections; a row of buttons is a Stack in a row.

Props: direction?: 'column' | 'row' · gap?: 'sm' | 'md' | 'lg' · wrap?

```tsx
<Stack gap="md">
  <p>First</p>
  <p>Second</p>
</Stack>
```

### PageHeader

A section's title with its actions at the trailing end. Only inside the frame for a sub-view. The band already names the Tool and its section — never repeat the page title.

Props: title · description? · actions?

```tsx
<PageHeader title="This week" actions={<Button size="sm">Export</Button>} />
```

### Card

A section with an optional title and actions, set off by a hairline. To group part of a page. The app is flat — a section, not a box.

Props: title? · actions? · flush?

```tsx
<Card title="Totals">
  <p>12 open</p>
</Card>
```

### Tabs

A tab strip inside the frame. For a switch INSIDE one section. A Tool's own sections belong in `surfaces.nav`, which the app draws on its band — never a tab strip at the top of the frame.

Props: tabs: { id, label }[] · active · onChange(id)

```tsx
<Tabs tabs={[{ id: 'open', label: 'Open' }, { id: 'done', label: 'Done' }]} active="open" onChange={() => {}} />
```

### EmptyState

What a list shows when there is nothing in it. Only where empty is exceptional. The app hides an empty section rather than captioning it.

Props: title · description? · action?

```tsx
<EmptyState title="No deals" />
```

### Spinner

A small loading indicator. While a query is loading and there is nothing to show yet.

Props: size?: 'sm' | 'lg' · label?

```tsx
<Spinner />
```

### Banner

A notice with a tone — the app's rule-and-words notice, with a title and an action. Only when something is actually wrong or needs a decision. A normal state is silent.

Props: tone?: 'info' | 'success' | 'warn' | 'danger' · title? · action?

```tsx
<Banner tone="warn" title="Two deals have no owner" />
```

### Chip

The app's chip: a small label for a status or a type, muted or in a tone. A row's status or type, the way the Directory labels a record.

Props: tone?: 'neutral' | 'accent' | 'danger' | 'warn' | 'info'

```tsx
<Chip tone="accent">Won</Chip>
```

### Button

The app's button. Labels are one to three words that name the act: Save, Run now, New deal. One primary per view.

Props: variant?: 'primary' | 'secondary' | 'ghost' | 'danger' · size?: 'sm' | 'md' · loading? · loadingText? · any button attribute

```tsx
<Button variant="primary" onClick={() => {}}>Save</Button>
```

### Field

A label over an input, with an error line. Every form row. The label names; it does not explain — no sentence under an input.

Props: label · htmlFor? · error?

```tsx
<Field label="Owner" htmlFor="owner">
  <Input id="owner" />
</Field>
```

### Input

A text input styled like the app’s. Any single-line value. Never a password — a Tool never asks for one, and the checks block it.

Props: any input attribute

```tsx
<Input placeholder="Search" onChange={() => {}} />
```

### Textarea

A multi-line input. A note or a comment.

Props: any textarea attribute

```tsx
<Textarea rows={3} aria-label="Note" />
```

### Select

The app's dropdown: a field that opens the app's own menu, not the browser's. Any field whose values are a known set — a stage, a round, a status. Never an Input for these: declare the set as the field's `enum` and draw it here. Never a raw `<select>`: it opens the system menu, not the app's.

Props: options?: { value, label }[] · value · onValueChange(value) · onChange(e) (e.target.value, as a native select) · placeholder? · disabled? · id? · name?

```tsx
<Select options={[{ value: 'lead', label: 'Lead' }, { value: 'won', label: 'Won' }]} onValueChange={() => {}} />
```

### Swatch

A round colour dot — the one mark for "this colour means this thing". A legend row, a series key, a status beside its label. The chart legends draw the same dot, so never draw your own circle or square for a colour.

Props: color: string · size?: 'sm' | 'md'

```tsx
<span className="flex items-center gap-2"><Swatch color="var(--vv-accent)" /> Yes</span>
```

### Segmented

Joined buttons, one of which is on. Two to five values seen at once — a vote on a scale, a view switch, a filter. More than five, or a form field, is a Select.

Props: options: { value, label }[] · value: string | null · onChange(value) · label · disabled?

```tsx
<Segmented label="Vote" value={null} onChange={() => {}} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
```

### Modal

A dialog over the page, with the app's gutter on its body and its buttons in a footer. An add or edit form: Fields straight in it (short ones in a grid), buttons in `footer`. Open it from a band button (`surfaces.actions`) so it opens every time, not only from an empty state.

Props: onClose · open? · title? · footer? · size?: 'sm' | 'md' | 'lg'

```tsx
<Modal
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
</Modal>
```

### DatePicker

A date input with an ISO value. Any date field.

Props: value: string | null · onChange(value) · min? · max?

```tsx
<DatePicker value={null} onChange={() => {}} />
```

### ImageUpload

A picture the viewer adds — a logo, a photo — into the Drive, as them. A row that carries an image. Declare the folder in permissions.resources.write (and read), store the id in a `format: resource` field.

Props: value: string | null · onChange(resourceId) · label · folder? · shape?: 'square' | 'circle' · size?

```tsx
<ImageUpload label="Logo" value={null} onChange={() => {}} />
```

### ResourceImage

A picture from the Drive by id, or the initials of what it is of. Drawing a stored logo or photo in a list or a header. It falls back to initials, so a row without one still lines up.

Props: id · alt · shape?: 'square' | 'circle' · size?

```tsx
<ResourceImage id={null} alt="Azonic" size={40} />
```

### Table

Rows under column headers. A short list of records with a few facts each.

Props: columns: { key, header, render(row) }[] · rows · rowKey(row) · onRowClick?

```tsx
<Table
  columns={[{ key: 'title', header: 'Title', render: (row: { title: string }) => row.title }]}
  rows={[{ title: 'Acme' }]}
  rowKey={(row) => row.title}
/>
```

### DataTable

A table that sorts and virtualises. The Directory's table shape: many records, sortable columns.

Props: Table's props · sortable columns · defaultSort? · maxHeight? · virtualize?

```tsx
<DataTable
  columns={[{ key: 'title', header: 'Title', render: (row: { title: string }) => row.title, sortable: true }]}
  rows={[{ title: 'Acme' }]}
  rowKey={(row) => row.title}
/>
```

### KanbanBoard

Columns of cards a person drags between. Records that move through stages. A move is yours to write — usually a `context.write` of the note's status.

Props: onMove({ cardId, fromColumnId, toColumnId, index }) · children: KanbanColumn

```tsx
<KanbanBoard onMove={() => {}}>
  <KanbanColumn id="lead" title="Lead">
    <KanbanCard id="acme">Acme</KanbanCard>
  </KanbanColumn>
</KanbanBoard>
```

### KanbanColumn

One column of a KanbanBoard. Inside a KanbanBoard.

Props: id · title · count? · actions? · empty?

```tsx
<KanbanBoard onMove={() => {}}>
  <KanbanColumn id="won" title="Won" count={0} />
</KanbanBoard>
```

### KanbanCard

One draggable card. Inside a KanbanColumn.

Props: id · onClick?

```tsx
<KanbanBoard onMove={() => {}}>
  <KanbanColumn id="lead" title="Lead">
    <KanbanCard id="acme" onClick={() => {}}>Acme</KanbanCard>
  </KanbanColumn>
</KanbanBoard>
```

### Markdown

A note body rendered the way the app renders notes, sanitised. Showing what a note says.

Props: source · onLinkClick?

```tsx
<Markdown source="**Acme** signed." />
```

### LineChart

A line chart in the app's chart palette. A value over time.

Props: data · x · series: (key | { key, label?, color? })[] · height? · formatValue?

```tsx
<LineChart data={[{ week: 'W1', deals: 3 }, { week: 'W2', deals: 5 }]} x="week" series={['deals']} />
```

### BarChart

A bar chart in the app's chart palette. Comparing a few counts.

Props: LineChart's props · stacked?

```tsx
<BarChart data={[{ stage: 'Lead', n: 4 }, { stage: 'Won', n: 2 }]} x="stage" series={['n']} />
```

### AreaChart

An area chart in the app's chart palette. A total over time made of parts.

Props: LineChart's props · stacked?

```tsx
<AreaChart data={[{ m: 'Jan', a: 1, b: 2 }]} x="m" series={['a', 'b']} stacked />
```

### PieChart

A pie or donut in the app's chart palette. Shares of a whole, five slices or fewer — with the counts listed beside it, in a parent with a width (`w-28 shrink-0`). See the tool_charts guide.

Props: data · nameKey · valueKey · donut?

```tsx
<PieChart data={[{ name: 'Won', n: 2 }, { name: 'Lost', n: 1 }]} nameKey="name" valueKey="n" donut />
```

### Recharts

The chart library itself, for a chart the four above do not draw. Rarely. Colour it with `useChartColors()` so it matches.

Props: the Recharts namespace

```tsx
<Recharts.ResponsiveContainer width="100%" height={120}>
  <Recharts.LineChart data={[{ x: 1, y: 2 }]}>
    <Recharts.Line dataKey="y" />
  </Recharts.LineChart>
</Recharts.ResponsiveContainer>
```

### Page

The Tool's page: the app's gutter and a steady gap between blocks. The root of every Tool. Put Toolbar, StatRow, tables and boards straight inside it.

Props: width?: 'wide' | 'normal' · className?

```tsx
<Page>
  <StatRow><Stat label="Open" value={12} /></StatRow>
</Page>
```

### Toolbar

One row over a list: search · filters · view switch · the primary action. Above every list, table or board. The view switch is for two looks at the SAME rows (Board · Table); separate screens are sections.

Props: search? · onSearch? · views?: {value,label}[] · view? · onView? · filters? · actions?

```tsx
<Toolbar search="" onSearch={() => {}} views={[{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }]} view="board" onView={() => {}} actions={<Button variant="primary">New deal</Button>} />
```

### StatRow

Two to five Stats in a row over a hairline, stacking when narrow. The top of a dashboard or a list: the numbers that matter, before the rows.

Props: children: Stat[]

```tsx
<StatRow>
  <Stat label="Pipeline" value="$420k" delta={12} deltaLabel="12%" />
  <Stat label="Won" value={8} />
</StatRow>
```

### Stat

One number over its label, with an optional change and a muted hint. Inside a StatRow; a total, a count, a rate.

Props: label · value · delta? · deltaLabel? · invert? · icon?: IconName · hint?

```tsx
<Stat label="Overdue" value={3} icon="clock" hint="of 24 open" />
```

### Progress

A thin bar filled to a share, with an optional label and percent. Goals, capacity, a key result, a budget spent.

Props: value · max? · hue?: Hue · label?

```tsx
<Progress value={7} max={10} label="Hiring plan" hue="green" />
```

### ListDetail

A list on the left and the chosen item on the right, a hairline between. Anything read one at a time: an inbox, a wiki, a directory, applicants.

Props: items · itemKey · selected · onSelect · renderItem(item, selected) · detail · listHeader? · empty?

```tsx
<ListDetail items={[{ id: 'a', name: 'Ana' }]} itemKey={(p) => p.id} selected="a" onSelect={() => {}} renderItem={(p) => <span className="text-sm">{p.name}</span>} detail={<p>Ana</p>} />
```

### MonthCalendar

A month grid with each day's items as coloured rows; ‹ Today › step the month. Anything with a date that people plan around: content, rota, launches, leave.

Props: month: YYYY-MM-DD · onMonth · items: {id,date,title,hue?}[] · onOpen? · onDay?

```tsx
<MonthCalendar month={todayIso()} onMonth={() => {}} items={[{ id: '1', date: todayIso(), title: 'Launch', hue: 'violet' }]} />
```

### Icon

A stroke icon by name, in the current colour. Use the same icons as the Visvine app. For a custom rail icon, call set_tool_icon with SVG markup or an uploaded SVG resource_id.

Props: name: IconName (plus, search, calendar, users, dollar, chart, star, …) · size?

```tsx
<Icon name="calendar" className="text-fg-muted" />
```

### FieldValue

One field's value drawn for reading: a chip, money, a relative date, a person. In any cell, card or detail page — so every Tool draws a status or a sum the same way.

Props: field: FieldDef · value · compact?

```tsx
<FieldValue field={{ key: 'due', label: 'Due', kind: 'date' }} value="2026-10-01" />
```

### FieldInput

One field's control, chosen by its kind. An inline edit. For a whole record use RecordForm.

Props: field: FieldDef · value · onChange(value)

```tsx
<FieldInput field={{ key: 'stage', label: 'Stage', kind: 'select', options: [{ value: 'Lead' }, { value: 'Won' }] }} value="Lead" onChange={() => {}} />
```

### RecordForm

Every field of a record, two to a row, from the schema. Inside your own dialog or page. RecordDialog is this in a Modal with Save.

Props: fields: FieldDef[] · value · onChange · errors?

```tsx
<RecordForm fields={[{ key: 'name', label: 'Name', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }]} value={{}} onChange={() => {}} />
```

### RecordDialog

A record's form in the app's dialog with Save, Cancel and Delete. Adding or editing one record — the band action opens it empty, a row opens it filled.

Props: open · title · fields · initial · onClose · onSave(value) · onDelete? · saveLabel?

```tsx
<RecordDialog open={false} title="New deal" fields={[{ key: 'name', label: 'Name', kind: 'text', required: true }]} initial={{}} onClose={() => {}} onSave={() => {}} />
```

### RecordTable

A sortable table of collection rows, one column per field, the first bold. The table view of any list of records.

Props: fields · rows: {id,data}[] · onOpen? · empty? · trailing? · maxHeight?

```tsx
<RecordTable fields={[{ key: 'name', label: 'Name', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }]} rows={[{ id: '1', data: { name: 'Acme', value: 12000 } }]} />
```

### RecordBoard

A board with a column per option of a select field; dragging a card sets it. Anything that moves through stages: deals, hiring, bugs, content, tasks.

Props: fields · groupBy · rows · onMove(row, value) · onOpen? · cardFields? · sumField?

```tsx
<RecordBoard fields={[{ key: 'name', label: 'Name', kind: 'text' }, { key: 'stage', label: 'Stage', kind: 'select', options: [{ value: 'Lead' }, { value: 'Won' }] }]} groupBy="stage" rows={[{ id: '1', data: { name: 'Acme', stage: 'Lead' } }]} onMove={() => {}} />
```

### SampleData

One Sample data label with a Clear action for seeded demonstration rows. Once at the top of each page while sample rows remain; never prefix each record title.

Props: state: the return value of useSampleRows(collection, rows)

```tsx
<SampleData state={{ seeding: false, hasSamples: true, clear: async () => {} }} />
```

### RecordsEmpty

An empty list with its one way out: "No deals yet" and Add deal. In place of a list, table or board that has no rows.

Props: noun (plural) · onAdd?

```tsx
<RecordsEmpty noun="deals" onAdd={() => {}} />
```

### HueChip

A soft coloured label in one of the app's hues. A status, a stage, a tag. FieldValue draws one for a select field on its own.

Props: hue?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | … · children

```tsx
<HueChip hue="green">Won</HueChip>
```

### PersonAvatar

A person's initials on their own hue, the same everywhere their name is drawn. Beside a name in a list, a card or a ranking. FieldValue draws one for a person field on its own.

Props: name · size?: 'xs' | 'sm' | 'md'

```tsx
<PersonAvatar name="Ana Silva" size="sm" />
```

### HueDot

A small round swatch of a hue. Beside a column title or a legend row.

Props: hue?

```tsx
<HueDot hue="violet" />
```

### Alert

A notice: a 2px rule in its colour down the left, then the words. Only when something is actually wrong or needs saying once — a normal state is silent. In the app: admin, agents, connectors and 8 more.

Props: variant?: 'error' | 'info' | 'warning' | 'success' · onDismiss?: () => void · inline?: boolean

```tsx
<Alert variant="warning">Two deals have no owner.</Alert>
```

### Avatar

A person's (or a space's) picture, falling back to a silhouette or initials. Beside a name in a list or a record — the Directory and messages draw people this way. In the app: admin, agents, connectors and 6 more.

Props: name: string · imageUrl?: string | null · size?: 'xs' | 'sm' | 'md' | 'chip' | 'lg' | 'xl' · accentColor?: string · fallback?: 'silhouette' | 'initials' | 'space' · sizeClassName?: string · pixelSize?: number

```tsx
<Avatar name="Ada Lovelace" size="sm" />
```

### Checkbox

The platform's own checkbox, painted in the accent (`accent-color`). A choice that joins a set. A setting that switches something on is a Toggle. In the app: events, resources, shared.

Props: checked: boolean · onChange: (checked: boolean) => void · label?: ReactNode · indeterminate?: boolean · disabled?: boolean · invalid?: boolean · size?: 'sm' | 'md' · 'aria-label'?: string

```tsx
<Checkbox checked={false} onChange={() => {}} label="Include archived" />
```

### ConfirmDialog

A modal that asks before a destructive or irreversible act, and can make the person type a name first. Before anything destructive or irreversible. Pass confirmText for the most dangerous. In the app: admin, connectors, directory and 9 more.

Props: open: boolean · title: string · body?: React.ReactNode · confirmLabel?: string · destructive?: boolean · confirmText?: string · error?: React.ReactNode · closeOnBackdrop?: boolean · closeOnEscape?: boolean · onConfirm: () => void | Promise<void> · onClose: () => void

```tsx
<ConfirmDialog open={false} title="Delete this deal?" confirmLabel="Delete" destructive onConfirm={() => {}} onClose={() => {}} />
```

### IconButton

A square, quiet button that is only an icon: the label is its name for a screen reader and its title under the pointer. A toolbar action that is only an icon; its label is its name for a screen reader. In the app: resources, tools.

Props: label: string · icon: ReactNode · size?: 'sm' | 'md' · active?: boolean

```tsx
<IconButton label="More" onClick={() => {}} icon={<span aria-hidden>⋯</span>} />
```

### LoadingText

A centred, muted "Loading…" line for a view that has nothing to show yet. Instead of a spinner when a whole view is waiting. In the app: admin, pages.

Props: text?: string

```tsx
<LoadingText />
```

### Menu

A small popover of actions under a trigger — the overflow (…) of a toolbar. The overflow (⋯) of a row or a toolbar — actions that do not earn a button of their own. In the app: messages, resources, tools.

Props: trigger: (props: { open: boolean; toggle: () => void; … · items: MenuItem[] · align?: 'start' | 'end' · placement?: 'below' | 'above' · label: string

```tsx
<Menu label="Deal actions" items={[{ id: 'archive', label: 'Archive', onSelect: () => {} }]} trigger={({ toggle }) => <button type="button" onClick={toggle}>⋯</button>} />
```

### Row

Children side by side, a fixed step apart, centred on one line. A row of buttons, a label beside its control, a chip beside a name.

Props: gap?: 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 4 | 5 | 6 |… · align?: 'start' | 'center' | 'end' | 'stretch' | 'bas… · justify?: 'start' | 'center' | 'end' | 'between' · wrap?: boolean · as?: ElementType

```tsx
<Row gap={2}>
  <span>Left</span>
  <span>Right</span>
</Row>
```

### SearchInput

A text input with a search glyph and a clear button. Above a list that filters as you type — the Directory and the pickers. In the app: admin, connectors, directory and 4 more.

Props: value: string · onChange: (value: string) => void · placeholder?: string · autoFocus?: boolean · icon?: React.ReactNode · size?: 'sm' | 'md' | 'lg'

```tsx
<SearchInput value="" onChange={() => {}} placeholder="Search deals" />
```

### SettingsSection

A flat settings section: a small bold heading, a muted line, and a hairline between siblings. A Tool's own settings view: small heading, one muted line, hairlines between sections, no card. In the app: admin, pages, settings.

Props: title: React.ReactNode · description?: React.ReactNode · action?: React.ReactNode · flush?: boolean · large?: boolean

```tsx
<SettingsSection title="Pipeline">
  <p>Stages</p>
</SettingsSection>
```

### Skeleton

A single shimmering placeholder block. The shape of rows while they load, so the page does not jump when they arrive. In the app: connectors, directory, discover and 5 more.

Props: className — its size and shape

```tsx
<Skeleton className="h-4 w-1/3 rounded" />
```

### Toggle

Standard toggle switch — one size everywhere (40×24px track, 16px thumb). A setting that switches something on — beside the title it controls, never a second row saying the same. In the app: admin, agents, connectors and 5 more.

Props: checked: boolean · onChange: (checked: boolean) => void · label?: React.ReactNode · disabled?: boolean · 'aria-label'?: string

```tsx
<Toggle checked={false} onChange={() => {}} aria-label="Show closed" />
```

## Hooks

### useVisvine

The bridge: notes, records, files, connectors, agents, actions, the space's AI, state, the host's dialogs. Every Tool that touches the space. Everything it reaches is inside the permissions its manifest declares, bound to this space.

Props: context.list/read/search/write/append/links · records.query/get/update · resources.list/get/read/blob · connectors.call · agents.run · actions.run · ai.complete/decide · collections.insert/list/get/update/delete/count (useCollection, useCollectionCount) · data.call · state.get/set (per viewer by default) · ui.toast/confirm/download/openRecord/openResource · install.settings/bindings · viewer · navigate(path)

```tsx
const visvine = useVisvine()
```

### useQuery

Run a bridge read when its inputs change; hand back data, error, loading and reload. Every read that feeds the screen.

Props: useQuery(fn, deps) → { data, error, loading, reload }

```tsx
const visvine = useVisvine()
const notes = useQuery(() => visvine.context.list('deals/**'), [])
```

### useLiveQuery

useQuery that reloads when a note inside the perimeter changes. A board or list others edit while it is open.

Props: useLiveQuery(fn, deps, { paths?, pollMs? })

```tsx
const visvine = useVisvine()
const notes = useLiveQuery(() => visvine.context.list('deals/**'), [], { paths: ['deals/**'] })
```

### usePagedList

A list read a page at a time. A folder that may hold more than one page of notes.

Props: usePagedList(glob, { pageSize? }) → { items, loading, hasMore, loadMore, reload }

```tsx
const list = usePagedList('deals/**')
```

### useCollection

A collection's rows, reloaded when anyone's write to it reaches the viewer. The Tool's own data — votes, sign-ups, check-ins — declared under `collections`.

Props: useCollection(name, { where?, mine?, order?, limit? }) → { data: rows, loading, error, reload }

```tsx
const { data: rows } = useCollection('votes', { mine: true })
```

### useCollectionCount

How many rows a collection holds, or its tally per value of one field. A poll's results, a sign-up count.

Props: useCollectionCount(name, { where?, mine?, groupBy? }) → { data: { total, groups? } }

```tsx
const { data: tally } = useCollectionCount('votes', { groupBy: 'choice' })
```

### useSubject

What the Tool is being shown about, on a type page tab; null on its own page. A Tool that claims a tab on a type's page (`surfaces.types`).

Props: useSubject() → { kind, path, type, title } | null

```tsx
const subject = useSubject()
```

### useSection

The active one of the Tool's own sections, and a way to switch it. A Tool that declares `surfaces.nav`. The app draws the sections; the Tool draws the active one's content.

Props: useSection() → [section, go(id)]

```tsx
const [section] = useSection()
```

### useBandAction

Run a handler when a band button the Tool declared is pressed. A Tool that declares `surfaces.actions` — the app draws the button beside the ⋯ menu.

Props: useBandAction(id, handler)

```tsx
useBandAction('new-deal', () => {})
```

### useTheme

The app's theme tokens as CSS custom properties. Rarely — the kit and `var(--vv-*)` already follow the theme.

Props: useTheme() → Record<string, string>

```tsx
const theme = useTheme()
```

### useChartColors

The chart palette, for a chart drawn with Recharts directly. With Recharts.

Props: useChartColors() → string[]

```tsx
const colors = useChartColors()
```

### useSampleRows

Puts sample rows into an empty collection the first time the Tool opens. Every Tool over a collection: the first look is the Tool working. `clear()` removes exactly those rows.

Props: useSampleRows(collection, rows) → { seeding, hasSamples, clear }

```tsx
const { clear } = useSampleRows('deals', [{ name: 'Acme', stage: 'Lead', value: 12000 }])
void clear
```
