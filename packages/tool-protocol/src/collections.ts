/**
 * A Tool's collections, as rules — pure, for the server, the offline mock and
 * the checks alike.
 *
 * A collection is a per-install store the manifest declares by name, with a
 * JSON Schema (./schema.ts) and two rules:
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
import type { CollectionSpec } from './manifest'

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
  const bytes = new TextEncoder().encode(JSON.stringify(data) ?? '').length
  return bytes > MAX_ROW_BYTES ? `A row is at most ${MAX_ROW_BYTES / 1024} KB; this one is ${Math.ceil(bytes / 1024)} KB.` : null
}

/** Does a row match a `where` — each field equal, `null` matching a field set to null or absent? */
export function rowMatches(data: Record<string, unknown>, where: Record<string, string | number | boolean | null> | undefined): boolean {
  return Object.entries(where ?? {}).every(([key, value]) => (value === null ? data[key] === null || data[key] === undefined : data[key] === value))
}

/** The change path a collection's writes are announced under — never a note's (a `:` path is not one). */
export function collectionChangePath(name: string): string {
  return `:collection:${name}`
}
