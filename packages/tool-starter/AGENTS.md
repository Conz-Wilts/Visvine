<!-- Generated from the Visvine server’s own SDK docs — edits here are overwritten. -->

# Building this Visvine Tool

This folder is a **Visvine Tool**: a small React app that runs inside a
Visvine space, in a sandboxed frame, and reaches the space only through what
its manifest declares. You write it here; Visvine compiles it, checks it and
runs it. Read this file before changing anything — the platform is small and
specific, and guessing it costs a round trip.

## The files

| File | What it is |
| --- | --- |
| `visvine-tool.json` | The manifest — what the Tool is, what it may touch, and the slots each space binds. The same keys the guide below shows as `index.md` frontmatter, here as JSON. |
| `src/ui.tsx` | The entry: `export default` a React component that takes no props. |
| `src/<name>.tsx`, `src/<name>.ts` | More modules — lower-case names with hyphens — imported as `./<name>`. |
| `src/data.js` | Optional handlers, run on Visvine's server in a sandbox: `handlers.<name> = async (args, visvine) => …`, called with `visvine.data.call(name, args)`. Named in the manifest as `entry.data`. |
| `fixtures/` | The offline space `dev` runs it in (below). Never shipped. |
| `README.md` | The Tool's documentation, shown on its About page. |
| `CHANGELOG.md` | Release notes: the newest `## <release>` section rides a publish. |
| `icon.svg` | Optional: its own sidebar glyph (set `surfaces.rail.icon` to `custom`). |

Keep `name` in `visvine-tool.json` as it is: a Tool's name is its identity in
every space, and a new name is a new Tool.

## The loop

1. **Check.** `npx visvine-tool check` builds the Tool with the server's own
   compiler and runs the checks a publish runs, on this machine. Fix every
   error it prints — `file:line:col` points at it — before anything else.
2. **Look.** `npx visvine-tool dev` serves it at http://localhost:4800,
   offline, in the same sandboxed frame and on the same kit it will run on in
   Visvine, answered from `fixtures/`. The page lists every call the Tool makes
   and how it was answered: a `perimeter` refusal means the manifest does not
   declare that reach — declare it, do not work around it. Switch who is
   looking — each person `fixtures/space.json` names, or Admin and Member. `npx visvine-tool dev --space <id>` is the
   live form: every save is pushed and the space's own preview shows it.
3. **Ship.** `npx visvine-tool push` sends it to a space as its working copy
   and prints where to preview it there (`--space <id>`; `npx visvine-tool
   spaces` lists them); `npx visvine-tool publish` publishes a version into
   that space — approved at once for a space admin, waiting for one otherwise.
   Sign in first with `npx visvine-tool login`. Against a Visvine running on
   this machine, add `--server http://localhost:3000`.

With the Visvine MCP server connected (`.mcp.json`), the same acts are the
actions `check_package`, `push_tool` and `publish_tool`.

### Without a browser

Everything the `dev` page does is plain HTTP on its port, so an agent that
cannot click can drive the Tool's data layer itself:

| Request | Answers |
| --- | --- |
| `GET /__state` | The build — `ok`, `errors`, `warnings` — and what the frame is told: `install`, `viewer`, `degraded`. |
| `POST /__bridge` `{"method": "…", "params": {…}}` | One bridge call, answered by the offline space exactly as the Tool's own call would be. |
| `POST /__viewer` `{"id": "…"}` or `{"isAdmin": false}` | Look as another person `space.json` names, or as a member. |

The two POSTs need the header `X-Visvine-Dev: 1`. For example, what
`visvine.collections.list('votes')` gets:

```sh
curl -s localhost:4800/__bridge -H 'X-Visvine-Dev: 1' \
  -d '{"method":"collections.list","params":{"collection":"votes"}}'
```

## Rules that matter

- **Declare before you call.** Every bridge call is checked against the
  manifest's `permissions` before anything is read; an undeclared call fails
  with `perimeter`, in `dev` exactly as in Visvine.
- **Bindings, not paths.** Name the kind of thing the Tool needs in
  `bindings` (`{ kind: folder, suggest: board }`) and use `$slot` in
  permissions; read what a space bound from `visvine.install.bindings`. A path
  written into the code is a path that only exists in one space.
