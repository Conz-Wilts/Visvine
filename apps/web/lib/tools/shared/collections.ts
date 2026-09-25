/**
 * A Tool's collections, as rules — pure (tests/tools-collections.test.ts).
 *
 * A collection is a per-install store the manifest declares by name, with a
 * JSON Schema (@visvine/tool-protocol/schema) and two rules:
 *
 *   read    all     every viewer reads every row
 *           own     a viewer reads their own rows; an admin reads all
 *           admin   only the space's admins read
 *   write   own     anyone adds rows; a row is changed or removed by whoever
 *                   wrote it, or an admin
 *           all     anyone adds, changes or removes any row
 *           admin   only admins write
 *
 * A row never says who wrote it — only whether the viewer did (`mine`), so a
 * poll's votes stay the voters' own. A collection holds at most its
 * `maxRows`, and a row at most 16 KB.
 */
import type { CollectionSpec } from '@visvine/tool-protocol/manifest'

export const MAX_ROW_BYTES = 16_384
export const LIST_LIMIT_MAX = 200
/** How long an uninstalled Tool's rows wait for it to be installed again. */
export const DETACHED_DAYS = 30

export type CollectionAct = 'read' | 'insert' | 'update' | 'delete'

export interface CollectionRefusal {
  code: 'perimeter' | 'forbidden'
  message: string
}

/** Whether the viewer may do this to a collection (and, for a change, to this row). */
export function collectionDenial(
  spec: CollectionSpec | undefined,
  name: string,
  act: CollectionAct,
  viewer: { isAdmin: boolean },
  row?: { mine: boolean },
): CollectionRefusal | null {
  if (!spec) {
    return { code: 'perimeter', message: `tool perimeter denied: this tool declares no collection "${name}" — add it to collections` }
  }
  if (act === 'read') {
    return spec.read === 'admin' && !viewer.isAdmin ? { code: 'forbidden', message: `Only this space’s admins read ${name}.` } : null
  }
  if (spec.write === 'admin' && !viewer.isAdmin) return { code: 'forbidden', message: `Only this space’s admins write to ${name}.` }
  if ((act === 'update' || act === 'delete') && spec.write === 'own' && !viewer.isAdmin && !row?.mine) {
    return { code: 'forbidden', message: 'You can change only the rows you wrote.' }
  }
  return null
}

/** Does this viewer read only their own rows? */
export function readsOwnOnly(spec: CollectionSpec, viewer: { isAdmin: boolean }): boolean {
  return spec.read === 'own' && !viewer.isAdmin
}

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** A `where` or `groupBy` naming only plain top-level fields, and at most eight. */
export function queryDenial(input: { where?: Record<string, unknown>; groupBy?: string }): string | null {
  const keys = Object.keys(input.where ?? {})
  if (keys.length > 8) return 'A query names at most eight fields.'
  for (const key of keys) {
    if (!FIELD_RE.test(key)) return `"${key}" is not a field name.`
    const value = input.where![key]
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return `${key} must be matched against a plain value.`
  }
  if (input.groupBy !== undefined && !FIELD_RE.test(input.groupBy)) return `"${input.groupBy}" is not a field name.`
  return null
}

/** Why a row is too big to keep, or null. */
export function rowSizeDenial(data: unknown): string | null {
  const bytes = Buffer.byteLength(JSON.stringify(data) ?? '', 'utf8')
  return bytes > MAX_ROW_BYTES ? `A row is at most ${MAX_ROW_BYTES / 1024} KB; this one is ${Math.ceil(bytes / 1024)} KB.` : null
}

/** A page's cursor: the last row's time and id, so a page never repeats or skips one. */
export function encodeCursor(row: { createdAt: Date | string; id: string }): string {
  return Buffer.from(`${new Date(row.createdAt).toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    const createdAt = new Date(at)
    return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null
  } catch {
    return null
  }
}

/** The change path a collection's writes are announced under — never a note's (a `:` path is not one). */
export function collectionChangePath(name: string): string {
  return `:collection:${name}`
}
