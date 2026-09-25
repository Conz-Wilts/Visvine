/**
 * The records projection: `context_records` and `context_record_fields`,
 * derived from notes that declare one of the space's invented types.
 *
 * Run on every note write, rename and delete through the outbox
 * (lib/notes/projections.ts#applyProjections), and by a full reconcile, so
 * the tables are always what the notes say. Values are judged here, not at
 * the write: any note writer can set frontmatter, so a value that does not
 * read as its field's kind is projected `invalid` and shown as such.
 *
 * A type's fields changing writes no note, so `reprojectTypes` re-reads the
 * notes that declare the changed types — called when the space's type
 * vocabulary is saved (lib/spaces/spaceConfig.ts#updateSpaceConfig).
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import type { Context } from '@/lib/notes/store'
import type { NodeTypeConfig } from '@/lib/types'
import { isNoteType, noteTypeFor, projectFieldValue, recordColumns, RECORD_SCAN_MAX } from './shared/fields'

async function spaceNodeTypes(spaceId: string): Promise<NodeTypeConfig[]> {
  const row = await prisma.space.findUnique({ where: { id: spaceId }, select: { nodeTypes: true } })
  return (row?.nodeTypes ?? []) as unknown as NodeTypeConfig[]
}

function titleOf(frontmatter: Record<string, unknown>, path: string): string {
  if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) return frontmatter.title.trim()
  const base = path.replace(/\/index\.md$/, '').split('/').pop() ?? path
  return base.replace(/\.md$/, '').replace(/[-_]+/g, ' ')
}

/** The note is gone, or declares no invented type any more: it is no record. */
export async function dropRecord(context: Context, path: string): Promise<void> {
  const where = { spaceId: context.spaceId, ownerKey: context.ownerKey, path }
  await prisma.contextRecordField.deleteMany({ where })
  await prisma.contextRecord.deleteMany({ where })
}

/** Project one note: its record row and one row per field it sets. */
export async function projectRecord(
  context: Context,
  path: string,
  content: string,
  nodeTypes?: NodeTypeConfig[],
): Promise<void> {
  const frontmatter = parseFrontmatter(content) as Record<string, unknown>
  const config = noteTypeFor(frontmatter.type, nodeTypes ?? (await spaceNodeTypes(context.spaceId)))
  if (!config) {
    await dropRecord(context, path)
    return
  }
  const note = await prisma.contextNote.findFirst({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path, deletedAt: null },
    select: { updatedAt: true },
  })
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((t): t is string => typeof t === 'string') : []
  const identity = { spaceId: context.spaceId, ownerKey: context.ownerKey, path }
  const fields = recordColumns(config).flatMap((column) => {
    const value = projectFieldValue(column, frontmatter[column.key])
    return value ? [{ ...identity, type: config.name, key: column.key, ...value }] : []
  })
  await prisma.$transaction([
    prisma.contextRecord.upsert({
      where: { context_record_identity: identity },
      create: { ...identity, type: config.name, title: titleOf(frontmatter, path), tags, updatedAt: note?.updatedAt ?? new Date() },
      update: { type: config.name, title: titleOf(frontmatter, path), tags, updatedAt: note?.updatedAt ?? new Date() },
    }),
    prisma.contextRecordField.deleteMany({ where: identity }),
    ...(fields.length ? [prisma.contextRecordField.createMany({ data: fields })] : []),
  ])
}

/** Which invented types' fields differ between two vocabularies — or appear or go. */
export function changedNoteTypes(before: NodeTypeConfig[] | null, after: NodeTypeConfig[] | null): string[] {
  const shape = (config: NodeTypeConfig | undefined) =>
    config && isNoteType(config) ? JSON.stringify((config.fields ?? []).map((f) => [f.key, f.kind, f.options ?? []])) : null
  const find = (list: NodeTypeConfig[] | null, name: string) => (list ?? []).find((t) => t.name.toLowerCase() === name.toLowerCase())
  const names = new Map<string, string>()
  for (const t of [...(before ?? []), ...(after ?? [])]) names.set(t.name.toLowerCase(), find(after, t.name)?.name ?? t.name)
  return [...names.values()].filter((name) => shape(find(before, name)) !== shape(find(after, name)))
}

/**
 * Re-read every note that declares one of these types — a field was added,
 * changed or dropped, or the type came or went — and project it again.
 * Bounded by RECORD_SCAN_MAX notes; past that the nightly reconcile catches up.
 */
export async function reprojectTypes(spaceId: string, typeNames: readonly string[]): Promise<number> {
  if (typeNames.length === 0) return 0
  const nodeTypes = await spaceNodeTypes(spaceId)
  const lowered = typeNames.map((name) => name.toLowerCase())
  // Records of a type that stopped being one of the space's invented types.
  const current = new Set(nodeTypes.filter(isNoteType).map((t) => t.name.toLowerCase()))
  const gone = typeNames.filter((name) => !current.has(name.toLowerCase()))
  if (gone.length) {
    await prisma.contextRecordField.deleteMany({ where: { spaceId, type: { in: [...gone] } } })
    await prisma.contextRecord.deleteMany({ where: { spaceId, type: { in: [...gone] } } })
  }
  const notes = await prisma.contextNote.findMany({
    where: {
      spaceId,
      deletedAt: null,
      OR: lowered.map((name) => ({ content: { contains: name, mode: 'insensitive' as const } })),
    },
    select: { ownerKey: true, path: true, content: true },
    take: RECORD_SCAN_MAX,
  })
  let projected = 0
  for (const note of notes) {
    const declared = parseFrontmatter(note.content).type
    if (typeof declared !== 'string' || !lowered.includes(declared.trim().toLowerCase())) continue
    try {
      await projectRecord({ spaceId, ownerKey: note.ownerKey }, note.path, note.content, nodeTypes)
      projected += 1
    } catch (err) {
      logger.warn('records.reproject.failed', { err, spaceId, path: note.path })
    }
  }
  return projected
}

/** Every invented type in a space, re-read — the backfill for notes written before the projection. */
export async function reprojectSpace(spaceId: string): Promise<number> {
  const names = (await spaceNodeTypes(spaceId)).filter(isNoteType).map((t) => t.name)
  return reprojectTypes(spaceId, names)
}
