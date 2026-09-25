/**
 * Records, as the Directory, agents and Tools reach them: a query over an
 * invented type's records, the types that have any, and `setFields` — the one
 * write door for a record's fields, node-backed or note-backed.
 *
 * Every read answers only records the caller can read — the context lens for
 * a note — and every write goes through the record's own gate: the node door
 * (lib/directory/nodeWrite.ts) for a node, the note write gate
 * (`writeGated`) for a note. Membership alone is never enough.
 */
import prisma from '@/lib/prisma'
import { canReadPath, readVisible, writeGated } from '@/lib/notes/contextService'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { findNodeTypeConfig, type NodeTypeConfig } from '@/lib/types'
import { writeNodeFields } from '@/lib/directory/nodeWrite'
import {
  cellValueOf,
  checkQuery,
  compareRows,
  decodeRecordCursor,
  encodeRecordCursor,
  isNoteType,
  matchesPredicate,
  noteTypeFor,
  planNoteFieldWrite,
  RECORD_PAGE_MAX,
  RECORD_SCAN_MAX,
  type ProjectedValue,
  type RecordQuery,
  type RecordRow,
} from './shared/fields'

type Refusal = { ok: false; status: number; error: string }

async function spaceNodeTypes(spaceId: string): Promise<NodeTypeConfig[]> {
  const row = await prisma.space.findUnique({ where: { id: spaceId }, select: { nodeTypes: true } })
  return (row?.nodeTypes ?? []) as unknown as NodeTypeConfig[]
}

/** The space's invented types with how many records of each the caller can read. */
export async function recordTypes(p: ContextPrincipal, context: Context): Promise<Array<{ name: string; count: number }>> {
  const types = (await spaceNodeTypes(context.spaceId)).filter(isNoteType)
  if (types.length === 0) return []
  const rows = await prisma.contextRecord.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, type: { in: types.map((t) => t.name) } },
    select: { type: true, path: true },
    take: RECORD_SCAN_MAX,
  })
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!canReadPath(p, context, row.path)) continue
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1)
  }
  return types.map((t) => ({ name: t.name, count: counts.get(t.name) ?? 0 }))
}

export type RecordPage = { ok: true; type: string; rows: RecordRow[]; nextCursor: string | null; total: number } | Refusal

/**
 * The records of one invented type the caller can read, filtered by field
 * predicates (equals, in, range, contains), ordered, a page at a time. A
 * value that does not read as its field's kind never matches a predicate —
 * it is shown, not trusted.
 */
export async function queryRecords(p: ContextPrincipal, context: Context, query: RecordQuery): Promise<RecordPage> {
  const config = findNodeTypeConfig(query.type, await spaceNodeTypes(context.spaceId))
  if (!isNoteType(config)) return { ok: false, status: 404, error: `${query.type} is not one of this space's own types` }
  const problem = checkQuery(config, query)
  if (problem) return { ok: false, status: 400, error: problem }

  const records = await prisma.contextRecord.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, type: config.name },
    select: { path: true, title: true, tags: true, updatedAt: true },
    take: RECORD_SCAN_MAX,
  })
  const visible = records.filter((r) => canReadPath(p, context, r.path))
  const fieldRows = await prisma.contextRecordField.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: { in: visible.map((r) => r.path) } },
    select: { path: true, key: true, textValue: true, numberValue: true, dateValue: true, boolValue: true, raw: true, invalid: true },
  })
  const byPath = new Map<string, Map<string, ProjectedValue>>()
  for (const f of fieldRows) {
    const map = byPath.get(f.path) ?? new Map<string, ProjectedValue>()
    map.set(f.key, f)
    byPath.set(f.path, map)
  }

  const matched = visible.filter((record) => {
    const values = byPath.get(record.path)
    return (query.where ?? []).every((predicate) => matchesPredicate(values?.get(predicate.key), predicate))
  })
  const rows: RecordRow[] = matched.map((record) => {
    const values = byPath.get(record.path) ?? new Map<string, ProjectedValue>()
    const fields: Record<string, unknown> = {}
    const invalid: string[] = []
    for (const [key, value] of values) {
      fields[key] = cellValueOf(value)
      if (value.invalid) invalid.push(key)
    }
    return { path: record.path, type: config.name, title: record.title, tags: record.tags, updatedAt: record.updatedAt.toISOString(), fields, invalid }
  })
  rows.sort(compareRows(query.order))

  const limit = Math.min(Math.max(query.limit ?? 50, 1), RECORD_PAGE_MAX)
  const offset = decodeRecordCursor(query.cursor)
  const page = rows.slice(offset, offset + limit)
  return {
    ok: true,
    type: config.name,
    rows: page,
    nextCursor: offset + limit < rows.length ? encodeRecordCursor(offset + limit) : null,
    total: rows.length,
  }
}

export type SetFieldsTarget = { path: string } | { nodeId: string }
export type SetFieldsResult = { ok: true; record: string; fields: Record<string, unknown> } | Refusal

/**
 * The one write door for a record's fields. Only keys its type declares as
 * fields, never a key the platform keeps, each value parsed on the server by
 * the table's own rule; a node goes through the node door's gates, a note
 * through the note write gate, as the caller.
 */
export async function setFields(
  p: ContextPrincipal,
  context: Context,
  target: SetFieldsTarget,
  patch: Record<string, unknown>,
): Promise<SetFieldsResult> {
  if (Object.keys(patch).length === 0) return { ok: false, status: 400, error: 'Name at least one field to set.' }

  if ('nodeId' in target) {
    const written = await writeNodeFields({ userId: p.userId, name: p.name, email: p.email }, context.spaceId, target.nodeId, patch)
    return written.ok ? { ok: true, record: target.nodeId, fields: written.fields } : written
  }

  const content = await readVisible(p, context, target.path)
  if (content === null) return { ok: false, status: 404, error: `No record at ${target.path}` }
  const frontmatter = parseFrontmatter(content)
  const config = noteTypeFor(frontmatter.type, await spaceNodeTypes(context.spaceId))
  if (!config) return { ok: false, status: 400, error: `${target.path} is not a record of one of this space's own types` }
  const plan = planNoteFieldWrite(config, patch)
  if (!plan.ok) return { ok: false, status: 400, error: plan.error }

  const next = { ...frontmatter, ...plan.set }
  for (const key of plan.clear) delete (next as Record<string, unknown>)[key]
  const written = await writeGated(p, context, target.path, joinFrontmatter(next, splitFrontmatter(content).body))
  if (written.status === 'denied') return { ok: false, status: 403, error: written.reason }
  const fields: Record<string, unknown> = { ...plan.set }
  for (const key of plan.clear) fields[key] = null
  return { ok: true, record: written.path, fields }
}
