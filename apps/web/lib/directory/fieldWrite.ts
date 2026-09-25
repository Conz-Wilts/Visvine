// What a write through a record's field door may change, decided before
// anything is stored. The door is `PATCH /api/nodes/<id>`: a Directory cell,
// an entity page's property row. It writes the fields the record's TYPE
// declares — its property rows (lib/types/typeFields.ts) and the space's
// tracked fields — each value parsed by the same rule the table's editor uses
// (table.ts#parseCellInput), and nothing else. The keys the platform keeps
// in metadata (an event's hosts and audience, an entity's note pointer, an
// identity binding) are never a field, whatever a stored config says.
//
// Pure — tests/directory-field-write.test.ts.

import { canonicalType, fieldsForType } from '@/lib/types/typeFields'
import type { NodeTypeConfig } from '@/lib/types'
import { columnsForType, parseCellInput, platformMetadataKeys, type TableColumn } from './table'

/** The longest text a single field holds. */
const MAX_FIELD_TEXT = 5000
const MAX_FIELD_TAGS = 50

type StoredValue = string | number | boolean | string[] | null

export type FieldValue = { ok: true; value: StoredValue } | { ok: false; error: string }

export type FieldWritePlan =
  | { ok: true; metadata: Record<string, unknown> }
  | { ok: false; error: string }

/** The node columns a type's property rows write (subtitle, location, url, image_url). */
export function writableColumns(type: string): ReadonlySet<string> {
  const out = new Set<string>()
  for (const f of fieldsForType(type)) if (f.target === 'column' && f.column) out.add(f.column)
  return out
}

/**
 * The metadata keys a type's field door writes, each with the column that
 * parses it: every editable metadata column, and the metadata mirror of an
 * editable column-backed row (a space's `url` also lands as `website`).
 * An agent's cells are its record, written through its own config route, so
 * an agent has none here.
 */
export function writableMetadataFields(type: string, config: NodeTypeConfig | null | undefined): Map<string, TableColumn> {
  const out = new Map<string, TableColumn>()
  if (canonicalType(type) === 'agent') return out
  const platform = platformMetadataKeys(type)
  for (const column of columnsForType(type, config)) {
    if (!column.editable) continue
    if (column.source === 'metadata' && !platform.has(column.key)) out.set(column.key, column)
    if (column.source === 'column' && column.mirror && !platform.has(column.mirror)) {
      out.set(column.mirror, { ...column, key: column.mirror, source: 'metadata' })
    }
  }
  return out
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/**
 * A value as the field stores it, or why not. A string is read exactly as the
 * table's editor reads what a person typed; an already-typed value (a number,
 * a checkbox's boolean, a tag list) is accepted when it is that field's kind.
 * Blank clears.
 */
export function parseFieldValue(value: unknown, column: TableColumn): FieldValue {
  if (isBlank(value)) return { ok: true, value: column.kind === 'tags' ? [] : null }
  if (typeof value === 'string') {
    if (value.length > MAX_FIELD_TEXT) return { ok: false, error: `${column.label} is too long` }
    const parsed = parseCellInput(value, column)
    return parsed.ok ? { ok: true, value: parsed.value as StoredValue } : parsed
  }
  switch (column.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, error: `${column.label} must be a number` }
    case 'checkbox':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: `${column.label} must be yes or no` }
    case 'tags': {
      if (!Array.isArray(value) || value.some((t) => typeof t !== 'string')) {
        return { ok: false, error: `${column.label} must be a list of words` }
      }
      const parsed = parseCellInput((value as string[]).join(','), column)
      if (!parsed.ok) return parsed
      const tags = parsed.value as string[]
      return tags.length > MAX_FIELD_TAGS
        ? { ok: false, error: `${column.label} holds at most ${MAX_FIELD_TAGS}` }
        : { ok: true, value: tags }
    }
    default:
      return { ok: false, error: `${column.label} must be text` }
  }
}

/**
 * The metadata a patch may merge into a record of `type`, every value parsed —
 * or the first reason it may not. A key the platform keeps is refused by name;
 * a key the type does not declare is refused as not a field.
 */
export function planMetadataWrite(
  type: string,
  config: NodeTypeConfig | null | undefined,
  patch: Record<string, unknown>,
): FieldWritePlan {
  const platform = platformMetadataKeys(type)
  const fields = writableMetadataFields(type, config)
  const label = config?.name ?? type
  const metadata: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(patch)) {
    if (platform.has(key)) return { ok: false, error: `"${key}" is kept by the platform, not a field` }
    const column = fields.get(key)
    if (!column) return { ok: false, error: `"${key}" is not a field of ${label}` }
    const parsed = parseFieldValue(raw, column)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    metadata[key] = parsed.value
  }
  return { ok: true, metadata }
}
