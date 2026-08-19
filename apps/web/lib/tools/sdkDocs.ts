/**
 * The two documents an authoring agent needs before it can write a Tool: the
 * type surface of `@visvine/tool-kit` and the prose guide to the file layout,
 * the frontmatter and the limits.
 *
 * They are strings rather than files under `docs/` because their consumer is
 * the MCP tool `get_tool_sdk` — an agent working in someone else's editor, with
 * no checkout of this repo, that must be able to ask for the SDK and get it in
 * one call. The `.d.ts` is hand-maintained: it is the contract as *documented*,
 * and it is only right if it matches `features/tools/kit/index.ts`, so the two
 * are changed together.
 *
 * Backticks in the guide are escaped (`\``) because the whole document is one
 * template literal. The limits are interpolated from `BRIDGE_LIMITS` so the
 * numbers an author reads are the numbers the server enforces.
 */
import { BRIDGE_LIMITS } from './protocol'
import { STATE_MAX_BYTES, STATE_MAX_KEYS } from './state'

/**
 * Ambient declarations for the bare specifier a Tool imports. An authoring
 * agent drops this next to `ui.tsx` (or feeds it to its own type checker) and
 * gets completion for the whole kit without resolving anything.
 */
export const TOOL_KIT_DTS = `// Type definitions for @visvine/tool-kit
// The module a Visvine Tool imports. Resolved at runtime by the frame's import
// map; there is nothing to install.

declare module '@visvine/tool-kit' {
  import type { ButtonHTMLAttributes, InputHTMLAttributes, JSX, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
  import type * as RechartsNamespace from 'recharts'

  // ── data shapes ──

  /** What the Tool is being shown about, or null on its own page. */
  export type ToolSubject =
    | { kind: 'note'; path: string; type: string | null; title: string | null }
    | { kind: 'node'; nodeId: string; type: string; notePath: string | null }

  export interface ToolViewer {
    id: string
    name: string
    /** Admin of this space. Never assume it; the server checks anyway. */
    isAdmin: boolean
  }

  export type ToolInstallInfo =
    | { slug: string; title: string; key: string }
    | { preview: true; name: string }

  /** Non-null when the space is missing something this Tool declared. */
  export interface ToolDegraded {
    missing: { connectors: string[]; types: string[]; agents: string[] }
  }

  export interface ContextEntry {
    path: string
    title: string | null
    type: string | null
    /** ISO 8601. */
    updatedAt: string
  }

  export interface ContextNote {
    path: string
    content: string
    frontmatter: Record<string, unknown>
  }

  export interface ContextHit {
    path: string
    title: string | null
    snippet: string
    score: number
  }

  /** One page of a paged list/search. nextCursor is opaque; null on the last page. */
  export interface ContextPage<T> {
    items: T[]
    nextCursor: string | null
  }

  export type BridgeErrorCode =
    | 'perimeter'
    | 'forbidden'
    | 'not_found'
    | 'rate_limited'
    | 'too_large'
    | 'timeout'
    | 'invalid'
    | 'degraded'
    | 'internal'

  export interface BridgeError {
    code: BridgeErrorCode
    message: string
  }

  /** What every method below rejects with. Branch on \`code\`. */
  export class BridgeCallError extends Error {
    readonly code: BridgeErrorCode
  }

  // ── the bridge ──

  export interface VisvineApi {
    context: {
      /** Notes in the read perimeter, path order, capped at one page (${BRIDGE_LIMITS.maxRows} rows). */
      list(glob?: string): Promise<ContextEntry[]>
      /** One page of list; pass the previous nextCursor for the next page. */
      listPage(glob?: string, cursor?: string | null): Promise<ContextPage<ContextEntry>>
      read(path: string): Promise<ContextNote>
      search(query: string, k?: number): Promise<ContextHit[]>
      /** One page of search; k is the page size. */
      searchPage(query: string, opts?: { k?: number; cursor?: string | null }): Promise<ContextPage<ContextHit>>
      write(path: string, content: string): Promise<{ path: string }>
      append(path: string, text: string): Promise<{ path: string }>
    }
    connectors: {
      /**
       * Run a declared connector: JavaScript in its isolate, or one of the
       * connector's named actions with args.
       */
      call<T = unknown>(name: string, codeOrOpts: string | { action: string; args?: unknown } | { code: string }): Promise<T>
    }
    agents: {
      run(name: string): Promise<{ runId: string }>
    }
    data: {
      /** Call a handler exported from this Tool's data.js. */
      call<T = unknown>(fn: string, args?: unknown): Promise<T>
    }
    state: {
      /** Per-install key/value store. There is no localStorage in the sandbox. */
      get<T = unknown>(key: string): Promise<T | null>
      set(key: string, value: unknown): Promise<null>
    }
    subject: ToolSubject | null
    viewer: ToolViewer
    install: ToolInstallInfo
    degraded: ToolDegraded | null
    /** In-app paths only; Visvine refuses anything else. */
    navigate(path: string): void
  }

  /** Mounted for you by the runtime. You never render this yourself. */
  export function VisvineProvider(props: { children: ReactNode }): JSX.Element

  export function useVisvine(): VisvineApi
  export function useSubject(): ToolSubject | null
  /** The theme as raw CSS custom properties; prefer styling with var(--vv-*). */
  export function useTheme(): Record<string, string>

  export interface QueryResult<T> {
    data: T | null
    error: Error | null
    loading: boolean
    reload: () => void
  }

  /** Runs fn when deps change, drops superseded results, hands back a reload. */
  export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): QueryResult<T>

  export interface LiveQueryOptions {
    /** Reload only when a changed note path matches one of these globs. Omit = any change. */
    paths?: string[]
    /** Poll fallback interval in ms (default 30000; 0 disables). */
    pollMs?: number
  }
  /**
   * useQuery that re-runs when notes change: Visvine tells the frame which
   * paths changed (best-effort, may be missed) and a poll every pollMs catches
   * the rest. Refreshes do not flip loading; refreshing says one is in flight.
   */
  /** The poll interval useLiveQuery falls back to (30s). */
  export const LIVE_QUERY_POLL_MS: number
  export function useLiveQuery<T>(
    fn: () => Promise<T>,
    deps: unknown[],
    opts?: LiveQueryOptions,
  ): QueryResult<T> & { refreshing: boolean }

  export interface PagedListOptions {
    /** Rows per loadMore; at most the bridge row cap. */
    pageSize?: number
  }
  export interface PagedListResult<T> {
    items: T[]
    loading: boolean
    loadingMore: boolean
    error: Error | null
    hasMore: boolean
    loadMore: () => void
    reload: () => void
  }
  /** Page through context.list(glob); items accumulate across loadMore. */
  export function usePagedList(glob: string | undefined, opts?: PagedListOptions): PagedListResult<ContextEntry>

  // ── components ──
  // Styled from Visvine's theme tokens. Use these before writing your own CSS,
  // so an installed Tool looks like the app it is running inside.

  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant
    size?: 'sm' | 'md'
    children: ReactNode
  }
  export function Button(props: ButtonProps): JSX.Element

  export interface CardProps {
    title?: ReactNode
    actions?: ReactNode
    flush?: boolean
    className?: string
    children: ReactNode
  }
  export function Card(props: CardProps): JSX.Element

  export interface StackProps {
    direction?: 'row' | 'column'
    gap?: 'sm' | 'md' | 'lg'
    wrap?: boolean
    className?: string
    children: ReactNode
  }
  export function Stack(props: StackProps): JSX.Element

  export interface PageHeaderProps {
    title: ReactNode
    description?: ReactNode
    actions?: ReactNode
  }
  export function PageHeader(props: PageHeaderProps): JSX.Element

  export interface FieldProps {
    label: ReactNode
    htmlFor?: string
    hint?: ReactNode
    error?: ReactNode
    children: ReactNode
  }
  export function Field(props: FieldProps): JSX.Element

  export type InputProps = InputHTMLAttributes<HTMLInputElement>
  export function Input(props: InputProps): JSX.Element

  export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>
  export function Textarea(props: TextareaProps): JSX.Element

  export interface SelectOption {
    value: string
    label: string
  }
  export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    options?: SelectOption[]
    children?: ReactNode
  }
  export function Select(props: SelectProps): JSX.Element

  export type ChipTone = 'neutral' | 'accent' | 'danger' | 'warn' | 'info'
  export interface ChipProps {
    tone?: ChipTone
    className?: string
    children: ReactNode
  }
  export function Chip(props: ChipProps): JSX.Element

  export interface TabItem {
    id: string
    label: ReactNode
  }
  export interface TabsProps {
    tabs: TabItem[]
    active: string
    onChange: (id: string) => void
    className?: string
  }
  export function Tabs(props: TabsProps): JSX.Element

  export interface TableColumn<T> {
    key: string
    header: ReactNode
    render: (row: T) => ReactNode
    align?: 'left' | 'right'
    width?: string
  }
  export interface TableProps<T> {
    columns: Array<TableColumn<T>>
    rows: T[]
    rowKey: (row: T, index: number) => string
    onRowClick?: (row: T) => void
    empty?: ReactNode
  }
  export function Table<T>(props: TableProps<T>): JSX.Element

  export interface EmptyStateProps {
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
  }
  export function EmptyState(props: EmptyStateProps): JSX.Element

  export interface SpinnerProps {
    size?: 'sm' | 'lg'
    label?: string
  }
  export function Spinner(props: SpinnerProps): JSX.Element

  export type BannerTone = 'info' | 'success' | 'warn' | 'danger'
  export interface BannerProps {
    tone?: BannerTone
    title?: ReactNode
    action?: ReactNode
    children?: ReactNode
  }
  export function Banner(props: BannerProps): JSX.Element

  // ── data table ──
  // Table plus sorting, a sticky header and windowing for large sets.

  export type SortDirection = 'asc' | 'desc'
  export interface DataTableSort {
    key: string
    direction: SortDirection
  }
  export interface DataTableColumn<T> extends TableColumn<T> {
    /** true sorts by value(row) ?? row[key]; a function is the comparator. */
    sortable?: boolean | ((a: T, b: T) => number)
    value?: (row: T) => unknown
  }
  export interface DataTableProps<T> {
    columns: Array<DataTableColumn<T>>
    rows: T[]
    rowKey: (row: T, index: number) => string
    onRowClick?: (row: T) => void
    empty?: ReactNode
    defaultSort?: DataTableSort
    sort?: DataTableSort | null
    onSortChange?: (sort: DataTableSort | null) => void
    /** Cap the body height (px): the header sticks and the body scrolls. */
    maxHeight?: number
    /** Render only visible rows (needs maxHeight). true = 40px rows. */
    virtualize?: boolean | { rowHeight: number; overscan?: number }
    className?: string
  }
  export function DataTable<T>(props: DataTableProps<T>): JSX.Element

  // ── charts ──
  // Built on recharts with the space's theme colours. For anything the wrappers
  // do not expose, use the raw primitives under Recharts.

  export interface ChartSeries {
    key: string
    label?: string
    color?: string
  }
  export interface ChartProps {
    data: Array<Record<string, unknown>>
    /** Key of the x (category/time) axis. */
    x: string
    series: Array<string | ChartSeries>
    height?: number
    legend?: boolean
    grid?: boolean
    tooltip?: boolean
    /** Bar/Area: stack the series. */
    stacked?: boolean
    formatValue?: (value: number) => string
    formatX?: (value: unknown) => string
    className?: string
    children?: ReactNode
  }
  export function LineChart(props: ChartProps): JSX.Element
  export function BarChart(props: ChartProps): JSX.Element
  export function AreaChart(props: ChartProps): JSX.Element
  export interface PieChartProps {
    data: Array<Record<string, unknown>>
    nameKey: string
    valueKey: string
    height?: number
    legend?: boolean
    tooltip?: boolean
    donut?: boolean
    colors?: string[]
    formatValue?: (value: number) => string
    className?: string
    children?: ReactNode
  }
  export function PieChart(props: PieChartProps): JSX.Element
  /** The theme's chart palette (--vv-chart-1..8), resolved to colour strings. */
  export function useChartColors(): string[]
  export const CHART_COLOR_SLOTS: number
  /** The whole recharts API (ResponsiveContainer, ComposedChart, ReferenceLine, …). */
  export const Recharts: typeof RechartsNamespace

  // ── date picker ──

  export interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> {
    /** YYYY-MM-DD or null. */
    value: string | null
    onChange: (value: string | null) => void
    min?: string
    max?: string
  }
  export function DatePicker(props: DatePickerProps): JSX.Element

  // ── markdown ──

  export interface MarkdownProps {
    /** Markdown source — a note's content, say. Sanitised; http(s) links only. */
    source: string
    className?: string
    /** Every link click, with the raw href. Return false to also let the default happen. */
    onLinkClick?: (href: string) => void | boolean
  }
  /** Renders markdown safely (GFM: tables, task lists). In-app links navigate. */
  export function Markdown(props: MarkdownProps): JSX.Element | null

  // ── kanban ──
  // Headless about data: you own columns and cards; the board reports moves.

  export interface KanbanMove {
    cardId: string
    fromColumnId: string
    toColumnId: string
    /** Position in the destination column after the move. */
    index: number
  }
  export interface KanbanBoardProps {
    onMove: (move: KanbanMove) => void
    className?: string
    children: ReactNode
  }
  export function KanbanBoard(props: KanbanBoardProps): JSX.Element
  export interface KanbanColumnProps {
    id: string
    title: ReactNode
    count?: number
    actions?: ReactNode
    empty?: ReactNode
    className?: string
    children?: ReactNode
  }
  export function KanbanColumn(props: KanbanColumnProps): JSX.Element
  export interface KanbanCardProps {
    id: string
    onClick?: () => void
    className?: string
    children: ReactNode
  }
  /** Drag with the pointer to move; click still fires when there was no drag. */
  export function KanbanCard(props: KanbanCardProps): JSX.Element
}
`

