// The Directory's table view, as a model: which columns a type has, what a
// cell holds, how a viewer's arrangement of them is kept, and how a space
// extends a type with fields of its own.
//
// A type's columns come from three places, in this order:
//
//   core     name · alias, then tags · updated · edited by · added · added
//            by — what every record has, whatever its type
//   type     the property rows the type already shows on its note
//            (lib/types/typeFields.ts): a Person's role, company, location…
//   tracked  what THIS space decided to track about the type
//            (NodeTypeConfig.fields, admin-authored here via addTrackedField)
//
// A tracked field's value lives at `node.metadata[key]` — the same blob the
// property rows write and `PATCH /api/nodes/<id>` merges — and is mirrored
// into the entity note's frontmatter under the same key
// (lib/notes/context/entityNodes.ts), so an agent reading `people/craig/index.md`
// sees the space's own fields beside the platform's. The schema is space
// config, the values are node data: adding a field never touches a node,
// and removing one leaves the values in place, unlisted.
//
// A viewer's arrangement (order, hidden columns, sort, widths) is theirs alone
// and lives in the browser (features/directory/hooks/useTableView.ts); this
// module only defines the shape and the rules for reconciling it with the
// columns that exist now.
//
// Pure — no DOM, no Prisma — so tests/directory-table.test.ts covers it directly.

import { canonicalType, fieldsForType } from '@/lib/types/typeFields'
import { timeAgo } from '@/lib/date'
import type { DirectoryItem, NodeTypeConfig, TrackedField, TrackedFieldKind } from '@/lib/types'

type ColumnKind = TrackedFieldKind | 'location' | 'tags' | 'alias'

type ColumnSource = 'name' | 'alias' | 'tags' | 'column' | 'metadata' | 'record'

/** The DirectoryItem keys a `source: 'record'` column reads — the facts every record has. */
type RecordField = 'createdAt' | 'updatedAt' | 'editedBy' | 'addedBy'

export interface TableColumn {
  /** Stable id; the metadata key for `source: 'metadata'`. */
  key: string
  label: string
  kind: ColumnKind
  source: ColumnSource
  /** The node column, for `source: 'column'`. */
  column?: 'subtitle' | 'location' | 'url'
  /** The item field, for `source: 'record'`. */
  field?: RecordField
  /** A date read as its distance from now ("3d ago") rather than a day. */
  relative?: boolean
  origin: 'core' | 'type' | 'tracked'
  /** Whether the cell takes an inline edit. */
  editable: boolean
  /** The choices of a `select` column. */
  options?: string[]
  /** A column-backed value that ALSO lands in metadata under this key (typeFields.mirrorMetadataKey). */
  mirror?: string
  /** Present, but out of the way until a viewer asks for it. */
  defaultHidden?: boolean
}

export const TRACKED_FIELD_KINDS: ReadonlyArray<{ value: TrackedFieldKind; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'Link' },
  { value: 'email', label: 'Email' },
]

const CORE_HEAD: TableColumn[] = [
  { key: 'name', label: 'Name', kind: 'text', source: 'name', origin: 'core', editable: true },
  // The alias column reads **Type**: an alias IS what this space calls this
  // kind of record — Founder, Investor, Portfolio — and that is the question
  // the column answers. The node type isn't a column; it is the table you are
  // in, named by the rail. The key stays `alias`: it is what a stored
  // arrangement and the alias filters name. Assigned, not typed — manage_alias
  // and the Members console own it — and it sits beside the name because it is
  // what the row IS.
  { key: 'alias', label: 'Type', kind: 'alias', source: 'alias', origin: 'core', editable: false },
]