- **Imports:** `react`, `react-dom`, `@visvine/tool-kit`, your own modules
  (`./<name>`), and the curated dependencies the manifest declares. Nothing
  else compiles; there is no npm at runtime.
- **The sandbox:** no network (`fetch` goes nowhere — reach a service through a
  connector), no `localStorage` (use `visvine.state` or a collection), no
  popups, no navigating the frame. Links out go through `visvine.navigate`
  (in-app paths only).
- **The look:** the kit's components (COMPONENTS.md) on the app's theme — flat
  surfaces, hairlines, labels of one to three words, colour only from
  `var(--vv-*)`. The app draws the chrome around the Tool; draw content only.

## Fixtures

`fixtures/` is the space `dev` answers from; `push` never sends it.

| Path | What it holds |
| --- | --- |
| `space.json` | Who is looking — `viewer` (`id`, `name`, `isAdmin`), or several as `viewers`, the first looking first, so a Tool that shows everyone's rows can be seen as each of them — the install's `bindings` and `settings`, and what the outside answers offline: `connectors.<name>.<action>`, `actions.<name>`, `ai.complete`. |
| `notes/<path>.md` | The space's notes — `notes/board/kickoff.md` is the note `board/kickoff.md`. A note with a `type:` is a record of that type. |
| `resources/<path>` | Its files — `resources/contracts/msa.pdf` is a file under `resources/contracts/`. |

What the Tool writes in `dev` — notes, state, collection rows — lives until
the server stops or a fixture changes.

---

# The platform guide

The guide below is the one every Visvine author reads, and it describes a
Tool as the app keeps it: `tools/<name>/index.md` with the manifest in its
frontmatter, beside `ui.tsx` and `data.js`. In this repo the same keys live in
`visvine-tool.json`, `ui.tsx` is `src/ui.tsx` and `data.js` is `src/data.js`.
The types are in `node_modules/@visvine/tool-kit/index.d.ts`.


A Tool is a small React app that runs inside a Visvine space. It renders in the
main content area, reads and writes the space's own notes and records, and can
call the space's connectors, agents, actions and AI — but only what it declares
up front.

Its files are notes in the space, so they have history, permissions and review
like anything else:

```
tools/<name>/index.md        frontmatter = the manifest, body = docs for humans
tools/<name>/ui.tsx          the React component (compiled on write)
tools/<name>/src/<name>.tsx  optional: more modules, imported as './<name>'
tools/<name>/data.js         optional: server-side handlers (sandboxed isolate)
tools/<name>/icon.svg        optional: your own sidebar glyph
```

## index.md — the manifest

```yaml
---
type: tool
title: Deal Pipeline
description: Kanban over deal notes
sdk: ^2                                    # the kit you write against (2 is current)
surfaces:
  rail: { label: Deals, icon: kanban }     # optional: sidebar item + full page
  types: [{ type: $deal, mode: page }]     # optional: own the page for a type
  nav:                                     # optional: your sections, drawn by Visvine
    style: tabs                            # tabs on the band (≤7) or side (a list)
    sections:
      - { id: board, label: Board }
      - { id: settings, label: Settings, admin: true }   # admins only
  actions: [{ id: new-deal, label: New deal }]           # optional: ≤2 band buttons
bindings:                                  # what the Tool needs; each space binds its own
  deals: { kind: folder, label: Deal notes, suggest: deals }
  deal:  { kind: type, label: Deal type, suggest: Deal, fields: [stage, amount] }
  crm:   { kind: connector, label: CRM, recipe: hubspot, optional: true }
permissions:
  context: { read: ["$deals/**"], write: ["$deals/**"] }
  records: { read: [$deal], write: [{ type: $deal, fields: [stage] }] }
  resources: { read: ["resources/contracts/**"], write: ["resources/logos/**"] }   # write: where ImageUpload adds files
  connectors: [{ use: $crm, actions: [search_deals] }]
  agents: ["deal-*"]
  actions: [list_events]
  ai: { complete: true, decide: false }
  ui: { download: true }
settings:                                  # filled by an admin on the install sheet
  currency: { type: string, label: Currency, enum: [USD, EUR, GBP], default: USD }
collections:                               # the Tool's own rows, kept per install
  votes:
    schema: { type: object, properties: { choice: { type: string, enum: [a, b, c] } }, required: [choice] }
    read: all                              # all | own | admin
    write: own                             # own | all | admin
    maxRows: 20000                         # default 10000, at most 100000
dependencies: { date-fns: ^4 }             # from the curated list below
tags: [crm, kanban]                        # optional marketplace tags: ≤8, [a-z0-9-]{1,24}
---

What this Tool is for, in a paragraph or two.
```

