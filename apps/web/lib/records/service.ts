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
import type { NoteRevisionOrigin } from '@/lib/notes/shared/types'
import type { Context } from '@/lib/notes/store'
import { findNodeTypeConfig, type NodeTypeConfig } from '@/lib/types'
import { writeNodeFields } from '@/lib/directory/nodeWrite'
import { entityLensFor } from '@/lib/notes/context/entityVisibility'
import { isEntityHidden } from '@/lib/notes/shared/entityVisibility'
import { entityNotePath } from '@/lib/notes/entities'
import { canonicalType } from '@/lib/types/typeFields'
import type { TableColumn } from '@/lib/directory/table'
import {
  cellValueOf,
  checkQuery,
  compareRows,
  decodeRecordCursor,
  encodeRecordCursor,
  isNoteType,
  isRecordKind,
  matchesPredicate,
  nodeRecordColumns,
  noteTypeFor,
  planNoteFieldWrite,
  projectFieldValue,
  recordColumns,
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
  if (!isNoteType(config)) return queryNodeRecords(p, context, config, query)
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
  return pageOf(config.name, rows, query)
}

/** One page of rows, ordered and cut at the query's cursor. */
function pageOf(type: string, rows: RecordRow[], query: RecordQuery): RecordPage {
  rows.sort(compareRows(query.order))
  const limit = Math.min(Math.max(query.limit ?? 50, 1), RECORD_PAGE_MAX)
  const offset = decodeRecordCursor(query.cursor)
  return {
    ok: true,
    type,
    rows: rows.slice(offset, offset + limit),
    nextCursor: offset + limit < rows.length ? encodeRecordCursor(offset + limit) : null,
    total: rows.length,
  }
}

const NODE_RECORD_SELECT = {
  id: true,
  spaceId: true,
  type: true,
  name: true,
  alias: true,
  identityId: true,
  tags: true,
  metadata: true,
  updatedAt: true,
} as const

type NodeRecordRow = {
  id: string
  spaceId: string | null
  type: string
  name: string
  alias: string | null
  identityId: string | null
  tags: string[]
  metadata: unknown
  updatedAt: Date
}

/** A node as a record: its metadata fields as cells, read by the table's own rule. */
function nodeRecordRow(node: NodeRecordRow, type: string, columns: TableColumn[]): { row: RecordRow; values: Map<string, ProjectedValue> } {
  const metadata = (node.metadata && typeof node.metadata === 'object' ? node.metadata : {}) as Record<string, unknown>
  const values = new Map<string, ProjectedValue>()
  const fields: Record<string, unknown> = {}
  const invalid: string[] = []
  for (const column of columns) {
    const projected = projectFieldValue(column, metadata[column.key])
    if (!projected) continue
    values.set(column.key, projected)
    fields[column.key] = cellValueOf(projected)
    if (projected.invalid) invalid.push(column.key)
  }
  const path = entityNotePath({ ...node, metadata }) ?? ''
  return {
    row: { path, nodeId: node.id, type, title: node.name, tags: node.tags, updatedAt: node.updatedAt.toISOString(), fields, invalid },
    values,
  }
}

/**
 * A node-backed kind's records — people, organisations, events, resources, a
 * space's own node types: the nodes of that type the Directory shows the
 * caller, their fields the metadata its type and tracked fields name.
 */
async function queryNodeRecords(
  p: ContextPrincipal,
  context: Context,
  config: NodeTypeConfig | null,
  query: RecordQuery,
): Promise<RecordPage> {
  const canonical = canonicalType(config?.name ?? query.type)
  if (!config || !isRecordKind(canonical)) return { ok: false, status: 404, error: `${query.type} is not a type of record here` }
  const columns = nodeRecordColumns(config.name, config)
  const problem = checkQuery(config, query, columns)
  if (problem) return { ok: false, status: 400, error: problem }
  const nodes = await prisma.node.findMany({
    where: { spaceId: context.spaceId, type: { equals: canonical, mode: 'insensitive' } },
    select: NODE_RECORD_SELECT,
    take: RECORD_SCAN_MAX,
  })
  const lens = await entityLensFor(context.spaceId, p.userId, p.email)
  const rows: RecordRow[] = []
  for (const node of nodes) {
    if (lens && isEntityHidden({ ...node, metadata: (node.metadata ?? {}) as Record<string, unknown> }, lens)) continue
    const { row, values } = nodeRecordRow(node, config.name, columns)
    if ((query.where ?? []).every((predicate) => matchesPredicate(values.get(predicate.key), predicate))) rows.push(row)
  }
  return pageOf(config.name, rows, query)
}

export type RecordResult = { ok: true; record: RecordRow } | Refusal

/**
 * One record by its note's path or its node's id, with its fields — only when
 * the caller can read it; one they cannot reads as absent.
 */
export async function getRecord(p: ContextPrincipal, context: Context, target: SetFieldsTarget): Promise<RecordResult> {
  const types = await spaceNodeTypes(context.spaceId)
  if ('nodeId' in target) {
    const node = await prisma.node.findUnique({ where: { id: target.nodeId }, select: NODE_RECORD_SELECT })
    const config = node ? findNodeTypeConfig(node.type, types) : null
    if (!node || node.spaceId !== context.spaceId || !config || !isRecordKind(canonicalType(node.type))) {
      return { ok: false, status: 404, error: 'No such record' }
    }
    const lens = await entityLensFor(context.spaceId, p.userId, p.email)
    if (lens && isEntityHidden({ ...node, metadata: (node.metadata ?? {}) as Record<string, unknown> }, lens)) {
      return { ok: false, status: 404, error: 'No such record' }
    }
    return { ok: true, record: nodeRecordRow(node, config.name, nodeRecordColumns(config.name, config)).row }
  }
  const content = await readVisible(p, context, target.path)
  if (content === null) return { ok: false, status: 404, error: `No record at ${target.path}` }
  const frontmatter = parseFrontmatter(content)
  const config = noteTypeFor(frontmatter.type, types)
  if (!config) return { ok: false, status: 404, error: `${target.path} is not a record of one of this space's own types` }
  const fields: Record<string, unknown> = {}
  const invalid: string[] = []
  for (const column of recordColumns(config)) {
    const projected = projectFieldValue(column, frontmatter[column.key])
    if (!projected) continue
    fields[column.key] = cellValueOf(projected)
    if (projected.invalid) invalid.push(column.key)
  }
  const record = await prisma.contextRecord.findFirst({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: target.path },
    select: { title: true, tags: true, updatedAt: true },
  })
  return {
    ok: true,
    record: {
      path: target.path,
      type: config.name,
      title: record?.title ?? (typeof frontmatter.title === 'string' ? frontmatter.title : target.path),
      tags: record?.tags ?? [],
      updatedAt: (record?.updatedAt ?? new Date()).toISOString(),
      fields,
      invalid,
    },
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
  opts: { origin?: NoteRevisionOrigin } = {},
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
  const written = await writeGated(p, context, target.path, joinFrontmatter(next, splitFrontmatter(content).body), opts.origin)
  if (written.status === 'denied') return { ok: false, status: 403, error: written.reason }
  const fields: Record<string, unknown> = { ...plan.set }
  for (const key of plan.clear) fields[key] = null
  return { ok: true, record: written.path, fields }
}