const CORE_TAIL: TableColumn[] = [
  { key: 'tags', label: 'Tags', kind: 'tags', source: 'tags', origin: 'core', editable: true },
  // What every record has, from its note (lib/directory/recordFacts.ts). Read
  // only: the note's own history writes them.
  { key: 'updated', label: 'Updated', kind: 'date', source: 'record', field: 'updatedAt', relative: true, origin: 'core', editable: false },
  { key: 'editedBy', label: 'Edited by', kind: 'text', source: 'record', field: 'editedBy', origin: 'core', editable: false },
  { key: 'created', label: 'Added', kind: 'date', source: 'record', field: 'createdAt', origin: 'core', editable: false },
  { key: 'addedBy', label: 'Added by', kind: 'text', source: 'record', field: 'addedBy', origin: 'core', editable: false },
]

/**
 * The order a type's own columns read in — its page's order, near enough:
 * who someone is and where they work before how to reach them, an event's
 * when before its where. A key the list doesn't name keeps its place after
 * the ones it does, so a property row added to typeFields still appears.
 */
const TYPE_COLUMN_ORDER: Record<string, string[]> = {
  person: ['subtitle', 'companyName', 'email', 'phone', 'location', 'linkedinUrl', 'twitterUrl', 'website', 'pronouns', 'bio'],
  space: ['subtitle', 'url', 'location', 'founded', 'memberCount'],
  event: ['start_at', 'end_at', 'location', 'capacity', 'organizerEmail'],
  resource: ['subtitle', 'url'],
}

/**
 * What an entity's own page keeps that its property rows don't. A person's
 * profile fields ride the directory feed already — lib/eventRepo.ts overlays
 * the `Person` row onto a person node's metadata — so the table can show them
 * beside the node's own.
 *
 * They are READ-ONLY here, and so is every profile-owned key among the
 * property rows (PROFILE_OWNED_KEYS): the writer is the member's own profile
 * (PATCH /api/profile/<personId>), while PATCH /api/nodes/<id> writes the
 * node. A cell edit would land on the node and the next fetch would overlay
 * it straight back off.
 */
const PAGE_COLUMNS: Record<string, TableColumn[]> = {
  person: [
    { key: 'phone', label: 'Phone', kind: 'text', source: 'metadata', origin: 'type', editable: false, defaultHidden: true },
    { key: 'twitterUrl', label: 'X', kind: 'url', source: 'metadata', origin: 'type', editable: false, defaultHidden: true },
    { key: 'website', label: 'Website', kind: 'url', source: 'metadata', origin: 'type', editable: false, defaultHidden: true },
    { key: 'pronouns', label: 'Pronouns', kind: 'text', source: 'metadata', origin: 'type', editable: false, defaultHidden: true },
    { key: 'bio', label: 'Bio', kind: 'text', source: 'metadata', origin: 'type', editable: false, defaultHidden: true },
  ],
}

/** Person keys the profile owns, whichever list they came from. */
const PROFILE_OWNED_KEYS = new Set(['bio', 'website', 'linkedinUrl', 'twitterUrl', 'phone', 'pronouns'])

/**
 * An agent's columns are its RECORD (lib/agents/shared/agentConfig.ts) and its
 * live state, not node metadata: the agents table builds each row's
 * `metadata` from the roster (features/agents/lib/agentRows.ts) under these
 * keys. Model is the one edited in place — it goes to the agent's config route;
 * everything else is edited on the agent's own Config.
 */
const AGENT_COLUMNS: TableColumn[] = [
  { key: 'status', label: 'Status', kind: 'text', source: 'metadata', origin: 'type', editable: false },
  { key: 'active', label: 'On', kind: 'checkbox', source: 'metadata', origin: 'type', editable: false },
  { key: 'schedule', label: 'Schedule', kind: 'text', source: 'metadata', origin: 'type', editable: false },
  { key: 'nextRun', label: 'Next run', kind: 'text', source: 'metadata', origin: 'type', editable: false },
  { key: 'lastRun', label: 'Last run', kind: 'text', source: 'metadata', origin: 'type', editable: false },
  { key: 'model', label: 'Model', kind: 'select', source: 'metadata', origin: 'type', editable: true },
  { key: 'connectors', label: 'Connectors', kind: 'text', source: 'metadata', origin: 'type', editable: false },
  { key: 'tools', label: 'Tools', kind: 'text', source: 'metadata', origin: 'type', editable: false },
  { key: 'runsFor', label: 'Runs for', kind: 'text', source: 'metadata', origin: 'type', editable: false },
  { key: 'failures', label: 'Failures', kind: 'number', source: 'metadata', origin: 'type', editable: false, defaultHidden: true },
]