A Tool written before manifests had `sdk` still works exactly as it did: its
`perimeter:` block (`read`, `write`, `types`, `connectors`, `agents`) is read as
the same permissions with no bindings, and it keeps kit 1. Declare reach one way
— `permissions` or `perimeter`, never both.

## Bindings and settings

A Tool names the KIND of thing it needs, not a path in one space. `$deals/**`
is "whatever folder this space bound `deals` to" — `sales/pipeline/**` here,
`crm/deals/**` there. In the space that wrote the Tool every slot is bound to its
`suggest`; an admin installing it elsewhere picks from the space's own folders,
types, connectors and agents. A folder slot may name a folder that does not
exist yet (your first write makes it); a type, connector or agent must exist.
An unbound slot runs the Tool degraded: `visvine.degraded.missing.bindings`
names it, and the reach it would have granted is simply absent.

Read what a slot is bound to, and the install's settings, from
`visvine.install.bindings` and `visvine.install.settings`.

## Sections and band buttons — optional

Visvine draws your Tool's chrome so it looks like the rest of the app: declare
`surfaces.nav` and your sections appear as tabs on the top band (or a list
beside your content with `style: side`), in the app's own style. Draw only the
content for the active one:

```tsx
import { useSection, useBandAction } from '@visvine/tool-kit'

export default function App() {
  const [section] = useSection()          // 'board' | 'settings' | null
  useBandAction('new-deal', () => openNewDeal())
  return section === 'settings' ? <Settings /> : <Board />
}
```

Switching sections never reloads your frame, so keep state you want to survive
a tab change above the switch. Labels are one to three words. Never draw your
own tab bar or page title — the band already names where the person is.

## icon.svg — optional

Name a built-in shape in `surfaces.rail.icon` (`grid`, `kanban`, `list`,
`table`, `calendar`, `chart`, `note`, `folder`, `people`, `sparkle`) and
you need no icon file. To ship your own, set `icon: custom` and write
`icon.svg`:

```xml
<svg viewBox="0 0 24 24">
  <path d="M4 7h16M4 12h10M4 17h7" />
</svg>
```

It renders in the app's own sidebar, not inside your Tool's frame, so it is held
to a strict shape and anything outside it fails the build:

- **24x24 only** — `viewBox="0 0 24 24"`. A different canvas is rejected rather
  than rescaled, so your strokes land on the same grid as every other icon.
- **Geometry only** — `path`, `circle`, `rect`, `line`, `polyline`,
  `polygon`, `ellipse`, `g`. No `script`, `style`, `image`, `use`,
  `foreignObject`, `a`, animation, event handlers, links, `url(...)`, or
  `id`/`class`.
- **No colours** — paint is supplied by the sidebar so your icon follows the
  theme and the active-row highlight like a built-in. Draw strokes, not fills.

## Permissions

**The permissions are the whole security story.** Anything not declared is
refused at the bridge with a `perimeter` error, before any of the viewer's own
access is asked, and an admin reads them — bound to their space, in plain words —
before installing. Declare the narrowest reach that works.

They narrow; they never widen. A Tool can only ever see what the person using it
could already see. Two members with different grants running the same Tool see
different data, and that is correct.

