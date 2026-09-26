/**
 * A Tool's collections (`app_tool_records`): the per-install store a manifest
 * declares, reached through the bridge's `collections.*` methods under the
 * rules in ./shared/collections.ts.
 *
 * Rows are keyed by what the Tool runs as — the install, a working copy's
 * preview, a review run — so two installs of one Tool never share a row, and
 * written by one person, whose account takes them with it. An uninstall
 * DETACHES an install's rows; installing the same Tool in the space again
 * takes them back, and the minute tick drops what stayed detached for
 * `DETACHED_DAYS`. A space's admins can export an install's rows — data and
 * times, never who wrote them.
 *
 * Every write is announced to the install's open frames on the changes
 * stream, as the path `:collection:<name>`.
 */
import { EventEmitter } from 'node:events'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { rowDenial } from '@visvine/tool-protocol/schema'
import type { CollectionRow } from '@visvine/tool-protocol/protocol'
import type { CollectionSpec } from '@visvine/tool-protocol/manifest'
import { manifestOf } from './config'
import { requireVisibleResource } from '@/lib/resources/visibility'
import { previewTargetKey, targetKey as targetKeyOf, type ResolvedTarget } from './target'
import {
  collectionChangePath,
  collectionDenial,
  decodeCursor,
  DETACHED_DAYS,
  encodeCursor,
  LIST_LIMIT_MAX,
  queryDenial,
  readsOwnOnly,
  rowSizeDenial,
  type CollectionAct,
} from './shared/collections'

type Where = Record<string, string | number | boolean | null>
export type CollectionAnswer<T> = { ok: true; value: T } | { ok: false; code: 'perimeter' | 'forbidden' | 'invalid' | 'not_found' | 'too_large'; message: string }

function toolKeyOf(t: ResolvedTarget): string {
  return 'key' in t.install ? t.install.key : `${t.spaceId}/${t.config.name}`
}

// ── announcing writes ────────────────────────────────────────────────────────

interface CollectionEvent {
  targetKey: string
  name: string
  /** Who wrote the row — never sent on, only asked "is it the viewer's?". */
  authorId: string
}

declare global {
  var __vvToolCollections: EventEmitter | undefined
}

function bus(): EventEmitter {
  if (!globalThis.__vvToolCollections) {
    globalThis.__vvToolCollections = new EventEmitter()
    globalThis.__vvToolCollections.setMaxListeners(0)
  }
  return globalThis.__vvToolCollections
}

/**
 * Hear the writes to a target's collections that its viewer may read — in
 * this process, like the note change bus, with the frame's poll behind it. A
 * viewer who reads only their own rows hears only about their own rows.
 */
export function subscribeCollectionChanges(t: ResolvedTarget, listener: (path: string) => void): () => void {
  const targetKey = targetKeyOf(t)
  const collections = manifestOf(t.config).collections
  const viewer = { isAdmin: t.isAdmin }
  const handler = (event: CollectionEvent) => {
    if (event.targetKey !== targetKey) return
    const spec = collections[event.name]
    if (!spec || collectionDenial(spec, event.name, 'read', viewer)) return
    if (readsOwnOnly(spec, viewer) && event.authorId !== t.principal.userId) return
    listener(collectionChangePath(event.name))
  }
  bus().on('change', handler)
  return () => bus().off('change', handler)
}

function announce(targetKey: string, name: string, authorId: string): void {
  bus().emit('change', { targetKey, name, authorId } satisfies CollectionEvent)
}

// ── the rows ─────────────────────────────────────────────────────────────────

function gate(t: ResolvedTarget, name: string, act: CollectionAct, row?: { mine: boolean }) {
  const spec = manifestOf(t.config).collections[name] as CollectionSpec | undefined
  const denial = collectionDenial(spec, name, act, { isAdmin: t.isAdmin }, row)
  return denial ? { ok: false as const, ...denial } : { ok: true as const, spec: spec! }
}