/**
 * The columns a type has, in their canonical order. `config` is the space's
 * own entry for the type (findNodeTypeConfig) and supplies the tracked fields;
 * without it the type still has its core and property-row columns.
 * `modelOptions` are the choices of an agent's Model cell.
 */
export function columnsForType(type: string, config?: NodeTypeConfig | null, opts: { modelOptions?: string[] } = {}): TableColumn[] {
  const canonical = canonicalType(type)
  if (canonical === 'agent') {
    const model = { ...AGENT_COLUMNS.find((c) => c.key === 'model')!, options: opts.modelOptions ?? [] }
    return [CORE_HEAD[0], ...AGENT_COLUMNS.map((c) => (c.key === 'model' ? model : c)), CORE_TAIL[0]].map((c) =>
      c.key === 'tags' || c.key === 'name' ? { ...c, editable: false } : c,
    )
  }
  const order = TYPE_COLUMN_ORDER[canonical] ?? []
  const rank = (key: string) => {
    const i = order.indexOf(key)
    return i === -1 ? order.length : i
  }
  const typeColumns: TableColumn[] = [
    ...fieldsForType(type)
      // The photo is the name cell's avatar, not a column of its own.
      .filter((f) => f.kind !== 'image')
      .map((f): TableColumn => ({
        key: f.key,
        label: f.label,
        kind: f.kind as ColumnKind,
        source: f.target === 'column' ? 'column' : 'metadata',
        ...(f.target === 'column' && f.column && f.column !== 'image_url' ? { column: f.column } : {}),
        origin: 'type',
        editable: true,
        ...(f.mirrorMetadataKey ? { mirror: f.mirrorMetadataKey } : {}),
      })),
    ...(PAGE_COLUMNS[canonical] ?? []),
  ]
    .map((c) => (canonical === 'person' && PROFILE_OWNED_KEYS.has(c.key) ? { ...c, editable: false } : c))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.key) - rank(b.c.key) || a.i - b.i)
    .map((x) => x.c)

  const seen = new Set([...CORE_HEAD, ...typeColumns, ...CORE_TAIL].map((c) => c.key))
  const tracked: TableColumn[] = []
  for (const field of config?.fields ?? []) {
    // A stored field that collides with a platform column is skipped rather
    // than shown twice — addTrackedField refuses these, but the config note
    // is hand-editable.
    if (seen.has(field.key)) continue
    seen.add(field.key)
    tracked.push({
      key: field.key,
      label: field.label,
      kind: field.kind,
      source: 'metadata',
      origin: 'tracked',
      editable: true,
      ...(field.kind === 'select' ? { options: field.options ?? [] } : {}),
    })
  }
  return [...CORE_HEAD, ...typeColumns, ...tracked, ...CORE_TAIL]
}

/**
 * The rows with a non-alias `alias` cleared. `Node.alias` is not always an
 * alias: an event's is its `/e/<slug>` URL slug (lib/eventRepo.ts), and a slug
 * is not what the space calls that kind of record. Only a name the space
 * defines as an alias counts as one — everything else reads as no alias, and
 * the Type cell says what the row IS instead.
 */
export function withKnownAliases(items: DirectoryItem[], aliasNames: ReadonlySet<string>): DirectoryItem[] {
  return items.map((i) => (i.alias && !aliasNames.has(i.alias) ? { ...i, alias: null } : i))
}

// ── cells ───────────────────────────────────────────────────────────────────

