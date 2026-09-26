// Type definitions for @visvine/tool-kit — the kit a Visvine Tool imports.
// Generated from the Visvine server’s own SDK docs — edits here are overwritten.
// At runtime the frame's import map serves the kit; this package carries its
// types and the offline runtime `visvine-tool dev` runs a Tool on.

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

/** What every method below rejects with. Branch on `code`. */
export class BridgeCallError extends Error {
  readonly code: BridgeErrorCode
}

// ── the bridge ──

export interface VisvineApi {
  context: {
    /** Notes in the read perimeter, path order, capped at one page (200 rows). */
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
    /** Records of a type in permissions.records, filtered, ordered, a page at a time (200 max). */
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
    /** The text extracted from a file, 20,000 characters a page. */
    read(id: string, offset?: number): Promise<{ text: string; offset: number; totalChars: number; nextOffset: number | null }>
    /** The bytes (or a thumb/preview image) as a data URL an <img> can draw; 2,000,000 bytes at most. */
    blob(id: string, rendition?: 'original' | 'thumb' | 'preview'): Promise<{ mimeType: string; dataUrl: string }>
    /** Add a file the viewer chose into a folder permissions.resources.write names (the first when none is given); 5,000,000 bytes at most. */
    upload(file: { name: string; dataUrl: string; folder?: string }): Promise<ToolResource>
  }
  collections: {
    /** Add a row to a collection this Tool declares; checked against its schema, 16 KB at most. */
    insert<T extends object = Record<string, unknown>>(collection: string, data: T): Promise<CollectionRow<T>>
    /** Rows, oldest first unless order is 'desc', 200 a page at most; mine for the viewer's own. */
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
/** Run handler when the person presses the band button `id` (surfaces.actions). */
export function useBandAction(id: string, handler: () => void): void
/**
 * The theme as raw CSS custom properties; prefer styling with var(--vv-*),
 * which the runtime keeps applied to :root and repaints live when the viewer
 * switches theme. Includes `--vv-backdrop` (the app's page backdrop, white)
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
  /** Rows to load (default 50, at most 200). */
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
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: SelectOption[]
  children?: ReactNode
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