function rowOf(row: { id: string; data: Prisma.JsonValue; userId: string; createdAt: Date; updatedAt: Date }, viewerId: string): CollectionRow {
  return {
    id: row.id,
    data: (row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {}) as Record<string, unknown>,
    mine: row.userId === viewerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function jsonWhere(where: Where | undefined): Prisma.AppToolRecordWhereInput[] {
  return Object.entries(where ?? {}).map(([key, value]) =>
    value === null ? { data: { path: [key], equals: Prisma.AnyNull } } : { data: { path: [key], equals: value } },
  )
}

/** The top-level fields a schema marks `format: resource` — ids of files in the space's Drive. */
function resourceFields(schema: Record<string, unknown>): string[] {
  const props = (schema.properties ?? {}) as Record<string, { format?: unknown }>
  return Object.entries(props)
    .filter(([, p]) => p && typeof p === 'object' && p.format === 'resource')
    .map(([key]) => key)
}

/**
 * A `format: resource` field holds a file of THIS space the viewer can see —
 * so a row can never carry an id that points past its Tool's space, or at a
 * file its writer could not open.
 */
async function resourceDenial(t: ResolvedTarget, schema: Record<string, unknown>, data: Record<string, unknown>): Promise<string | null> {
  for (const key of resourceFields(schema)) {
    const id = data[key]
    if (id === undefined || id === null || id === '') continue
    if (typeof id !== 'string') return `${key} is a resource id`
    try {
      const gated = await requireVisibleResource(id, t.principal.userId, t.principal.email)
      if (gated.spaceId !== t.spaceId) return `${key} is not a file in this space`
    } catch {
      return `${key} is not a file you can see here`
    }
  }
  return null
}

export async function insertRow(t: ResolvedTarget, name: string, data: Record<string, unknown>): Promise<CollectionAnswer<CollectionRow>> {
  const allowed = gate(t, name, 'insert')
  if (!allowed.ok) return allowed
  const invalid = rowDenial(allowed.spec.schema, data) ?? rowSizeDenial(data) ?? (await resourceDenial(t, allowed.spec.schema, data))
  if (invalid) return { ok: false, code: 'invalid', message: invalid }
  const targetKey = targetKeyOf(t)
  const held = await prisma.appToolRecord.count({ where: { targetKey, collection: name, detachedAt: null } })
  if (held >= allowed.spec.maxRows) {
    return { ok: false, code: 'too_large', message: `${name} is full: it holds at most ${allowed.spec.maxRows} rows.` }
  }
  const row = await prisma.appToolRecord.create({
    data: {
      spaceId: t.spaceId,
      targetKey,
      toolKey: toolKeyOf(t),
      collection: name,
      userId: t.principal.userId,
      data: data as Prisma.InputJsonValue,
    },
  })
  announce(targetKey, name, row.userId)
  return { ok: true, value: rowOf(row, t.principal.userId) }
}

export async function listRows(
  t: ResolvedTarget,
  name: string,
  query: { where?: Where; mine?: boolean; order?: 'asc' | 'desc'; limit?: number; cursor?: string },
): Promise<CollectionAnswer<{ rows: CollectionRow[]; nextCursor: string | null }>> {
  const allowed = gate(t, name, 'read')
  if (!allowed.ok) return allowed
  const problem = queryDenial(query)
  if (problem) return { ok: false, code: 'invalid', message: problem }
  const own = query.mine || readsOwnOnly(allowed.spec, { isAdmin: t.isAdmin })
  const order = query.order === 'desc' ? 'desc' : 'asc'
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), LIST_LIMIT_MAX)
  const after = decodeCursor(query.cursor)
  const keyset: Prisma.AppToolRecordWhereInput[] = after
    ? [
        order === 'asc'
          ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] }
          : { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] },
      ]
    : []
  const rows = await prisma.appToolRecord.findMany({
    where: {
      targetKey: targetKeyOf(t),
      collection: name,
      detachedAt: null,
      ...(own ? { userId: t.principal.userId } : {}),
      AND: [...jsonWhere(query.where), ...keyset],
    },
    orderBy: [{ createdAt: order }, { id: order }],
    take: limit + 1,
  })
  const page = rows.slice(0, limit)
  return {
    ok: true,
    value: { rows: page.map((row) => rowOf(row, t.principal.userId)), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null },
  }
}

async function findRow(t: ResolvedTarget, name: string, id: string) {
  return prisma.appToolRecord.findFirst({ where: { id, targetKey: targetKeyOf(t), collection: name, detachedAt: null } })
}

export async function getRow(t: ResolvedTarget, name: string, id: string): Promise<CollectionAnswer<CollectionRow>> {
  const allowed = gate(t, name, 'read')
  if (!allowed.ok) return allowed
  const row = await findRow(t, name, id)
  const own = readsOwnOnly(allowed.spec, { isAdmin: t.isAdmin })
  if (!row || (own && row.userId !== t.principal.userId)) return { ok: false, code: 'not_found', message: `No such row in ${name}.` }
  return { ok: true, value: rowOf(row, t.principal.userId) }
}

export async function updateRow(t: ResolvedTarget, name: string, id: string, data: Record<string, unknown>): Promise<CollectionAnswer<CollectionRow>> {
  const declared = gate(t, name, 'insert')
  if (!declared.ok) return declared
  const row = await findRow(t, name, id)
  if (!row) return { ok: false, code: 'not_found', message: `No such row in ${name}.` }
  const allowed = gate(t, name, 'update', { mine: row.userId === t.principal.userId })
  if (!allowed.ok) return allowed
  const invalid = rowDenial(allowed.spec.schema, data) ?? rowSizeDenial(data) ?? (await resourceDenial(t, allowed.spec.schema, data))
  if (invalid) return { ok: false, code: 'invalid', message: invalid }
  const updated = await prisma.appToolRecord.update({ where: { id: row.id }, data: { data: data as Prisma.InputJsonValue } })
  announce(row.targetKey, name, row.userId)
  return { ok: true, value: rowOf(updated, t.principal.userId) }
}