/** The raw value behind a cell, or undefined when the item has none. */
export function cellValue(item: DirectoryItem, column: TableColumn): unknown {
  switch (column.source) {
    case 'name':
      return item.name
    case 'alias':
      return item.alias ?? undefined
    case 'tags':
      return item.tags ?? []
    case 'record':
      return column.field ? item[column.field] : undefined
    case 'column':
      return column.column ? item[column.column] ?? undefined : undefined
    case 'metadata':
      return item.metadata?.[column.key]
  }
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toTime(value: unknown): number | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * A cell as text. Dates render through the viewer's locale; a link drops its
 * scheme so a column of websites reads as names, not addresses.
 */
export function formatCell(value: unknown, column: TableColumn): string {
  if (isBlank(value)) return ''
  switch (column.kind) {
    case 'tags':
      return Array.isArray(value) ? value.map(String).join(', ') : String(value)
    case 'checkbox':
      return value === true || value === 'true' ? 'Yes' : ''
    case 'number': {
      const n = toNumber(value)
      return n === null ? String(value) : n.toLocaleString()
    }
    case 'date': {
      const t = toTime(value)
      if (t === null) return String(value)
      if (column.relative) return timeAgo(t, { style: 'short' })
      const s = String(value)
      // A bare day ("2026-03-15") is a day, not a moment — showing a time for
      // it would be the viewer's midnight, which is nobody's schedule.
      return /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    }
    case 'url':
      return String(value).replace(/^https?:\/\//, '').replace(/\/$/, '')
    default:
      return String(value)
  }
}

/** The value as the editor should start from — an input's string. */
export function editValue(value: unknown, column: TableColumn): string {
  if (isBlank(value)) return ''
  if (column.kind === 'tags') return Array.isArray(value) ? value.map(String).join(', ') : String(value)
  if (column.kind === 'date') {
    const s = String(value)
    // The picker takes a day; an ISO instant is cut to its day.
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
    return m ? m[1] : ''
  }
  return String(value)
}

/**
 * A URL the cell can link to, or null. Only link and email columns, and
 * only when the value looks like one: the point is not to turn free text
 * into a click.
 */
export function cellHref(value: unknown, column: TableColumn): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const v = value.trim()
  if (column.kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : null
  if (column.kind === 'url') {
    if (/^https?:\/\//i.test(v)) return v
    return /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v) ? `https://${v}` : null
  }
  return null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Order two values of one column; blanks sort last in either direction. */
export function compareCells(a: unknown, b: unknown, column: TableColumn): number {
  const aBlank = isBlank(a)
  const bBlank = isBlank(b)
  if (aBlank && bBlank) return 0
  if (aBlank) return 1
  if (bBlank) return -1
  switch (column.kind) {
    case 'number': {
      const na = toNumber(a)
      const nb = toNumber(b)
      if (na !== null && nb !== null) return na - nb
      break
    }
    case 'date': {
      const ta = toTime(a)
      const tb = toTime(b)
      if (ta !== null && tb !== null) return ta - tb
      break
    }
    case 'checkbox': {
      const ba = a === true || a === 'true' ? 1 : 0
      const bb = b === true || b === 'true' ? 1 : 0
      return bb - ba
    }
    case 'tags':
      return collator.compare(formatCell(a, column), formatCell(b, column))
  }
  return collator.compare(String(a), String(b))
}

export interface TableSort {
  key: string
  dir: 'asc' | 'desc'
}

/** The rows in the sort's order. Ties keep the incoming order. */
export function sortItems(items: DirectoryItem[], columns: TableColumn[], sort: TableSort | null): DirectoryItem[] {
  if (!sort) return items
  const column = columns.find((c) => c.key === sort.key)
  if (!column) return items
  const sign = sort.dir === 'asc' ? 1 : -1
  return items
    .map((item, index) => ({ item, index, value: cellValue(item, column) }))
    .sort((a, b) => {
      const aBlank = isBlank(a.value)
      const bBlank = isBlank(b.value)
      // Blanks stay last however the direction flips.
      if (aBlank !== bBlank) return aBlank ? 1 : -1
      const c = compareCells(a.value, b.value, column) * sign
      return c !== 0 ? c : a.index - b.index
    })
    .map((r) => r.item)
}

/** The next sort after clicking a header: asc → desc → off. */
export function cycleSort(current: TableSort | null, key: string): TableSort | null {
  if (!current || current.key !== key) return { key, dir: 'asc' }
  if (current.dir === 'asc') return { key, dir: 'desc' }
  return null
}

// ── the viewer's arrangement ────────────────────────────────────────────────

export interface TableView {
  /** Column keys in display order. Keys not listed fall in at their canonical place. */
  order: string[]
  hidden: string[]
  sort: TableSort | null
  /** Pixel widths a viewer dragged; unlisted columns use their kind's default. */
  widths: Record<string, number>
}

export const EMPTY_VIEW: TableView = { order: [], hidden: [], sort: null, widths: {} }

export const MIN_COLUMN_WIDTH = 72
export const MAX_COLUMN_WIDTH = 640

/** The width a column starts at, by what it holds. */
export function defaultWidth(column: TableColumn): number {
  if (column.source === 'name') return 240
  switch (column.kind) {
    case 'checkbox':
      return 96
    case 'number':
      return 110
    case 'date':
      return 130
    case 'alias':
    case 'select':
      return 140
    case 'tags':
      return 220
    case 'url':
    case 'email':
      return 200
    default:
      return 180
  }
}

/**
 * The columns a viewer sees, in their order: the stored order first (keys
 * that still exist), then any column the view has never met, at its
 * canonical position — so a field an admin just added appears rather than
 * waiting to be switched on. A viewer's `hidden` is honoured for anything it
 * names; the platform's own defaults apply only to columns the view has
 * never seen.
 */
export function visibleColumns(view: TableView, columns: TableColumn[]): TableColumn[] {
  return arrangeColumns(view, columns).filter((c) => !isHidden(view, c))
}

/** Every column in the viewer's order, hidden ones included. */
export function arrangeColumns(view: TableView, columns: TableColumn[]): TableColumn[] {
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const ordered: TableColumn[] = []
  const placed = new Set<string>()
  for (const key of view.order) {
    const c = byKey.get(key)
    if (c && !placed.has(key)) {
      ordered.push(c)
      placed.add(key)
    }
  }
  // Unmet columns slot in after the last placed column that canonically
  // precedes them, so "name, role, [new field], alias" comes out that way.
  for (const c of columns) {
    if (placed.has(c.key)) continue
    const canonicalIndex = columns.indexOf(c)
    let at = ordered.length
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (columns.indexOf(ordered[i]) < canonicalIndex) {
        at = i + 1
        break
      }
      at = i
    }
    ordered.splice(at, 0, c)
    placed.add(c.key)
  }
  return ordered
}

/** Hidden by the viewer, or by default for a column the viewer never touched. */
export function isHidden(view: TableView, column: TableColumn): boolean {
  if (view.hidden.includes(column.key)) return true
  // A viewer who ordered a column has met it; the default only applies before that.
  if (view.order.includes(column.key)) return false
  return column.defaultHidden === true
}

/** Show or hide one column. Naming it in `order` records that it has been met. */
export function toggleColumn(view: TableView, columns: TableColumn[], key: string): TableView {
  const column = columns.find((c) => c.key === key)
  if (!column) return view
  const order = arrangeColumns(view, columns).map((c) => c.key)
  const hidden = isHidden(view, column)
    ? view.hidden.filter((k) => k !== key)
    : [...view.hidden.filter((k) => k !== key), key]
  return { ...view, order, hidden }
}

/** Move a column one step, in the viewer's full order (hidden ones included). */
export function moveColumn(view: TableView, columns: TableColumn[], key: string, dir: -1 | 1): TableView {
  const order = arrangeColumns(view, columns).map((c) => c.key)
  const from = order.indexOf(key)
  const to = from + dir
  if (from < 0 || to < 0 || to >= order.length) return view
  order.splice(from, 1)
  order.splice(to, 0, key)
  return { ...view, order }
}

/**
 * Drop a dragged column in front of another (or at the end, `before: null`),
 * in the viewer's full order — hidden columns keep their places between.
 */
export function placeColumnBefore(view: TableView, columns: TableColumn[], key: string, before: string | null): TableView {
  const order = arrangeColumns(view, columns).map((c) => c.key)
  const from = order.indexOf(key)
  if (from < 0 || key === before) return view
  order.splice(from, 1)
  const to = before === null ? order.length : order.indexOf(before)
  if (to < 0) return view
  order.splice(to, 0, key)
  return { ...view, order }
}

export function setColumnWidth(view: TableView, key: string, width: number): TableView {
  const clamped = Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)))
  return { ...view, widths: { ...view.widths, [key]: clamped } }
}