| Family | Grammar | Unlocks |
| --- | --- | --- |
| `context.read` / `write` | note globs, or `$slot/…` | `context.list/read/search/links`, `write/append` |
| `records.read` / `write` | type names or `$slot`; writes list their fields | `records.query/get`, `records.update` |
| `resources.read` | globs over files' notes under `resources/`, or `$slot` | `resources.list/get/read/blob` |
| `connectors` | names or `$slot`, with `actions` for the ones you call | `connectors.call` |
| `agents` | names, `prefix-*`, or `$slot` | `agents.run` |
| `actions` | names tools may run: `list_events`, `update_event`, `share_resource` | `actions.run` |
| `ai` | `{ complete, decide }` | `ai.complete`, `ai.decide` |
| `ui` | `{ download }` | `ui.download` |

A Tool's own data — a collection — is not a permission: it is declared under
`collections`, with its own read and write rules (see Collections).

**`tools/`, `agents/`, `connectors/` and `models/` are sealed against Tool writes**,
whatever you declare — they hold configuration that runs — and a read of them
needs a glob that names them (`**` never reaches configuration). One exception: a
Tool may CREATE `agents/<name>/index.md` (an agent brief) when its own `agents`
names that agent, e.g. `agents: ["deal-*"]` for `agents/deal-nightly/index.md`. A
bare `*` names nobody. It may never rewrite a brief that already exists, never
append to one, and never write one that says `active: true`.

A Tool that declares `ai` writes as AI-assisted text: a folder frozen for AI
refuses its writes as it refuses an agent's.

## ui.tsx

```tsx
import { useVisvine, useQuery, Stack, Table, Spinner, Banner, Button, Row } from '@visvine/tool-kit'

export default function Tool() {
  const visvine = useVisvine()
  const { data, error, loading, reload } = useQuery(() => visvine.records.query('Deal', { order: { key: 'updated', direction: 'desc' } }), [])

  if (loading) return <Spinner size="lg" />
  if (error) return <Banner tone="danger" title="Could not load deals">{error.message}</Banner>

  return (
    <Stack gap="lg">
      <Row justify="between">
        <span className="text-sm text-fg-muted">{data?.total ?? 0} open</span>
        <Button onClick={reload}>Refresh</Button>
      </Row>
      <Table
        columns={[
          { key: 'title', header: 'Deal', render: (r) => r.title },
          { key: 'stage', header: 'Stage', render: (r) => String(r.fields.stage ?? '') },
        ]}
        rows={data?.rows ?? []}
        rowKey={(r) => r.path}
        onRowClick={(r) => visvine.ui.openRecord({ path: r.path })}
        empty="No deals yet."
      />
    </Stack>
  )
}
```

Rules:

- `export default` a component. It takes no props — everything arrives through
  `useVisvine()`.
- Import only `react`, `react-dom`, `react-dom/client`, `@visvine/tool-kit`, your
  own modules (`./<name>`), and the dependencies your manifest declares.
  There is no package install step and no npm at runtime; any other import fails
  to compile.
- Do not render your own page chrome. The app supplies the navbar, the sidebar,
  the band and the page frame. Your Tool is the content.
- The frame is sized to your content automatically. Do not use
  `position: fixed` or `100vh` — they measure the iframe, not the window, and
  a Tool cannot escape it anyway.
- `visvine.subject` is set when your Tool owns a type page: it is the note or
  node whose page is being rendered. It is null on your Tool's own page.

## Modules and dependencies

Split a large interface into modules under `src/` — `src/board.tsx`,
`src/format.ts` — and import them as `./board` and `./format`, from `ui.tsx`
and from each other (`./src/board` works from `ui.tsx` too). They compile into the one bundle, are reviewed with the
rest, and number at most 24. `data.js` stays one plain script.

Third-party code comes from one curated list, each package pinned to the one
version the server serves — declare it in `dependencies` and import it by name:

- `zod` 4.3.6 — schema validation
- `date-fns` 4.1.0 — date arithmetic and formatting
- `clsx` 2.1.1 — class name joining

## What the kit gives you

