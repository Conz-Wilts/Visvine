/**
 * Records: the structured layer for the types a space invents. Pure.
 *
 * A node-backed kind (a person, an event) keeps its tracked fields in node
 * metadata. A member-invented type (`NodeTypeConfig.scope: 'note'`) has no
 * node — its records are the notes that declare it — so its fields are
 * frontmatter keys on those notes. This file is everything about that which
 * is a rule rather than a query: which keys a note type may never call a
 * field, how a frontmatter value reads as a field's kind (the Directory
 * table's own parser, `table.ts#parseCellInput`, so a cell and a projection
 * agree), what a field write may change, and what a record query means.
 *
 * tests/records.test.ts.
 */
import { columnsForType, NOTE_RESERVED_KEYS, parseCellInput, type TableColumn } from '@/lib/directory/table'
import { parseFieldValue } from '@/lib/directory/fieldWrite'
import { findNodeTypeConfig, type NodeTypeConfig } from '@/lib/types'

/** Is this one of the space's invented types — records that are notes? */
export function isNoteType(config: NodeTypeConfig | null | undefined): config is NodeTypeConfig {
  return !!config && config.scope === 'note'
}

/** The space's note type a note's `type:` names, if it names one. */
export function noteTypeFor(declared: unknown, nodeTypes: NodeTypeConfig[] | null | undefined): NodeTypeConfig | null {
  if (typeof declared !== 'string' || !declared.trim()) return null
  const config = findNodeTypeConfig(declared, nodeTypes ?? undefined)
  return isNoteType(config) ? config : null
}

/** Why a note type may not have a field under this key, or null when it may. */
export function noteFieldDenial(key: string): string | null {
  const fold = (k: string) => k.toLowerCase().replace(/_/g, '')
  const hit = NOTE_RESERVED_KEYS.find((reserved) => fold(reserved) === fold(key))
  return hit ? `"${key}" is kept by the platform on every note, not a field` : null
}

/** The field columns of a note type — its tracked fields, read the way the table reads them. */
export function recordColumns(config: NodeTypeConfig): TableColumn[] {
  return columnsForType(config.name, config).filter(
    (column) => column.origin === 'tracked' && !noteFieldDenial(column.key),
  )
}

/**
 * The kinds whose nodes are configuration or places, not records: nothing
 * reads their metadata as a record's fields.
 */
const NON_RECORD_KINDS = new Set(['agent', 'connector', 'model', 'tool', 'channel', 'section', 'note'])

/** Is this node kind one a record query may read? */
export function isRecordKind(canonical: string): boolean {
  return !!canonical && !NON_RECORD_KINDS.has(canonical)
}

/** A node-backed type's field columns: what its nodes keep in metadata — its type's fields and its tracked fields. */
export function nodeRecordColumns(type: string, config: NodeTypeConfig | null): TableColumn[] {
  return columnsForType(type, config).filter(
    (column) => column.source === 'metadata' && (column.origin === 'tracked' || column.origin === 'type'),
  )
}

/** A projected value: one typed column filled, or `invalid` with what was written. */
export interface ProjectedValue {
  textValue: string | null
  numberValue: number | null
  dateValue: Date | null
  boolValue: boolean | null
  raw: string | null
  invalid: boolean
}

/** A frontmatter value as the text a person would have typed into the cell. */
function asTyped(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10)
  return null
}

/**
 * How a frontmatter value reads as its field's kind. A value the parser
 * refuses — or one no cell could hold, like a list — is kept as `invalid`
 * with its raw text, so the table shows it as wrong instead of dropping it.
 * Null when the note does not set the field at all.
 */
export function projectFieldValue(column: TableColumn, raw: unknown): ProjectedValue | null {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null
  const empty: ProjectedValue = { textValue: null, numberValue: null, dateValue: null, boolValue: null, raw: null, invalid: false }
  const text = asTyped(raw)
  if (text === null) return { ...empty, raw: JSON.stringify(raw).slice(0, 500), invalid: true }
  const parsed = parseCellInput(text, column)
  if (!parsed.ok || parsed.value === null) return { ...empty, raw: text.slice(0, 500), invalid: true }
  switch (column.kind) {
    case 'number':
      return { ...empty, numberValue: parsed.value as number }
    case 'checkbox':
      return { ...empty, boolValue: parsed.value as boolean }
    case 'date': {
      const day = new Date(`${String(parsed.value).slice(0, 10)}T00:00:00.000Z`)
      return Number.isNaN(day.getTime()) ? { ...empty, raw: text, invalid: true } : { ...empty, dateValue: day, textValue: String(parsed.value) }
    }
    default:
      return { ...empty, textValue: String(parsed.value) }
  }
}

/** A projected value back as the table's cell shows it: typed, or the raw text when invalid. */
export function cellValueOf(row: ProjectedValue): unknown {
  if (row.invalid) return row.raw
  if (row.numberValue !== null) return row.numberValue
  if (row.boolValue !== null) return row.boolValue
  if (row.textValue !== null) return row.textValue
  if (row.dateValue !== null) return row.dateValue.toISOString().slice(0, 10)
  return null
}