/** Forget the viewer's arrangement of columns, keeping their sort. */
export function resetColumns(view: TableView): TableView {
  return { ...view, order: [], hidden: [], widths: {} }
}

/** A stored view, whatever a previous version of the app wrote, as one the code can hold. */
export function coerceView(raw: unknown): TableView {
  if (!raw || typeof raw !== 'object') return EMPTY_VIEW
  const r = raw as Record<string, unknown>
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const sort =
    r.sort && typeof r.sort === 'object' && typeof (r.sort as TableSort).key === 'string'
      ? { key: (r.sort as TableSort).key, dir: (r.sort as TableSort).dir === 'desc' ? ('desc' as const) : ('asc' as const) }
      : null
  const widths: Record<string, number> = {}
  if (r.widths && typeof r.widths === 'object') {
    for (const [k, v] of Object.entries(r.widths as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) widths[k] = v
    }
  }
  return { order: strings(r.order), hidden: strings(r.hidden), sort, widths }
}

// ── editing ─────────────────────────────────────────────────────────────────

export type CellPatch = {
  name?: string
  tags?: string[]
  subtitle?: string
  location?: string
  url?: string
  metadata?: Record<string, unknown>
}

export type ParsedCell = { ok: true; value: unknown } | { ok: false; error: string }

/**
 * What a typed string means for a column. Blank is "clear". A number that
 * isn't one is refused rather than stored as text, because the column would
 * then sort two ways.
 */