The app's own components: `Button`, `Input`, `Textarea`, `Select`, `Checkbox`,
`Toggle`, `SearchInput`, `Field`, `Chip`, `Tabs`, `Alert`, `Avatar`, `Menu`,
`IconButton`, `Modal`, `ConfirmDialog`, `SettingsSection`, `Skeleton`,
`LoadingText`, `Row`, `Stack`. The kit's own, painted from the same tokens:
`Banner`, `EmptyState`, `Spinner`, `Card` (a flat section), `PageHeader`,
`DatePicker` (`YYYY-MM-DD` strings). Data: `Table` for a few rows, `DataTable`
for many (sortable columns, sticky header, `maxHeight` + `virtualize` for
thousands of rows). Content: `Markdown` renders a note body safely. Charts:
`LineChart`, `BarChart`, `AreaChart`, `PieChart` — recharts underneath, already
themed; the raw recharts API is on `Recharts` for anything else. Boards:
`KanbanBoard` / `KanbanColumn` / `KanbanCard` — you own the data, the board calls
`onMove` and you write the note or the record.

```tsx
<BarChart data={rows} x="month" series={['won', 'lost']} stacked height={220} />
<DataTable
  columns={[{ key: 'title', header: 'Deal', render: (r) => r.title, sortable: true, value: (r) => r.title }]}
  rows={deals} rowKey={(r) => r.path} maxHeight={480} virtualize
/>
<KanbanBoard onMove={({ cardId, toColumnId }) => visvine.records.update({ path: cardId }, { stage: toColumnId })}>
  {stages.map((s) => (
    <KanbanColumn key={s} id={s} title={s} count={byStage[s].length}>
      {byStage[s].map((d) => <KanbanCard key={d.path} id={d.path}>{d.title}</KanbanCard>)}
    </KanbanColumn>
  ))}
</KanbanBoard>
```

## Design: sit on the app's canvas

Visvine paints one page background behind every page. Your Tool's frame is
**transparent**, so that backdrop shows through it exactly as it does behind a
native page, and the frame loads the app's own stylesheet — its tokens and the
components' styles. This only works if you leave the canvas alone:

- **Never paint a page background.** No `background` on `html`, `body`,
  `#root` or a full-page wrapper `<div>`.
- **Flat surfaces.** Sections separated by hairlines, no boxes around
  everything, a shadow only on something that floats (a menu, a dialog).
- **Colour comes from the theme.** Style your own markup with the design tokens,
  never literal colours — the viewer can switch the accent live and the runtime
  repaints `:root`, so a hardcoded hex is wrong a click later.

| Token | Use for |
| --- | --- |
| `--vv-color-accent` / `-accent-strong` / `-accent-soft` | The space's accent: primary actions, active states, soft highlights |
| `--vv-color-surface` | The one opaque surface (floats, inputs) |
| `--vv-color-surface-subtle` / `-surface-muted` | Translucent fills (hover, wells) |
| `--vv-color-line-subtle` / `--vv-color-line` | Hairlines / input borders |
| `--vv-color-fg` / `-fg-secondary` / `-fg-muted` | Ink, three volumes |
| `--vv-color-danger` `--vv-color-warning` `--vv-color-info` `--vv-color-success` | Status colours |
| `--vv-chart-1..8` | Chart series (or `useChartColors()`) |

The role classes the app paints with (`text-fg-muted`, `bg-surface-subtle`,
`border-line-subtle`) work in your markup too, as far as the app itself uses
them; for anything else, a `style` with a token. `useTheme()` returns the same
map for the rare JS-side need (a `<canvas>`, an exported image).

## Records

`visvine.records.query(type, { where, order, limit, cursor })` reads the records
of one type — the notes that declare a type the space invented, or the nodes of
one it is built on (people, organisations, events) — with their fields typed:

```tsx
const won = await visvine.records.query('Deal', {
  where: [{ key: 'stage', op: 'eq', value: 'Won' }, { key: 'amount', op: 'range', min: 1000 }],
  order: { key: 'amount', direction: 'desc' },
})
await visvine.records.update({ path: won.rows[0].path }, { stage: 'Closed' })
```

`update` writes only the fields `permissions.records.write` names, each parsed
by the field's kind the way the Directory's table parses a cell; a value that
does not read as its kind is refused, and a blank clears the field.

## Files, links and actions