/**
 * The prose half — what an agent reads once before writing anything. Written
 * for a model, not a browser: short sections, whole examples, and the refusals
 * spelled out so the first compile is the working one.
 */
export const TOOL_AUTHOR_GUIDE = `# Building a Visvine Tool

A Tool is a small React app that runs inside a Visvine space. It renders in the
main content area, reads and writes the space's own context notes, and can call
the space's connectors and agents — but only the ones it declares up front.

Three files, all of them notes in the space, so they have history, permissions
and review like anything else:

\`\`\`
tools/<name>/index.md    frontmatter = config, body = docs for humans
tools/<name>/ui.tsx      the React component (compiled on write)
tools/<name>/data.js     optional server-side handlers (sandboxed isolate)
tools/<name>/icon.svg    optional: your own sidebar glyph
\`\`\`

## index.md

\`\`\`yaml
---
type: tool
title: Deal Pipeline
description: Kanban over deal notes
surfaces:
  rail: { label: Deals, icon: kanban }     # optional: sidebar item + full page
                                           # icon: one of the built-ins, or
                                           # 'custom' to use your own icon.svg
  types: [{ type: deal, mode: page }]      # optional: own the page for a type
perimeter:
  read:  ["deals/**", "people/*/index.md"]
  write: ["deals/**"]
  types: [deal]
  connectors: [hubspot]
  agents: ["deal-*"]
tags: [crm, kanban]                        # optional marketplace tags: ≤8, [a-z0-9-]{1,24}
preview: /api/media/…                      # optional marketplace preview image (same-origin
                                           # /api/media/… path only — upload it first)
---

What this Tool is for, in a paragraph or two.
\`\`\`

## icon.svg — optional

Name a built-in shape in \`surfaces.rail.icon\` (\`grid\`, \`kanban\`, \`list\`,
\`table\`, \`calendar\`, \`chart\`, \`note\`, \`folder\`, \`people\`, \`sparkle\`) and
you need no icon file. To ship your own, set \`icon: custom\` and write
\`icon.svg\`:

\`\`\`xml
<svg viewBox="0 0 24 24">
  <path d="M4 7h16M4 12h10M4 17h7" />
</svg>
\`\`\`

It renders in the app's own sidebar, not inside your Tool's frame, so it is held
to a strict shape and anything outside it fails the build:

- **24x24 only** — \`viewBox="0 0 24 24"\`. A different canvas is rejected rather
  than rescaled, so your strokes land on the same grid as every other icon.
- **Geometry only** — \`path\`, \`circle\`, \`rect\`, \`line\`, \`polyline\`,
  \`polygon\`, \`ellipse\`, \`g\`. No \`script\`, \`style\`, \`image\`, \`use\`,
  \`foreignObject\`, \`a\`, animation, event handlers, links, \`url(...)\`, or
  \`id\`/\`class\`.
- **No colours** — paint is supplied by the sidebar so your icon follows the
  theme and the active-row highlight like a built-in. Draw strokes, not fills.

## The perimeter

**The perimeter is the whole security story.** Anything not listed is refused at
the bridge with a \`perimeter\` error, and an admin reads this block before
installing. Declare the narrowest globs that work — a Tool asking for \`**\` will
not be approved.

The perimeter narrows; it never widens. A Tool can only ever see what the person
using it could already see. Two members with different grants running the same
Tool see different data, and that is correct.

**\`tools/\`, \`agents/\` and \`connectors/\` are sealed against Tool writes**, whatever
you declare — they hold configuration that runs. One exception: a Tool may CREATE
\`agents/<name>.md\` (an agent brief) when its own \`perimeter.agents\` names that
agent, e.g. \`agents: ["deal-*"]\` for \`agents/deal-nightly.md\`. A bare \`*\` names
nobody. It may never rewrite a brief that already exists, never append to one, and
never write \`agents/live/**\` — ACTIVATION is a space admin's act, so a brief your
Tool wrote does nothing until a person turns it on.

## ui.tsx

\`\`\`tsx
import { useVisvine, useQuery, PageHeader, Card, Stack, Table, Spinner, Banner, Button } from '@visvine/tool-kit'

export default function Tool() {
  const visvine = useVisvine()
  const { data, error, loading, reload } = useQuery(() => visvine.context.list('deals/**'), [])

  if (loading) return <Spinner size="lg" />
  if (error) return <Banner tone="danger" title="Could not load deals">{error.message}</Banner>

  return (
    <Stack gap="lg">
      <PageHeader
        title="Deals"
        description={\`\${data?.length ?? 0} open\`}
        actions={<Button onClick={reload}>Refresh</Button>}
      />
      <Card flush>
        <Table
          columns={[
            { key: 'title', header: 'Deal', render: (r) => r.title ?? r.path },
            { key: 'updated', header: 'Updated', render: (r) => r.updatedAt.slice(0, 10) },
          ]}
          rows={data ?? []}
          rowKey={(r) => r.path}
          onRowClick={(r) => visvine.navigate(\`/directory/note/\${r.path}\`)}
          empty="No deals yet."
        />
      </Card>
    </Stack>
  )
}
\`\`\`

Rules:

- \`export default\` a component named \`Tool\`. It takes no props — everything
  arrives through \`useVisvine()\`.
- Import only \`react\`, \`react-dom/client\` and \`@visvine/tool-kit\`. There is no
  package install step and no npm at runtime; any other import — including bare
  \`react-dom\` and \`recharts\` — fails to compile. Charts come from the kit.
- Do not render your own page chrome. The app supplies the navbar, the sidebar
  and the page frame. Your Tool is the content.
- The frame is sized to your content automatically. Do not use
  \`position: fixed\` or \`100vh\` — they measure the iframe, not the window, and
  a Tool cannot escape it anyway.
- \`visvine.subject\` is set when your Tool owns a type page: it is the note or
  node whose page is being rendered. It is null on your Tool's own page.

## What the kit gives you

Layout and chrome: \`PageHeader\`, \`Card\`, \`Stack\`, \`Tabs\`, \`Banner\`, \`Chip\`,
\`EmptyState\`, \`Spinner\`. Forms: \`Field\`, \`Input\`, \`Textarea\`, \`Select\`,
\`DatePicker\` (\`YYYY-MM-DD\` strings), \`Button\`. Data: \`Table\` for a few rows,
\`DataTable\` for many (sortable columns, sticky header, \`maxHeight\` +
\`virtualize\` for thousands of rows). Content: \`Markdown\` renders a note body
safely. Charts: \`LineChart\`, \`BarChart\`, \`AreaChart\`, \`PieChart\` — recharts
underneath, already themed; the raw recharts API is on \`Recharts\` for anything
else (\`<Recharts.ComposedChart>\`, \`<Recharts.ReferenceLine>\`). Boards:
\`KanbanBoard\` / \`KanbanColumn\` / \`KanbanCard\` — you own the data, the board
calls \`onMove\` and you write the note.

\`\`\`tsx
<BarChart data={rows} x="month" series={['won', 'lost']} stacked height={220} />
<DataTable
  columns={[{ key: 'title', header: 'Deal', render: (r) => r.title, sortable: true, value: (r) => r.title }]}
  rows={deals} rowKey={(r) => r.path} maxHeight={480} virtualize
/>
<KanbanBoard onMove={({ cardId, toColumnId }) => visvine.context.write(cardId, withStage(toColumnId))}>
  {stages.map((s) => (
    <KanbanColumn key={s} id={s} title={s} count={byStage[s].length}>
      {byStage[s].map((d) => <KanbanCard key={d.path} id={d.path}>{d.title}</KanbanCard>)}
    </KanbanColumn>
  ))}
</KanbanBoard>
\`\`\`

## Live data

\`useLiveQuery\` is \`useQuery\` that stays current:

\`\`\`tsx
const deals = useLiveQuery(() => visvine.context.list('deals/**'), [], { paths: ['deals/**'] })
\`\`\`

When a note inside your read perimeter is written, renamed or deleted, Visvine
tells the frame which paths changed and the query re-runs if one matches
\`paths\` (or on any change when \`paths\` is omitted). This is **best-effort**:
the change feed is per server process and a change on another instance, or a
dropped connection, is not delivered — so the hook also re-runs every 30
seconds (\`pollMs\`), which is the guarantee. Refreshes never flip \`loading\`
back on; read \`refreshing\` if you want a subtle indicator. Do not build your
own poll on top of it, and do not expect to see your own write echo faster than
the bridge call that made it returns.

## Paging

\`context.list\` and \`context.search\` cap at ${BRIDGE_LIMITS.maxRows} rows. For more, page:
\`visvine.context.listPage(glob, cursor)\` / \`searchPage(query, { k, cursor })\`
answer \`{ items, nextCursor }\`; hand \`nextCursor\` back until it is null. In the
UI, \`usePagedList(glob, { pageSize })\` accumulates \`items\` and gives you
\`hasMore\` / \`loadMore\` for a "Load more" button or an infinite scroll. Paging
is by path order for lists and by rank for search, and the same perimeter and
grants apply to every page.

## data.js

Optional. Use it when the work should not happen in the browser — a connector
call with a large response, a computation over many notes, anything you would
rather the viewer's laptop did not do.

\`\`\`js
handlers.summary = async (args, visvine) => {
  const notes = await visvine.context.list('deals/**')
  const open = notes.filter((n) => n.type === 'deal')
  return { count: open.length, latest: open[0]?.path ?? null }
}
\`\`\`

Call it from the UI with \`visvine.data.call('summary', { ... })\`.

Handlers run in a sandboxed isolate with the same \`visvine\` object the UI has
and the same perimeter. There is no filesystem, no socket and no \`process\`; a
handler that has not returned within ${Math.round(BRIDGE_LIMITS.dataCallTimeoutMs / 1000)} seconds is killed.
Handlers also get \`visvine.crypto\` — \`hmac(alg, key, data)\`, \`hash(alg, data)\`,
\`randomHex(n)\`, \`base64.encode/decode\`, \`timingSafeEqual(a, b)\` — for the odd
signature or digest; strings in, strings out.

\`visvine.connectors.call(name, code)\` runs JavaScript inside a declared
connector's isolate; \`visvine.connectors.call(name, { action, args })\` runs one
of the connector's named actions instead (see its page for the list) — the
reviewable choice when the connector offers one.

## Limits

| What | Cap |
| --- | --- |
| Rows from one \`context.list\` / \`context.search\` | ${BRIDGE_LIMITS.maxRows} |
| Bytes from one \`context.read\` | ${BRIDGE_LIMITS.maxReadBytes.toLocaleString('en-US')} |
| Bytes in one \`context.write\` / \`context.append\` | ${BRIDGE_LIMITS.maxWriteBytes.toLocaleString('en-US')} |
| Bytes of params in one call | ${BRIDGE_LIMITS.maxParamsBytes.toLocaleString('en-US')} |
| Calls per minute, per viewer | ${BRIDGE_LIMITS.callsPerMinute} |
| One \`data.call\` | ${Math.round(BRIDGE_LIMITS.dataCallTimeoutMs / 1000)}s |
| One \`state.set\` value, serialized | ${STATE_MAX_BYTES.toLocaleString('en-US')} bytes |
| Keys in \`visvine.state\`, per install | ${STATE_MAX_KEYS} |

Page rather than asking for everything: an unpaged list that would exceed the
row cap comes back truncated, not as an error — use \`listPage\` / \`usePagedList\`
to see the rest. \`visvine.state\` is for UI preferences (a chosen filter, a column
order), not for space data — that belongs in notes, where it is searchable and
shared.

## Failure

Every bridge method rejects with a \`BridgeCallError\` carrying a \`code\`:

| Code | Means |
| --- | --- |
| \`perimeter\` | Your Tool never declared this reach. Fix the frontmatter. |
| \`forbidden\` | The viewer cannot see it. Not yours to fix — handle it. |
| \`not_found\` | No such note, connector or agent. |
| \`degraded\` | This space lacks something you declared; see \`visvine.degraded\`. |
| \`rate_limited\` | Too many calls. Back off. |
| \`too_large\` | Over one of the caps above. |
| \`timeout\` | A \`data.call\` ran too long. |
| \`invalid\` | Bad params. |
| \`internal\` | Visvine's fault. |

Show the failure in your own pane — a \`Banner\` with the message — rather than
rendering nothing. If \`visvine.degraded\` is set, say so once at the top: reads
against the missing pieces come back empty, so a Tool that stays silent looks
broken instead of incomplete.

## Do / don't

**Do**

- Keep the perimeter as narrow as the Tool actually needs.
- Use the kit's components. They carry the space's theme, so an installed Tool
  looks like Visvine and not like a twelfth website.
- Store per-install preferences in \`visvine.state\`.
- Read \`visvine.viewer.isAdmin\` to hide admin-only affordances — but never to
  protect data. The server decides that.

**Don't**

- Don't reach for \`localStorage\`, \`document.cookie\`, \`fetch\` or \`window.parent\`.
  The frame is sandboxed on a cookie-less origin with no network of its own;
  all four either fail or do nothing. \`visvine.state\` replaces the first two.
- Don't import a UI library or a CSS framework. Nothing resolves at runtime and
  the bundle has a size cap.
- Don't poll. Query on mount and after a write, give the reader a refresh, and
  use \`useLiveQuery\` where staying current matters — it already polls, gently.
- Don't put a secret in \`ui.tsx\` or \`data.js\`. Both are readable by anyone who
  can read the note, and a published Tool ships its source into the registry.
`