export type NoteFieldPlan = { ok: true; set: Record<string, unknown>; clear: string[] } | { ok: false; error: string }

/**
 * What a field write may change on a note record: only keys its type declares
 * as fields, never a reserved one, each value parsed by the table's rule
 * (fieldWrite.ts#parseFieldValue). Blank clears the key.
 */
export function planNoteFieldWrite(config: NodeTypeConfig, patch: Record<string, unknown>): NoteFieldPlan {
  const columns = new Map(recordColumns(config).map((column) => [column.key, column]))
  const set: Record<string, unknown> = {}
  const clear: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    const reserved = noteFieldDenial(key)
    if (reserved) return { ok: false, error: reserved }
    const column = columns.get(key)
    if (!column) return { ok: false, error: `"${key}" is not a field of ${config.name}` }
    const parsed = parseFieldValue(value, column)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    if (parsed.value === null || (Array.isArray(parsed.value) && parsed.value.length === 0)) clear.push(key)
    else set[key] = parsed.value
  }
  return { ok: true, set, clear }
}

// ── queries ───────────────────────────────────────────────────────────────────

export type RecordPredicate =
  | { key: string; op: 'eq'; value: string | number | boolean }
  | { key: string; op: 'in'; values: Array<string | number> }
  | { key: string; op: 'range'; min?: string | number; max?: string | number }
  | { key: string; op: 'contains'; value: string }

export interface RecordQuery {
  type: string
  where?: RecordPredicate[]
  order?: { key: string; direction: 'asc' | 'desc' }
  limit?: number
  cursor?: string | null
}

/** The most a query answers in one page, and the most records it will look through. */
export const RECORD_PAGE_MAX = 200
export const RECORD_SCAN_MAX = 5_000

/** A record as a query answers it: the note, and its fields as cells. */
export interface RecordRow {
  path: string
  /** A node-backed record's node. */
  nodeId?: string
  type: string
  title: string
  tags: string[]
  updatedAt: string
  fields: Record<string, unknown>
  /** Keys whose written value does not read as the field's kind. */
  invalid: string[]
}

/** Does one field's projected value meet a predicate? */
export function matchesPredicate(row: ProjectedValue | undefined, predicate: RecordPredicate): boolean {
  if (!row || row.invalid) return false
  const value = cellValueOf(row)
  switch (predicate.op) {
    case 'eq':
      return typeof value === 'string' && typeof predicate.value === 'string'
        ? value.toLowerCase() === predicate.value.toLowerCase()
        : value === predicate.value
    case 'in':
      return predicate.values.some((v) => (typeof v === 'string' && typeof value === 'string' ? v.toLowerCase() === value.toLowerCase() : v === value))
    case 'contains':
      return typeof value === 'string' && value.toLowerCase().includes(predicate.value.toLowerCase())
    case 'range': {
      const comparable = row.numberValue ?? (row.dateValue ? row.dateValue.getTime() : null)
      if (comparable === null) return false
      const bound = (b: string | number | undefined) =>
        b === undefined ? undefined : typeof b === 'number' ? b : row.dateValue ? new Date(b).getTime() : Number(b)
      const min = bound(predicate.min)
      const max = bound(predicate.max)
      return (min === undefined || comparable >= min) && (max === undefined || comparable <= max)
    }
  }
}

/** Order two rows by a field (or title / updated), nulls last, then by path for a stable cursor. */
export function compareRows(order: RecordQuery['order']) {
  return (a: RecordRow, b: RecordRow): number => {
    if (order) {
      const read = (row: RecordRow): unknown =>
        order.key === 'title' ? row.title : order.key === 'updated' ? row.updatedAt : row.invalid.includes(order.key) ? null : row.fields[order.key]
      const av = read(a)
      const bv = read(b)
      if (av !== bv) {
        if (av === null || av === undefined) return 1
        if (bv === null || bv === undefined) return -1
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : typeof av === 'boolean' && typeof bv === 'boolean'
              ? Number(av) - Number(bv)
              : String(av).localeCompare(String(bv))
        if (cmp !== 0) return order.direction === 'desc' ? -cmp : cmp
      }
    }
    return a.path.localeCompare(b.path)
  }
}

/** A cursor is an offset into the ordered result — records are few enough that this is honest. */
export function encodeRecordCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

export function decodeRecordCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/** The predicates of a query that name a field this type has, or the first that does not. */
export function checkQuery(config: NodeTypeConfig, query: RecordQuery, columns: TableColumn[] = recordColumns(config)): string | null {
  const keys = new Set(columns.map((column) => column.key))
  for (const predicate of query.where ?? []) {
    if (!keys.has(predicate.key)) return `"${predicate.key}" is not a field of ${config.name}`
  }
  if (query.order && !['title', 'updated'].includes(query.order.key) && !keys.has(query.order.key)) {
    return `"${query.order.key}" is not a field of ${config.name}`
  }
  return null
}