`visvine.resources.list({ folder, kind, q })` lists the files and links inside
`permissions.resources.read` that the viewer can see; `read(id)` pages through
a file's extracted text; `blob(id, 'thumb')` hands back an image as a data URL
for an `<img>`. `visvine.context.links(path)` is a note's outgoing and incoming
links.

`visvine.actions.run(name, input)` runs one of the actions tools may run, in
this space only — `space_id` is set for you, and naming another space is
refused. Every id it is handed (an event, a file, a channel) is checked to be
this space's, and a file to be inside your `resources` permission, first.

## The space's AI

`await visvine.ai.complete('Summarise: …')` is one answer from the space's own
model, on its key and under its monthly cap (`{ system, messages, maxTokens }`
for a conversation). `visvine.ai.decide(items, questions)` asks the platform's
judge the same questions about many texts — `yes_no`, `choice` or `scale` — and
answers with numbers; it is literal, so ask plain statements about what the text
says, never about dates or amounts. Both need `permissions.ai`, and a Tool that
declares either writes as AI-assisted text.

## The app's own dialogs

The frame has no popups, no downloads and no navigation of its own; the app does
these for you, in its chrome: `visvine.ui.toast(message, tone)`,
`await visvine.ui.confirm({ title, destructive })`,
`await visvine.ui.download({ filename, content, mimeType })` (needs
`permissions.ui.download`; the app names the file and asks),
`visvine.ui.openRecord({ path } | { nodeId })`, `visvine.ui.openResource(id)`.

## Live data

`useLiveQuery` is `useQuery` that stays current:

```tsx
const deals = useLiveQuery(() => visvine.context.list('deals/**'), [], { paths: ['deals/**'] })
```

When a note inside your read permission is written, renamed or deleted, Visvine
tells the frame which paths changed and the query re-runs if one matches
`paths` (or on any change when `paths` is omitted). This is **best-effort**:
the change feed is per server process and a change on another instance, or a
dropped connection, is not delivered — so the hook also re-runs every 30
seconds (`pollMs`), which is the guarantee. Refreshes never flip `loading`
back on; read `refreshing` if you want a subtle indicator. Do not build your
own poll on top of it.

## Paging

`context.list` and `context.search` cap at 200 rows. For more, page:
`visvine.context.listPage(glob, cursor)` / `searchPage(query, { k, cursor })`
answer `{ items, nextCursor }`; hand `nextCursor` back until it is null. In the
UI, `usePagedList(glob, { pageSize })` accumulates `items` and gives you
`hasMore` / `loadMore`. `records.query` and `resources.list` page the same way,
with `cursor`.

## data.js

Optional. Use it when the work should not happen in the browser — a connector
call with a large response, a computation over many notes.

```js
handlers.summary = async (args, visvine) => {
  const notes = await visvine.context.list('deals/**')
  const open = notes.filter((n) => n.type === 'deal')
  return { count: open.length, latest: open[0]?.path ?? null }
}
```

Call it from the UI with `visvine.data.call('summary', { ... })`.

Handlers run in a sandboxed isolate with the same `visvine` object the UI has
and the same permissions. There is no filesystem, no socket and no `process`; a
handler that has not returned within 20 seconds is killed.
Handlers also get `visvine.crypto` — `hmac(alg, key, data)`, `hash(alg, data)`,
`randomHex(n)`, `base64.encode/decode`, `timingSafeEqual(a, b)`.

`visvine.connectors.call(name, code)` runs JavaScript inside a declared
connector's isolate; `visvine.connectors.call(name, { action, args })` runs one
of the connector's named actions instead — the reviewable choice when the
connector offers one.

## Collections

A collection is the Tool's own store — votes, sign-ups, check-ins — kept per
install, not in the space's notes. Declare it under `collections` with a JSON
Schema (`type`, `properties`, `required`, `additionalProperties`, `enum`,
`const`, `minimum`/`maximum`, `minLength`/`maxLength`, `items`,
`minItems`/`maxItems`; `title`, `description`, `default` and `format` are
accepted and check nothing; no `pattern`), and who reads and writes it:

| Rule | all | own | admin |
| --- | --- | --- | --- |
| `read` | everyone reads every row | each viewer their own rows; admins all | admins only |
| `write` | anyone changes any row | anyone adds; a row is changed by whoever wrote it, or an admin | admins only |