export function parseCellInput(raw: string, column: TableColumn): ParsedCell {
  const text = raw.trim()
  if (column.source === 'name' && !text) return { ok: false, error: 'A name is required' }
  if (!text) return { ok: true, value: column.kind === 'tags' ? [] : null }
  switch (column.kind) {
    case 'number': {
      const n = Number(text.replace(/,/g, ''))
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'Not a number' }
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(text).getTime())
        ? { ok: true, value: text }
        : { ok: false, error: 'Use a date like 2026-03-15' }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? { ok: true, value: text } : { ok: false, error: 'Not an email address' }
    case 'checkbox':
      return { ok: true, value: /^(yes|true|y|1|✓)$/i.test(text) }
    case 'select':
      return column.options?.includes(text) ? { ok: true, value: text } : { ok: false, error: 'Not one of the options' }
    case 'tags': {
      const seen = new Set<string>()
      const tags: string[] = []
      for (const t of text.split(',')) {
        const tag = t.trim()
        const k = tag.toLowerCase()
        if (!tag || seen.has(k)) continue
        seen.add(k)
        tags.push(tag)
      }
      return { ok: true, value: tags }
    }
    default:
      return { ok: true, value: text }
  }
}

/**
 * The `PATCH /api/nodes/<id>` body that stores one cell. A column-backed
 * value goes to its column (and its metadata mirror, when the identity
 * resolver reads one); everything else merges into metadata. Null clears —
 * the route stores an empty column as null and the frontmatter mirror drops
 * a null key.
 */