export async function deleteRow(t: ResolvedTarget, name: string, id: string): Promise<CollectionAnswer<{ id: string }>> {
  const declared = gate(t, name, 'insert')
  if (!declared.ok) return declared
  const row = await findRow(t, name, id)
  if (!row) return { ok: false, code: 'not_found', message: `No such row in ${name}.` }
  const allowed = gate(t, name, 'delete', { mine: row.userId === t.principal.userId })
  if (!allowed.ok) return allowed
  await prisma.appToolRecord.delete({ where: { id: row.id } })
  announce(row.targetKey, name, row.userId)
  return { ok: true, value: { id: row.id } }
}

export async function countRows(
  t: ResolvedTarget,
  name: string,
  query: { where?: Where; mine?: boolean; groupBy?: string },
): Promise<CollectionAnswer<{ total: number; groups?: Array<{ value: string | null; count: number }> }>> {
  const allowed = gate(t, name, 'read')
  if (!allowed.ok) return allowed
  const problem = queryDenial(query)
  if (problem) return { ok: false, code: 'invalid', message: problem }
  const own = query.mine || readsOwnOnly(allowed.spec, { isAdmin: t.isAdmin })
  const where: Prisma.AppToolRecordWhereInput = {
    targetKey: targetKeyOf(t),
    collection: name,
    detachedAt: null,
    ...(own ? { userId: t.principal.userId } : {}),
    AND: jsonWhere(query.where),
  }
  const total = await prisma.appToolRecord.count({ where })
  if (!query.groupBy) return { ok: true, value: { total } }
  // One GROUP BY over the field's text, filtered as the count was. The field
  // name is a bound parameter, never spliced into the SQL.
  const filters = Object.entries(query.where ?? {})
  const clauses: Prisma.Sql[] = [
    Prisma.sql`target_key = ${targetKeyOf(t)}`,
    Prisma.sql`collection = ${name}`,
    Prisma.sql`detached_at IS NULL`,
    ...(own ? [Prisma.sql`user_id = ${t.principal.userId}`] : []),
    // `null` matches a field set to null or absent, as the list's filter does.
    ...filters.map(([key, value]) =>
      value === null
        ? Prisma.sql`coalesce(data -> ${key}, 'null'::jsonb) = 'null'::jsonb`
        : Prisma.sql`(data -> ${key}) = ${JSON.stringify(value)}::jsonb`,
    ),
  ]
  const groups = await prisma.$queryRaw<Array<{ value: string | null; count: bigint }>>`
    SELECT data ->> ${query.groupBy} AS value, count(*) AS count
    FROM app_tool_records
    WHERE ${Prisma.join(clauses, ' AND ')}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
    LIMIT 100
  `
  return { ok: true, value: { total, groups: groups.map((g) => ({ value: g.value, count: Number(g.count) })) } }
}

// ── installs come and go ─────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | typeof prisma

/** An uninstall keeps its rows, detached, for a re-install to take back. */
export async function detachRows(installId: string, db: Db = prisma, now: Date = new Date()): Promise<number> {
  const result = await db.appToolRecord.updateMany({ where: { targetKey: installId, detachedAt: null }, data: { detachedAt: now } })
  return result.count
}

/**
 * A Tool installed again in a space takes back the rows its last install
 * left — matched by the Tool's key, or any key its listing has had, so a
 * listing that changed hands still finds them.
 */
export async function adoptRows(spaceId: string, installId: string, tool: { key: string; listingId?: string | null }, db: Db = prisma): Promise<number> {
  const keys = new Set([tool.key])
  if (tool.listingId) {
    const versions = await db.appToolVersion.findMany({ where: { listingId: tool.listingId }, select: { key: true }, distinct: ['key'] })
    for (const v of versions) keys.add(v.key)
  }
  const result = await db.appToolRecord.updateMany({
    where: { spaceId, toolKey: { in: [...keys] }, detachedAt: { not: null } },
    data: { targetKey: installId, toolKey: tool.key, detachedAt: null },
  })
  return result.count
}

/** A working copy's preview rows, when the working copy is deleted. */
export async function dropPreviewRows(spaceId: string, name: string): Promise<number> {
  const result = await prisma.appToolRecord.deleteMany({ where: { spaceId, targetKey: previewTargetKey(spaceId, name) } })
  return result.count
}

/** What stayed detached past its time goes. */
export async function purgeDetachedRows(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - DETACHED_DAYS * 86_400_000)
  const result = await prisma.appToolRecord.deleteMany({ where: { detachedAt: { lt: before } } })
  return result.count
}

/** An install's rows, for its space's admins: data and times, never who wrote them. */
export async function exportRows(spaceId: string, installId: string): Promise<Record<string, Array<{ id: string; data: unknown; createdAt: string; updatedAt: string }>>> {
  const rows = await prisma.appToolRecord.findMany({
    where: { spaceId, targetKey: installId },
    orderBy: [{ collection: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, collection: true, data: true, createdAt: true, updatedAt: true },
    take: 200_000,
  })
  const out: Record<string, Array<{ id: string; data: unknown; createdAt: string; updatedAt: string }>> = {}
  for (const row of rows) {
    ;(out[row.collection] ??= []).push({ id: row.id, data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })
  }
  return out
}
