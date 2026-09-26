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
import { MAX_TOOL_MODULES } from './config'
import { TOOL_ACTIONS } from './actionAllowlist'
import { DETACHED_DAYS, LIST_LIMIT_MAX } from './shared/collections'
import { CURATED_DEPENDENCIES } from '@visvine/tool-protocol/dependencies'

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
    | {
        slug: string
        title: string
        key: string
        /** This install's settings (manifest settings:), defaults filled. */
        settings?: Record<string, unknown>
        /** What each binding slot is bound to in this space: a folder path, a type, connector or agent name. */
        bindings?: Record<string, string>
        /** The kit major the Tool was written for. */
        sdk?: number
      }
    | { preview: true; name: string; settings?: Record<string, unknown>; bindings?: Record<string, string>; sdk?: number }

  /** Non-null when the space is missing something this Tool declared. */
  export interface ToolDegraded {
    missing: {
      connectors: string[]
      types: string[]
      agents: string[]
      /** Binding slots nobody has bound here, by label. */
      bindings?: string[]
    }
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

  /** A note another links to, or one linking to it. */
  export interface ContextLink {
    path: string
    title: string | null
    /** The passage the link sits in — incoming links only. */
    excerpt?: string
  }

  /** A record: a note of one of the space's types, or a node's (a person, an event…). */
  export interface ToolRecord {
    /** Its note — what records.get/update take — or '' for a node with no note. */
    path: string
    nodeId?: string
    type: string
    title: string
    tags: string[]
    updatedAt: string
    /** Typed as their kind reads: a number, a YYYY-MM-DD date, true/false, text. */
    fields: Record<string, unknown>
    /** Fields whose written value does not read as their kind. */
    invalid: string[]
  }

  export type RecordWhere =
    | { key: string; op: 'eq'; value: string | number | boolean }
    | { key: string; op: 'in'; values: Array<string | number> }
    | { key: string; op: 'range'; min?: string | number; max?: string | number }
    | { key: string; op: 'contains'; value: string }

  /** A file or a link. Its text is resources.read, its bytes resources.blob. */
  export interface ToolResource {
    id: string
    name: string
    kind: string
    source: 'upload' | 'link'
    mimeType: string | null
    fileSize: number | null
    url: string | null
    notePath: string | null
    hasText: boolean
    createdAt: string
  }

  export type DecideQuestion =
    | { id: string; type?: 'yes_no'; ask: string }
    | { id: string; type: 'choice' | 'scale'; ask: string; options: string[] }

  export type DecideAnswer = Record<
    string,
    | { type: 'yes_no'; probability: number }
    | { type: 'choice'; choice: string; confidence: number }
    | { type: 'scale'; option: string; score: number; confidence: number }
  >

  /** The viewer's own value (kit 2's default), or one every viewer shares. */
  export type StateScope = 'user' | 'install'

  /** One row of a collection. Who wrote it is never shown — only whether the viewer did. */
  export interface CollectionRow<T = Record<string, unknown>> {
    id: string
    data: T
    mine: boolean
    createdAt: string
    updatedAt: string
  }
  /** Each top-level field equal to its value; at most eight. */
  export type CollectionWhere = Record<string, string | number | boolean | null>

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
      /** The notes this one links to and those linking to it — only ones this Tool may read. */
      links(path: string): Promise<{ outgoing: ContextLink[]; incoming: ContextLink[] }>
    }
    records: {
      /** Records of a type in permissions.records, filtered, ordered, a page at a time (${BRIDGE_LIMITS.maxRows} max). */
      query(
        type: string,
        opts?: { where?: RecordWhere[]; order?: { key: string; direction: 'asc' | 'desc' }; limit?: number; cursor?: string | null },
      ): Promise<{ type: string; rows: ToolRecord[]; nextCursor: string | null; total: number }>
      get(ref: { path: string } | { nodeId: string }): Promise<ToolRecord>
      /** Only the fields permissions.records.write names; blank clears one. */
      update(ref: { path: string } | { nodeId: string }, fields: Record<string, unknown>): Promise<{ record: string; fields: Record<string, unknown> }>
    }
    resources: {
      /** Files and links inside permissions.resources.read, newest first. */
      list(opts?: { folder?: string; kind?: string; q?: string; cursor?: string | null }): Promise<{ items: ToolResource[]; nextCursor: string | null }>
      get(id: string): Promise<ToolResource>
      /** The text extracted from a file, ${BRIDGE_LIMITS.maxResourceReadChars.toLocaleString('en-US')} characters a page. */
      read(id: string, offset?: number): Promise<{ text: string; offset: number; totalChars: number; nextOffset: number | null }>
      /** The bytes (or a thumb/preview image) as a data URL an <img> can draw; ${BRIDGE_LIMITS.maxBlobBytes.toLocaleString('en-US')} bytes at most. */
      blob(id: string, rendition?: 'original' | 'thumb' | 'preview'): Promise<{ mimeType: string; dataUrl: string }>
      /** Add a file the viewer chose into a folder permissions.resources.write names (the first when none is given); ${BRIDGE_LIMITS.maxUploadBytes.toLocaleString('en-US')} bytes at most. */
      upload(file: { name: string; dataUrl: string; folder?: string }): Promise<ToolResource>
    }
    collections: {
      /** Add a row to a collection this Tool declares; checked against its schema, 16 KB at most. */
      insert<T extends object = Record<string, unknown>>(collection: string, data: T): Promise<CollectionRow<T>>
      /** Rows, oldest first unless order is 'desc', ${LIST_LIMIT_MAX} a page at most; mine for the viewer's own. */
      list<T = Record<string, unknown>>(
        collection: string,
        opts?: { where?: CollectionWhere; mine?: boolean; order?: 'asc' | 'desc'; limit?: number; cursor?: string | null },
      ): Promise<{ rows: CollectionRow<T>[]; nextCursor: string | null }>
      get<T = Record<string, unknown>>(collection: string, id: string): Promise<CollectionRow<T>>
      /** Replace a row's data (write: own — only the viewer's rows, unless they are an admin). */
      update<T extends object = Record<string, unknown>>(collection: string, id: string, data: T): Promise<CollectionRow<T>>
      delete(collection: string, id: string): Promise<{ id: string }>
      /** How many rows match; with groupBy, how many per value of that field. */
      count(
        collection: string,
        opts?: { where?: CollectionWhere; mine?: boolean; groupBy?: string },
      ): Promise<{ total: number; groups?: Array<{ value: string | null; count: number }> }>
    }
    actions: {
      /** One of the space's actions tools may run, declared in permissions.actions, in this space. */
      run<T = unknown>(name: string, input?: Record<string, unknown>): Promise<T>
    }
    ai: {
      /** One answer from the space's model (permissions.ai.complete). */
      complete(prompt: string | { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number }): Promise<string>
      /** The same questions about many texts, answered with numbers (permissions.ai.decide). */
      decide(items: string[], questions: DecideQuestion[]): Promise<Array<DecideAnswer | null>>
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
      /**
       * A small key/value store — there is no localStorage in the sandbox. The
       * viewer's own by default; { scope: 'install' } is one value every viewer shares.
       */
      get<T = unknown>(key: string, opts?: { scope?: StateScope }): Promise<T | null>
      set(key: string, value: unknown, opts?: { scope?: StateScope }): Promise<null>
    }
    subject: ToolSubject | null
    viewer: ToolViewer
    install: ToolInstallInfo
    degraded: ToolDegraded | null
    /** In-app paths only; Visvine refuses anything else. */
    navigate(path: string): void
    /** The active one of this Tool's own sections (surfaces.nav), or null. */
    section: string | null
    ui: {
      /** Switch to one of this Tool's declared sections. */
      navigate(to: { section: string }): void
      /** A toast in the app's own corner. */
      toast(message: string, tone?: 'info' | 'success' | 'warning' | 'error'): Promise<void>
      /** Ask the viewer in the app's own dialog; true when they confirm. */
      confirm(question: { title: string; body?: string; confirmLabel?: string; destructive?: boolean }): Promise<boolean>
      /** Hand the viewer a file to save; the app names it and asks (permissions.ui.download). */
      download(file: { filename: string; content: string; mimeType?: string }): Promise<boolean>
      openRecord(ref: { path: string } | { nodeId: string }): Promise<void>
      openResource(id: string): Promise<void>
    }
  }

  /** Mounted for you by the runtime. You never render this yourself. */
  export function VisvineProvider(props: { children: ReactNode }): JSX.Element

  export function useVisvine(): VisvineApi
  export function useSubject(): ToolSubject | null
  /**
   * The active section and a way to switch it. Visvine draws the sections
   * (band tabs or a side list, from surfaces.nav); render only the active one.
   */
  export function useSection(): [string | null, (id: string) => void]
  /** Run handler when the person presses the band button \`id\` (surfaces.actions). */
  export function useBandAction(id: string, handler: () => void): void
  /**
   * The theme as raw CSS custom properties; prefer styling with var(--vv-*),
   * which the runtime keeps applied to :root and repaints live when the viewer
   * switches theme. Includes \`--vv-backdrop\` (the app's page backdrop, white)
   * for the rare case a value is needed in JS; the
   * frame is transparent, so never paint it as a page background yourself.
   */
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

  export interface CollectionQuery {
    where?: CollectionWhere
    mine?: boolean
    order?: 'asc' | 'desc'
    /** Rows to load (default 50, at most ${LIST_LIMIT_MAX}). */
    limit?: number
  }
  /** A collection's rows, reloaded when a write to it reaches this viewer (and on the live poll). */
  export function useCollection<T = Record<string, unknown>>(name: string, query?: CollectionQuery): QueryResult<CollectionRow<T>[]> & { refreshing: boolean }
  /** A collection's count, or its tally per value of groupBy, kept current the same way. */
  export function useCollectionCount(
    name: string,
    query?: { where?: CollectionWhere; mine?: boolean; groupBy?: string },
  ): QueryResult<{ total: number; groups?: Array<{ value: string | null; count: number }> }> & { refreshing: boolean }

  // ── components ──
  // The app's own components (@visvine/ui), and the kit's data-bound ones built
  // on the same tokens. Use these before writing your own CSS, so an installed
  // Tool looks like the app it is running inside.

  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand' | 'neutral' | 'danger-text'
  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant
    size?: 'sm' | 'md'
    loading?: boolean
    loadingText?: string
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
  export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'placeholder'> {
    options?: SelectOption[]
    children?: ReactNode
    /** The chosen value alone — simpler than onChange's event. */
    onValueChange?: (value: string) => void
    /** Shown until something is chosen. */
    placeholder?: string
    /** sm: a toolbar's height, beside a search and a view switch. */
    size?: 'sm' | 'md'
  }
  export function Select(props: SelectProps): JSX.Element

  export interface SegmentedOption {
    value: string
    label: string
  }
  export interface SegmentedProps {
    options: SegmentedOption[]
    value: string | null
    onChange: (value: string) => void
    label: string
    disabled?: boolean
    className?: string
  }
  /** Two to five joined buttons, one on — a vote on a scale, a view switch. */
  export function Segmented(props: SegmentedProps): JSX.Element

  /** A picture from the Drive (its thumb, through permissions.resources.read), or the initials of what it is of. */
  export function ResourceImage(props: { id: string | null | undefined; alt: string; shape?: 'square' | 'circle'; size?: number; className?: string }): JSX.Element
  /** A picture the viewer adds (a logo, a photo): uploads through permissions.resources.write and hands back the resource id. */
  export function ImageUpload(props: { value: string | null; onChange: (resourceId: string) => void; label: string; folder?: string; shape?: 'square' | 'circle'; size?: number; className?: string }): JSX.Element

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
    /** Share the board's width (four columns or fewer) instead of a fixed 18rem. */
    fill?: boolean
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

  // ── page blocks ──

  export type IconName = 'plus' | 'search' | 'filter' | 'check' | 'x' | 'trash' | 'edit' | 'calendar' | 'clock' | 'user' | 'users' | 'building' | 'dollar' | 'chart' | 'trend' | 'list' | 'board' | 'table' | 'star' | 'heart' | 'flag' | 'tag' | 'link' | 'mail' | 'message' | 'file' | 'folder' | 'box' | 'target' | 'trophy' | 'bolt' | 'bug' | 'book' | 'home' | 'settings' | 'arrowRight' | 'arrowUp' | 'arrowDown' | 'chevronLeft' | 'chevronRight' | 'more' | 'download' | 'upload' | 'sparkles' | 'inbox' | 'vote'
  export const ICON_NAMES: IconName[]
  export function Icon(props: { name: IconName; size?: number; className?: string }): JSX.Element
  /** The Tool's page: the app's gutter and gap-6 between blocks. The root of every Tool. */
  export function Page(props: { children: ReactNode; width?: 'wide' | 'normal'; className?: string }): JSX.Element
  export interface ToolbarView { value: string; label: string }
  /** search · filters · view switch (two looks at the same rows) · the primary action. */
  export function Toolbar(props: { search?: string; onSearch?: (value: string) => void; searchPlaceholder?: string; views?: ToolbarView[]; view?: string; onView?: (value: string) => void; filters?: ReactNode; actions?: ReactNode; className?: string }): JSX.Element
  export function Stat(props: { label: ReactNode; value: ReactNode; delta?: number; deltaLabel?: ReactNode; invert?: boolean; icon?: IconName; hint?: ReactNode }): JSX.Element
  export function StatRow(props: { children: ReactNode; className?: string }): JSX.Element
  export function Progress(props: { value: number; max?: number; hue?: Hue; label?: ReactNode; className?: string }): JSX.Element
  export function ListDetail<T>(props: { items: T[]; itemKey: (item: T) => string; selected: string | null; onSelect: (key: string) => void; renderItem: (item: T, selected: boolean) => ReactNode; detail: ReactNode; listHeader?: ReactNode; empty?: ReactNode; placeholder?: ReactNode }): JSX.Element
  export interface CalendarItem { id: string; /** YYYY-MM-DD */ date: string; title: ReactNode; hue?: Hue }
  export function MonthCalendar(props: { month: string; onMonth: (month: string) => void; items: CalendarItem[]; onOpen?: (id: string) => void; onDay?: (date: string) => void; weekStart?: 0 | 1 }): JSX.Element
  /** Today as YYYY-MM-DD. */
  export function todayIso(): string

  // ── records by schema ──
  // Describe a record's fields once; every view of it is drawn from that.

  export type Hue = 'gray' | 'red' | 'orange' | 'amber' | 'yellow' | 'green' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet' | 'pink'
  export const HUES: readonly Hue[]
  export type FieldKind = 'text' | 'longtext' | 'number' | 'money' | 'percent' | 'date' | 'select' | 'tags' | 'person' | 'email' | 'url' | 'boolean' | 'rating'
  export interface FieldOption { value: string; label?: string; hue?: Hue }
  export interface FieldDef {
    key: string
    label: string
    kind: FieldKind
    /** select / tags: the choices in order — a RecordBoard's columns. */
    options?: FieldOption[]
    required?: boolean
    /** money: ISO currency, default USD. */
    currency?: string
    placeholder?: string
    hideInTable?: boolean
  }
  export type RecordData = Record<string, unknown>
  export function optionsOf(field: FieldDef): Required<FieldOption>[]
  export function missingRequired(fields: FieldDef[], value: RecordData): string[]
  export function formatMoney(value: unknown, currency?: string): string
  export function formatNumber(value: unknown): string
  export function formatDate(value: unknown): string
  export function relativeDate(value: unknown): string
  /** Whole days from today; negative once passed. */
  export function daysFrom(value: unknown): number | null
  export function HueChip(props: { hue?: Hue; className?: string; children: ReactNode }): JSX.Element
  export function HueDot(props: { hue?: Hue; className?: string }): JSX.Element
  export function FieldValue(props: { field: FieldDef; value: unknown; compact?: boolean }): JSX.Element
  export function FieldInput(props: { field: FieldDef; value: unknown; onChange: (value: unknown) => void; id?: string; autoFocus?: boolean }): JSX.Element
  export function RecordForm(props: { fields: FieldDef[]; value: RecordData; onChange: (next: RecordData) => void; errors?: string[] }): JSX.Element
  export function RecordDialog(props: { open: boolean; title: ReactNode; fields: FieldDef[]; initial: RecordData; onClose: () => void; onSave: (value: RecordData) => Promise<void> | void; onDelete?: () => Promise<void> | void; saveLabel?: string }): JSX.Element
  export function RecordTable<T extends { id: string; data: RecordData }>(props: { fields: FieldDef[]; rows: T[]; onOpen?: (row: T) => void; empty?: ReactNode; trailing?: (row: T) => ReactNode; maxHeight?: number }): JSX.Element
  export function RecordBoard<T extends { id: string; data: RecordData }>(props: { fields: FieldDef[]; groupBy: string; rows: T[]; onMove: (row: T, toValue: string) => void; onOpen?: (row: T) => void; cardFields?: string[]; sumField?: string }): JSX.Element | null
  export function RecordsEmpty(props: { noun: string; onAdd?: () => void }): JSX.Element
  /** Seeds an empty collection once per install with sample rows; clear() removes exactly those. */
  export function useSampleRows(collection: string, rows: RecordData[]): { seeding: boolean; clear: () => Promise<void> }

  // ── the app's own (@visvine/ui) ──

  export function Alert(props: { variant?: 'error' | 'info' | 'warning' | 'success'; inline?: boolean; onDismiss?: () => void; className?: string; children: ReactNode }): JSX.Element
  export function Avatar(props: { name: string; imageUrl?: string | null; size?: 'xs' | 'sm' | 'md' | 'chip' | 'lg' | 'xl'; fallback?: 'silhouette' | 'initials' | 'space'; className?: string }): JSX.Element
  export function Checkbox(props: { checked: boolean; onChange: (checked: boolean) => void; label?: ReactNode; indeterminate?: boolean; disabled?: boolean; size?: 'sm' | 'md'; 'aria-label'?: string }): JSX.Element
  export function ConfirmDialog(props: { open: boolean; title: string; body?: ReactNode; confirmLabel?: string; destructive?: boolean; confirmText?: string; error?: ReactNode; onConfirm: () => void | Promise<void>; onClose: () => void }): JSX.Element | null
  export function IconButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode; size?: 'sm' | 'md'; active?: boolean }): JSX.Element
  export function LoadingText(props: { text?: string; className?: string }): JSX.Element
  export interface MenuItem {
    id: string
    label: string
    icon?: ReactNode
    onSelect: () => void
    danger?: boolean
    disabled?: boolean
  }
  export function Menu(props: { trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode; items: MenuItem[]; align?: 'start' | 'end'; placement?: 'below' | 'above'; label: string }): JSX.Element
  export function Modal(props: { onClose: () => void; open?: boolean; title?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'; children: ReactNode }): JSX.Element | null
  export function Row(props: { gap?: number; align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'; justify?: 'start' | 'center' | 'end' | 'between'; wrap?: boolean; className?: string; children?: ReactNode }): JSX.Element
  export function SearchInput(props: { value: string; onChange: (value: string) => void; placeholder?: string; autoFocus?: boolean; size?: 'sm' | 'md' | 'lg'; className?: string }): JSX.Element
  export function SettingsSection(props: { title: ReactNode; description?: ReactNode; action?: ReactNode; flush?: boolean; children?: ReactNode }): JSX.Element
  export function Skeleton(props: { className?: string }): JSX.Element
  export function Toggle(props: { checked: boolean; onChange: (checked: boolean) => void; label?: ReactNode; disabled?: boolean; 'aria-label'?: string }): JSX.Element
}
`

/**
 * The prose half — what an agent reads once before writing anything. Written
 * for a model, not a browser: short sections, whole examples, and the refusals
 * spelled out so the first compile is the working one.
 */
export const TOOL_AUTHOR_GUIDE = `# Building a Visvine Tool

A Tool is a small React app that runs inside a Visvine space. It renders in the
main content area, reads and writes the space's own notes and records, and can
call the space's connectors, agents, actions and AI — but only what it declares
up front.

Its files are notes in the space, so they have history, permissions and review
like anything else:

\`\`\`
tools/<name>/index.md        frontmatter = the manifest, body = docs for humans
tools/<name>/ui.tsx          the React component (compiled on write)
tools/<name>/src/<name>.tsx  optional: more modules, imported as './<name>'
tools/<name>/data.js         optional: server-side handlers (sandboxed isolate)
tools/<name>/icon.svg        optional: your own sidebar glyph
\`\`\`

## Start from a template

Most Tools are one of a few shapes — records that move through stages, entries
added up on a dashboard, a poll, a daily check-in, a directory, a leaderboard.
Each is a finished, designed Tool: \`plan_tool\` names the one that fits and
\`create_tool { template, spec }\` copies it with a spec that says what THIS one is
about (nouns, fields, stages, realistic sample rows). Write the code yourself only
when no template fits — and then build from the kit's blocks, not from divs:

\`\`\`tsx
const fields: FieldDef[] = [
  { key: 'name', label: 'Company', kind: 'text', required: true },
  { key: 'stage', label: 'Stage', kind: 'select', options: [{ value: 'Lead' }, { value: 'Won', hue: 'green' }] },
  { key: 'value', label: 'Value', kind: 'money' },
]
<Page>
  <StatRow><Stat label="Open" value={12} /></StatRow>
  <Toolbar search={q} onSearch={setQ} actions={<Button variant="primary">New deal</Button>} />
  <RecordBoard fields={fields} groupBy="stage" rows={rows} onMove={move} onOpen={open} />
  <RecordDialog open={…} title="New deal" fields={fields} initial={{}} onSave={save} onClose={close} />
</Page>
\`\`\`

Seed a collection with \`useSampleRows\` so the first look is the Tool working,
and look before you hand it over: \`check_tool { review: true }\` scores every
screen 0–10 with fixes; hand over at 8.5.

## index.md — the manifest

\`\`\`yaml
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
\`\`\`

A Tool written before manifests had \`sdk\` still works exactly as it did: its
\`perimeter:\` block (\`read\`, \`write\`, \`types\`, \`connectors\`, \`agents\`) is read as
the same permissions with no bindings, and it keeps kit 1. Declare reach one way
— \`permissions\` or \`perimeter\`, never both.

## Bindings and settings

A Tool names the KIND of thing it needs, not a path in one space. \`$deals/**\`
is "whatever folder this space bound \`deals\` to" — \`sales/pipeline/**\` here,
\`crm/deals/**\` there. In the space that wrote the Tool every slot is bound to its
\`suggest\`; an admin installing it elsewhere picks from the space's own folders,
types, connectors and agents. A folder slot may name a folder that does not
exist yet (your first write makes it); a type, connector or agent must exist.
An unbound slot runs the Tool degraded: \`visvine.degraded.missing.bindings\`
names it, and the reach it would have granted is simply absent.

Read what a slot is bound to, and the install's settings, from
\`visvine.install.bindings\` and \`visvine.install.settings\`.

## Sections and band buttons — optional

Visvine draws your Tool's chrome so it looks like the rest of the app: declare
\`surfaces.nav\` and your sections appear as tabs on the top band (or a list
beside your content with \`style: side\`), in the app's own style. Draw only the
content for the active one:

\`\`\`tsx
import { useSection, useBandAction } from '@visvine/tool-kit'

export default function App() {
  const [section] = useSection()          // 'board' | 'settings' | null
  useBandAction('new-deal', () => openNewDeal())
  return section === 'settings' ? <Settings /> : <Board />
}
\`\`\`

Switching sections never reloads your frame, so keep state you want to survive
a tab change above the switch. Labels are one to three words. Never draw your
own tab bar or page title — the band already names where the person is.

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

## Permissions

**The permissions are the whole security story.** Anything not declared is
refused at the bridge with a \`perimeter\` error, before any of the viewer's own
access is asked, and an admin reads them — bound to their space, in plain words —
before installing. Declare the narrowest reach that works.

They narrow; they never widen. A Tool can only ever see what the person using it
could already see. Two members with different grants running the same Tool see
different data, and that is correct.

| Family | Grammar | Unlocks |
| --- | --- | --- |
| \`context.read\` / \`write\` | note globs, or \`$slot/…\` | \`context.list/read/search/links\`, \`write/append\` |
| \`records.read\` / \`write\` | type names or \`$slot\`; writes list their fields | \`records.query/get\`, \`records.update\` |
| \`resources.read\` | globs over files' notes under \`resources/\`, or \`$slot\` | \`resources.list/get/read/blob\` |
| \`connectors\` | names or \`$slot\`, with \`actions\` for the ones you call | \`connectors.call\` |
| \`agents\` | names, \`prefix-*\`, or \`$slot\` | \`agents.run\` |
| \`actions\` | names tools may run: ${Object.keys(TOOL_ACTIONS).map((name) => '\`' + name + '\`').join(', ')} | \`actions.run\` |
| \`ai\` | \`{ complete, decide }\` | \`ai.complete\`, \`ai.decide\` |
| \`ui\` | \`{ download }\` | \`ui.download\` |

A Tool's own data — a collection — is not a permission: it is declared under
\`collections\`, with its own read and write rules (see Collections).

**\`tools/\`, \`agents/\`, \`connectors/\` and \`models/\` are sealed against Tool writes**,
whatever you declare — they hold configuration that runs — and a read of them
needs a glob that names them (\`**\` never reaches configuration). One exception: a
Tool may CREATE \`agents/<name>/index.md\` (an agent brief) when its own \`agents\`
names that agent, e.g. \`agents: ["deal-*"]\` for \`agents/deal-nightly/index.md\`. A
bare \`*\` names nobody. It may never rewrite a brief that already exists, never
append to one, and never write one that says \`active: true\`.

A Tool that declares \`ai\` writes as AI-assisted text: a folder frozen for AI
refuses its writes as it refuses an agent's.

## ui.tsx

\`\`\`tsx
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
\`\`\`

Rules:

- \`export default\` a component. It takes no props — everything arrives through
  \`useVisvine()\`.
- Import only \`react\`, \`react-dom\`, \`react-dom/client\`, \`@visvine/tool-kit\`, your
  own modules (\`./<name>\`), and the dependencies your manifest declares.
  There is no package install step and no npm at runtime; any other import fails
  to compile.
- Do not render your own page chrome. The app supplies the navbar, the sidebar,
  the band and the page frame. Your Tool is the content.
- The frame is sized to your content automatically. Do not use
  \`position: fixed\` or \`100vh\` — they measure the iframe, not the window, and
  a Tool cannot escape it anyway.
- \`visvine.subject\` is set when your Tool owns a type page: it is the note or
  node whose page is being rendered. It is null on your Tool's own page.

## Modules and dependencies

Split a large interface into modules under \`src/\` — \`src/board.tsx\`,
\`src/format.ts\` — and import them as \`./board\` and \`./format\`, from \`ui.tsx\`
and from each other (\`./src/board\` works from \`ui.tsx\` too). They compile into the one bundle, are reviewed with the
rest, and number at most ${MAX_TOOL_MODULES}. \`data.js\` stays one plain script.

Third-party code comes from one curated list, each package pinned to the one
version the server serves — declare it in \`dependencies\` and import it by name:

${Object.entries(CURATED_DEPENDENCIES).map(([name, dep]) => '- \`' + name + '\` ' + dep.version + ' — ' + dep.summary).join('\n')}

## What the kit gives you

The app's own components: \`Button\`, \`Input\`, \`Textarea\`, \`Select\`, \`Checkbox\`,
\`Toggle\`, \`SearchInput\`, \`Field\`, \`Chip\`, \`Tabs\`, \`Alert\`, \`Avatar\`, \`Menu\`,
\`IconButton\`, \`Modal\`, \`ConfirmDialog\`, \`SettingsSection\`, \`Skeleton\`,
\`LoadingText\`, \`Row\`, \`Stack\`. The kit's own, painted from the same tokens:
\`Banner\`, \`EmptyState\`, \`Spinner\`, \`Card\` (a flat section), \`PageHeader\`,
\`DatePicker\` (\`YYYY-MM-DD\` strings). Data: \`Table\` for a few rows, \`DataTable\`
for many (sortable columns, sticky header, \`maxHeight\` + \`virtualize\` for
thousands of rows). Content: \`Markdown\` renders a note body safely. Charts:
\`LineChart\`, \`BarChart\`, \`AreaChart\`, \`PieChart\` — recharts underneath, already
themed; the raw recharts API is on \`Recharts\` for anything else. Boards:
\`KanbanBoard\` / \`KanbanColumn\` / \`KanbanCard\` — you own the data, the board calls
\`onMove\` and you write the note or the record.

\`\`\`tsx
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
\`\`\`

## Design: sit on the app's canvas

Visvine paints one page background behind every page. Your Tool's frame is
**transparent**, so that backdrop shows through it exactly as it does behind a
native page, and the frame loads the app's own stylesheet — its tokens and the
components' styles. This only works if you leave the canvas alone:

- **Never paint a page background.** No \`background\` on \`html\`, \`body\`,
  \`#root\` or a full-page wrapper \`<div>\`.
- **Flat surfaces.** Sections separated by hairlines, no boxes around
  everything, a shadow only on something that floats (a menu, a dialog).
- **Colour comes from the theme.** Style your own markup with the design tokens,
  never literal colours — the viewer can switch the accent live and the runtime
  repaints \`:root\`, so a hardcoded hex is wrong a click later.

| Token | Use for |
| --- | --- |
| \`--vv-color-accent\` / \`-accent-strong\` / \`-accent-soft\` | The space's accent: primary actions, active states, soft highlights |
| \`--vv-color-surface\` | The one opaque surface (floats, inputs) |
| \`--vv-color-surface-subtle\` / \`-surface-muted\` | Translucent fills (hover, wells) |
| \`--vv-color-line-subtle\` / \`--vv-color-line\` | Hairlines / input borders |
| \`--vv-color-fg\` / \`-fg-secondary\` / \`-fg-muted\` | Ink, three volumes |
| \`--vv-color-danger\` \`--vv-color-warning\` \`--vv-color-info\` \`--vv-color-success\` | Status colours |
| \`--vv-chart-1..8\` | Chart series (or \`useChartColors()\`) |

The role classes the app paints with (\`text-fg-muted\`, \`bg-surface-subtle\`,
\`border-line-subtle\`) work in your markup too, as far as the app itself uses
them; for anything else, a \`style\` with a token. \`useTheme()\` returns the same
map for the rare JS-side need (a \`<canvas>\`, an exported image).

## Records

\`visvine.records.query(type, { where, order, limit, cursor })\` reads the records
of one type — the notes that declare a type the space invented, or the nodes of
one it is built on (people, organisations, events) — with their fields typed:

\`\`\`tsx
const won = await visvine.records.query('Deal', {
  where: [{ key: 'stage', op: 'eq', value: 'Won' }, { key: 'amount', op: 'range', min: 1000 }],
  order: { key: 'amount', direction: 'desc' },
})
await visvine.records.update({ path: won.rows[0].path }, { stage: 'Closed' })
\`\`\`

\`update\` writes only the fields \`permissions.records.write\` names, each parsed
by the field's kind the way the Directory's table parses a cell; a value that
does not read as its kind is refused, and a blank clears the field.

## Files, links and actions

\`visvine.resources.list({ folder, kind, q })\` lists the files and links inside
\`permissions.resources.read\` that the viewer can see; \`read(id)\` pages through
a file's extracted text; \`blob(id, 'thumb')\` hands back an image as a data URL
for an \`<img>\`. \`visvine.context.links(path)\` is a note's outgoing and incoming
links.

\`visvine.actions.run(name, input)\` runs one of the actions tools may run, in
this space only — \`space_id\` is set for you, and naming another space is
refused. Every id it is handed (an event, a file, a channel) is checked to be
this space's, and a file to be inside your \`resources\` permission, first.

## The space's AI

\`await visvine.ai.complete('Summarise: …')\` is one answer from the space's own
model, on its key and under its monthly cap (\`{ system, messages, maxTokens }\`
for a conversation). \`visvine.ai.decide(items, questions)\` asks the platform's
judge the same questions about many texts — \`yes_no\`, \`choice\` or \`scale\` — and
answers with numbers; it is literal, so ask plain statements about what the text
says, never about dates or amounts. Both need \`permissions.ai\`, and a Tool that
declares either writes as AI-assisted text.

## The app's own dialogs

The frame has no popups, no downloads and no navigation of its own; the app does
these for you, in its chrome: \`visvine.ui.toast(message, tone)\`,
\`await visvine.ui.confirm({ title, destructive })\`,
\`await visvine.ui.download({ filename, content, mimeType })\` (needs
\`permissions.ui.download\`; the app names the file and asks),
\`visvine.ui.openRecord({ path } | { nodeId })\`, \`visvine.ui.openResource(id)\`.

## Live data

\`useLiveQuery\` is \`useQuery\` that stays current:

\`\`\`tsx
const deals = useLiveQuery(() => visvine.context.list('deals/**'), [], { paths: ['deals/**'] })
\`\`\`

When a note inside your read permission is written, renamed or deleted, Visvine
tells the frame which paths changed and the query re-runs if one matches
\`paths\` (or on any change when \`paths\` is omitted). This is **best-effort**:
the change feed is per server process and a change on another instance, or a
dropped connection, is not delivered — so the hook also re-runs every 30
seconds (\`pollMs\`), which is the guarantee. Refreshes never flip \`loading\`
back on; read \`refreshing\` if you want a subtle indicator. Do not build your
own poll on top of it.

## Paging

\`context.list\` and \`context.search\` cap at ${BRIDGE_LIMITS.maxRows} rows. For more, page:
\`visvine.context.listPage(glob, cursor)\` / \`searchPage(query, { k, cursor })\`
answer \`{ items, nextCursor }\`; hand \`nextCursor\` back until it is null. In the
UI, \`usePagedList(glob, { pageSize })\` accumulates \`items\` and gives you
\`hasMore\` / \`loadMore\`. \`records.query\` and \`resources.list\` page the same way,
with \`cursor\`.

## data.js

Optional. Use it when the work should not happen in the browser — a connector
call with a large response, a computation over many notes.

\`\`\`js
handlers.summary = async (args, visvine) => {
  const notes = await visvine.context.list('deals/**')
  const open = notes.filter((n) => n.type === 'deal')
  return { count: open.length, latest: open[0]?.path ?? null }
}
\`\`\`

Call it from the UI with \`visvine.data.call('summary', { ... })\`.

Handlers run in a sandboxed isolate with the same \`visvine\` object the UI has
and the same permissions. There is no filesystem, no socket and no \`process\`; a
handler that has not returned within ${Math.round(BRIDGE_LIMITS.dataCallTimeoutMs / 1000)} seconds is killed.
Handlers also get \`visvine.crypto\` — \`hmac(alg, key, data)\`, \`hash(alg, data)\`,
\`randomHex(n)\`, \`base64.encode/decode\`, \`timingSafeEqual(a, b)\`.

\`visvine.connectors.call(name, code)\` runs JavaScript inside a declared
connector's isolate; \`visvine.connectors.call(name, { action, args })\` runs one
of the connector's named actions instead — the reviewable choice when the
connector offers one.

## Collections

A collection is the Tool's own store — votes, sign-ups, check-ins — kept per
install, not in the space's notes. Declare it under \`collections\` with a JSON
Schema (\`type\`, \`properties\`, \`required\`, \`additionalProperties\`, \`enum\`,
\`const\`, \`minimum\`/\`maximum\`, \`minLength\`/\`maxLength\`, \`items\`,
\`minItems\`/\`maxItems\`; \`title\`, \`description\`, \`default\` and \`format\` are
accepted and check nothing; no \`pattern\`), and who reads and writes it:

| Rule | all | own | admin |
| --- | --- | --- | --- |
| \`read\` | everyone reads every row | each viewer their own rows; admins all | admins only |
| \`write\` | anyone changes any row | anyone adds; a row is changed by whoever wrote it, or an admin | admins only |

\`\`\`tsx
const { data: votes } = useCollectionCount('votes', { groupBy: 'choice' })
const { data: mine } = useCollection('votes', { mine: true })
await visvine.collections.insert('votes', { choice: 'a' })
\`\`\`

A row never says who wrote it — only \`mine\`. Rows are written as the viewer:
their account going takes their rows with it. Uninstalling keeps the rows for
${DETACHED_DAYS} days, for the Tool installed here again to take back; an admin can
export them from the install's row in the console. \`where\` matches top-level
fields exactly; \`groupBy\` counts per value of one field. A preview keeps its
own rows, apart from any install's.

## State

\`visvine.state\` is a small key/value store — there is no \`localStorage\` in the
sandbox. In kit 2 a value is the viewer's own unless you say otherwise:
\`set('filter', f)\` remembers this person's filter, \`set('layout', l, { scope:
'install' })\` is one value everyone sees. It is for UI preferences, not space
data — that belongs in notes and records, where it is searchable and shared.

## Limits

| What | Cap |
| --- | --- |
| Rows from one list, search or query | ${BRIDGE_LIMITS.maxRows} |
| Bytes from one \`context.read\` | ${BRIDGE_LIMITS.maxReadBytes.toLocaleString('en-US')} |
| Bytes in one \`context.write\` / \`context.append\` | ${BRIDGE_LIMITS.maxWriteBytes.toLocaleString('en-US')} |
| Bytes of params in one call | ${BRIDGE_LIMITS.maxParamsBytes.toLocaleString('en-US')} |
| Calls per minute, per viewer | ${BRIDGE_LIMITS.callsPerMinute} |
| One \`data.call\` | ${Math.round(BRIDGE_LIMITS.dataCallTimeoutMs / 1000)}s |
| One \`resources.read\` page | ${BRIDGE_LIMITS.maxResourceReadChars.toLocaleString('en-US')} characters |
| One \`resources.blob\` | ${BRIDGE_LIMITS.maxBlobBytes.toLocaleString('en-US')} bytes |
| One \`ai.complete\` answer | ${BRIDGE_LIMITS.aiMaxOutputTokens.toLocaleString('en-US')} tokens |
| Items in one \`ai.decide\` | ${BRIDGE_LIMITS.aiMaxDecideItems} |
| One \`state.set\` value, serialized | ${STATE_MAX_BYTES.toLocaleString('en-US')} bytes |
| Keys in \`visvine.state\`, per scope | ${STATE_MAX_KEYS} |

An unpaged list that would exceed the row cap comes back truncated, not as an
error — page to see the rest.

## Failure

Every bridge method rejects with a \`BridgeCallError\` carrying a \`code\`:

| Code | Means |
| --- | --- |
| \`perimeter\` | Your Tool never declared this reach. Fix the manifest. |
| \`forbidden\` | The viewer cannot do it. Not yours to fix — handle it. |
| \`not_found\` | No such note, record, file, connector or agent. |
| \`degraded\` | This space lacks something you declared, or a slot is unbound; see \`visvine.degraded\`. |
| \`rate_limited\` | Too many calls, or a budget spent. Back off. |
| \`too_large\` | Over one of the caps above. |
| \`timeout\` | A \`data.call\` or the model ran too long. |
| \`invalid\` | Bad params. |
| \`internal\` | Visvine's fault. |

Show the failure in your own pane — a \`Banner\` with the message — rather than
rendering nothing. If \`visvine.degraded\` is set, say so once at the top: reads
against the missing pieces come back empty, so a Tool that stays silent looks
broken instead of incomplete.

## Kit 1

A Tool whose manifest says \`sdk: ^1\`, or has no \`sdk\` because it was written
before kit 2, keeps kit 1: its own component set and stylesheet, one shared
\`state\` value per key, and everything else above. Moving to kit 2 is changing
\`sdk\` to \`^2\` and checking the page — the components keep their names and props.

## Do / don't

**Do**

- Keep the permissions as narrow as the Tool actually needs, and bind by kind
  (\`$deals/**\`) rather than naming one space's folders.
- Use the kit's components. They are the app's, so an installed Tool looks like
  Visvine and not like a twelfth website.
- Style your own markup with the design tokens, so it follows a live theme
  switch the way the kit does.
- Read \`visvine.viewer.isAdmin\` to hide admin-only affordances — but never to
  protect data. The server decides that.

**Don't**

- Don't reach for \`localStorage\`, \`document.cookie\`, \`fetch\` or \`window.parent\`.
  The frame is sandboxed on a cookie-less origin with no network of its own;
  all four either fail or do nothing. \`visvine.state\` replaces the first two.
- Don't import a UI library or a CSS framework. Nothing resolves at runtime but
  the list above, and the bundle has a size cap.
- Don't paint a page background or hardcode colours.
- Don't poll. Query on mount and after a write, and use \`useLiveQuery\` where
  staying current matters — it already polls, gently.
- Don't put a secret in \`ui.tsx\`, a module or \`data.js\`. All are readable by
  anyone who can read the note, and a published Tool ships its source into the
  registry.
`