export function cellPatch(column: TableColumn, value: unknown): CellPatch | null {
  switch (column.source) {
    case 'name':
      return typeof value === 'string' && value ? { name: value } : null
    case 'tags':
      return { tags: Array.isArray(value) ? value.map(String) : [] }
    case 'column': {
      if (!column.column) return null
      const text = value === null || value === undefined ? '' : String(value)
      const patch: CellPatch = { [column.column]: text }
      if (column.mirror) patch.metadata = { [column.mirror]: text || null }
      return patch
    }
    case 'metadata':
      return { metadata: { [column.key]: value ?? null } }
    default:
      return null
  }
}

/** The item as it reads once the patch has landed — for an optimistic row. */
export function applyCellPatch(item: DirectoryItem, patch: CellPatch): DirectoryItem {
  const next: DirectoryItem = { ...item }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.tags !== undefined) next.tags = patch.tags
  if (patch.subtitle !== undefined) next.subtitle = patch.subtitle || null
  if (patch.location !== undefined) next.location = patch.location || null
  if (patch.url !== undefined) next.url = patch.url || null
  if (patch.metadata) next.metadata = { ...(item.metadata ?? {}), ...patch.metadata }
  return next
}

// ── tracked fields ──────────────────────────────────────────────────────────

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/
const MAX_LABEL = 40
const MAX_OPTIONS = 50

/**
 * Metadata keys the platform reads or writes for its own reasons. A tracked
 * field may not take one: a space that "tracked" `userId` would hand the
 * identity binding to a text cell, and `status` on an event is its draft
 * flag. Column and core keys are refused per type in addTrackedField, since
 * they depend on the type.
 */
const RESERVED_METADATA_KEYS = new Set([
  'userId', 'spaceRef', 'globalMode', 'identityId',
  'status', 'visibility', 'form_schema', 'experience',
  'bio', 'website', 'linkedinUrl', 'twitterUrl', 'phone', 'pronouns',
  'company_name', 'company_image_url', 'image_url', 'imageUrl',
  'start_at', 'end_at', 'capacity', 'organizerEmail',
  'email', 'companyName', 'founded', 'memberCount',
])

/** `Deal stage` → `deal_stage`. Never empty; never starts with a digit. */
export function fieldKeyFor(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
  if (!slug) return 'field'
  return /^[a-z]/.test(slug) ? slug : `f_${slug}`
}

export type TrackedFieldResult = { ok: true; config: NodeTypeConfig; field: TrackedField } | { ok: false; error: string }

/**
 * Extend a type with a field. The key is minted from the label, must be new
 * for the type, and may not be a column the type already has or a key the
 * platform owns. Options are required for a select and dropped for anything
 * else.
 */
export function addTrackedField(
  config: NodeTypeConfig,
  input: { label: string; kind: TrackedFieldKind; options?: string[] },
): TrackedFieldResult {
  const label = input.label.trim().replace(/\s+/g, ' ')
  if (!label) return { ok: false, error: 'A field needs a name' }
  if (label.length > MAX_LABEL) return { ok: false, error: `A field name is at most ${MAX_LABEL} characters` }
  if (!TRACKED_FIELD_KINDS.some((k) => k.value === input.kind)) return { ok: false, error: 'Unknown field kind' }

  const key = fieldKeyFor(label)
  if (!KEY_PATTERN.test(key)) return { ok: false, error: 'A field name needs at least one letter' }
  // `user_id` is `userId` as far as anyone typing a label is concerned, so
  // the comparison ignores case and underscores on both sides.
  const fold = (k: string) => k.toLowerCase().replace(/_/g, '')
  if ([...RESERVED_METADATA_KEYS].some((k) => fold(k) === fold(key))) {
    return { ok: false, error: `"${label}" is a field the platform already keeps` }
  }
  const existing = columnsForType(config.name, config)
  if (existing.some((c) => fold(c.key) === fold(key) || c.label.toLowerCase() === label.toLowerCase())) {
    return { ok: false, error: `${config.name} already has a "${label}" column` }
  }

  let options: string[] | undefined
  if (input.kind === 'select') {
    const seen = new Set<string>()
    options = []
    for (const raw of input.options ?? []) {
      const o = raw.trim()
      if (!o || seen.has(o.toLowerCase())) continue
      seen.add(o.toLowerCase())
      options.push(o)
    }
    if (options.length === 0) return { ok: false, error: 'A select field needs at least one option' }
    if (options.length > MAX_OPTIONS) return { ok: false, error: `A select field has at most ${MAX_OPTIONS} options` }
  }

  const field: TrackedField = { key, label, kind: input.kind, ...(options ? { options } : {}) }
  return { ok: true, config: { ...config, fields: [...(config.fields ?? []), field] }, field }
}