```tsx
const { data: votes } = useCollectionCount('votes', { groupBy: 'choice' })
const { data: mine } = useCollection('votes', { mine: true })
await visvine.collections.insert('votes', { choice: 'a' })
```

A row never says who wrote it — only `mine`. Rows are written as the viewer:
their account going takes their rows with it. Uninstalling keeps the rows for
30 days, for the Tool installed here again to take back; an admin can
export them from the install's row in the console. `where` matches top-level
fields exactly; `groupBy` counts per value of one field. A preview keeps its
own rows, apart from any install's.

## State

`visvine.state` is a small key/value store — there is no `localStorage` in the
sandbox. In kit 2 a value is the viewer's own unless you say otherwise:
`set('filter', f)` remembers this person's filter, `set('layout', l, { scope:
'install' })` is one value everyone sees. It is for UI preferences, not space
data — that belongs in notes and records, where it is searchable and shared.

## Limits

| What | Cap |
| --- | --- |
| Rows from one list, search or query | 200 |
| Bytes from one `context.read` | 256,000 |
| Bytes in one `context.write` / `context.append` | 128,000 |
| Bytes of params in one call | 64,000 |
| Calls per minute, per viewer | 120 |
| One `data.call` | 20s |
| One `resources.read` page | 20,000 characters |
| One `resources.blob` | 2,000,000 bytes |
| One `ai.complete` answer | 1,024 tokens |
| Items in one `ai.decide` | 100 |
| One `state.set` value, serialized | 65,536 bytes |
| Keys in `visvine.state`, per scope | 100 |

An unpaged list that would exceed the row cap comes back truncated, not as an
error — page to see the rest.

## Failure

Every bridge method rejects with a `BridgeCallError` carrying a `code`:

| Code | Means |
| --- | --- |
| `perimeter` | Your Tool never declared this reach. Fix the manifest. |
| `forbidden` | The viewer cannot do it. Not yours to fix — handle it. |
| `not_found` | No such note, record, file, connector or agent. |
| `degraded` | This space lacks something you declared, or a slot is unbound; see `visvine.degraded`. |
| `rate_limited` | Too many calls, or a budget spent. Back off. |
| `too_large` | Over one of the caps above. |
| `timeout` | A `data.call` or the model ran too long. |
| `invalid` | Bad params. |
| `internal` | Visvine's fault. |

Show the failure in your own pane — a `Banner` with the message — rather than
rendering nothing. If `visvine.degraded` is set, say so once at the top: reads
against the missing pieces come back empty, so a Tool that stays silent looks
broken instead of incomplete.

## Kit 1

A Tool whose manifest says `sdk: ^1`, or has no `sdk` because it was written
before kit 2, keeps kit 1: its own component set and stylesheet, one shared
`state` value per key, and everything else above. Moving to kit 2 is changing
`sdk` to `^2` and checking the page — the components keep their names and props.

## Do / don't

**Do**

- Keep the permissions as narrow as the Tool actually needs, and bind by kind
  (`$deals/**`) rather than naming one space's folders.
- Use the kit's components. They are the app's, so an installed Tool looks like
  Visvine and not like a twelfth website.
- Style your own markup with the design tokens, so it follows a live theme
  switch the way the kit does.
- Read `visvine.viewer.isAdmin` to hide admin-only affordances — but never to
  protect data. The server decides that.

**Don't**

- Don't reach for `localStorage`, `document.cookie`, `fetch` or `window.parent`.
  The frame is sandboxed on a cookie-less origin with no network of its own;
  all four either fail or do nothing. `visvine.state` replaces the first two.
- Don't import a UI library or a CSS framework. Nothing resolves at runtime but
  the list above, and the bundle has a size cap.
- Don't paint a page background or hardcode colours.
- Don't poll. Query on mount and after a write, and use `useLiveQuery` where
  staying current matters — it already polls, gently.
- Don't put a secret in `ui.tsx`, a module or `data.js`. All are readable by
  anyone who can read the note, and a published Tool ships its source into the
  registry.