/** Drop a field from the type's schema. The values stay on the nodes, unlisted. */
export function removeTrackedField(config: NodeTypeConfig, key: string): NodeTypeConfig {
  const fields = (config.fields ?? []).filter((f) => f.key !== key)
  const next = { ...config }
  if (fields.length > 0) next.fields = fields
  else delete next.fields
  return next
}

/** Rename a field or replace a select's options; the key never changes. */
export function updateTrackedField(
  config: NodeTypeConfig,
  key: string,
  patch: { label?: string; options?: string[] },
): TrackedFieldResult {
  const current = (config.fields ?? []).find((f) => f.key === key)
  if (!current) return { ok: false, error: 'No such field' }
  const label = (patch.label ?? current.label).trim().replace(/\s+/g, ' ')
  if (!label) return { ok: false, error: 'A field needs a name' }
  if (label.length > MAX_LABEL) return { ok: false, error: `A field name is at most ${MAX_LABEL} characters` }
  const clash = columnsForType(config.name, config).some(
    (c) => c.key !== key && c.label.toLowerCase() === label.toLowerCase(),
  )
  if (clash) return { ok: false, error: `${config.name} already has a "${label}" column` }
  let options = current.options
  if (patch.options && current.kind === 'select') {
    options = [...new Set(patch.options.map((o) => o.trim()).filter(Boolean))]
    if (options.length === 0) return { ok: false, error: 'A select field needs at least one option' }
  }
  const field: TrackedField = { ...current, label, ...(options ? { options } : {}) }
  return {
    ok: true,
    config: { ...config, fields: (config.fields ?? []).map((f) => (f.key === key ? field : f)) },
    field,
  }
}

/** A stored tracked-field list as the code can hold it — for the config note parser. */
export function coerceTrackedFields(raw: unknown): TrackedField[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'fields must be a list' }
  const out: TrackedField[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown>
    if (!item || typeof item !== 'object') return { error: `fields[${i}]: expected an object` }
    const key = typeof item.key === 'string' ? item.key : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const kind = item.kind as TrackedFieldKind
    if (!KEY_PATTERN.test(key)) return { error: `fields[${i}]: key must match ${KEY_PATTERN}` }
    if (seen.has(key)) return { error: `fields[${i}]: duplicate key "${key}"` }
    if (!label) return { error: `fields[${i}] (${key}): label is required` }
    if (!TRACKED_FIELD_KINDS.some((k) => k.value === kind)) {
      return { error: `fields[${i}] (${key}): kind must be one of ${TRACKED_FIELD_KINDS.map((k) => k.value).join(', ')}` }
    }
    seen.add(key)
    const field: TrackedField = { key, label, kind }
    if (kind === 'select') {
      const options = Array.isArray(item.options) ? item.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : []
      if (options.length === 0) return { error: `fields[${i}] (${key}): a select needs options` }
      field.options = options
    }
    out.push(field)
  }
  return out
}
