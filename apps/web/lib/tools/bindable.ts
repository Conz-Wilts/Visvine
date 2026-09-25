/**
 * What a space can bind a Tool's slots to: its folders, its types with their
 * fields, its connectors with their recipes, its agents
 * (@visvine/tool-protocol bindings.ts#BindableSpace). Read when an install is
 * made or re-bound, and for the install sheet's pickers.
 */
import prisma from '@/lib/prisma'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { connectorNoteRows } from '@/lib/connectors/locate'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { fieldsForType } from '@/lib/types/typeFields'
import { DEFAULT_NODE_TYPES, type NodeTypeConfig } from '@/lib/types'
import type { BindableSpace } from '@visvine/tool-protocol/bindings'

/** Every folder a note sits under, and every folder row: the paths a folder slot may name. */
async function foldersOf(spaceId: string): Promise<string[]> {
  const [notes, folders] = await Promise.all([
    prisma.contextNote.findMany({ where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null }, select: { path: true } }),
    prisma.contextFolder.findMany({ where: { spaceId, ownerKey: SHARED_OWNER_KEY }, select: { path: true } }),
  ])
  const out = new Set<string>(folders.map((f) => f.path).filter(Boolean))
  for (const { path } of notes) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'))
  }
  return [...out].sort()
}

export async function bindableSpace(spaceId: string): Promise<BindableSpace> {
  const [space, folders, connectorRows, agents] = await Promise.all([
    prisma.space.findUnique({ where: { id: spaceId }, select: { nodeTypes: true } }),
    foldersOf(spaceId),
    connectorNoteRows({ spaceId, ownerKey: SHARED_OWNER_KEY }),
    prisma.agentState.findMany({ where: { spaceId, briefNoteId: { not: null } }, select: { name: true } }),
  ])
  const stored = (space?.nodeTypes ?? []) as unknown as NodeTypeConfig[]
  const byName = new Map<string, NodeTypeConfig>()
  for (const t of [...DEFAULT_NODE_TYPES, ...stored]) byName.set(t.name.toLowerCase(), t)
  const types: Record<string, string[]> = {}
  for (const t of byName.values()) {
    types[t.name] = [...new Set([...(t.fields ?? []).map((f) => f.key), ...fieldsForType(t.name).map((f) => f.key)])]
  }
  return {
    folders,
    types,
    connectors: connectorRows.map((row) => {
      const recipe = parseFrontmatter(row.content).recipe
      return { name: row.name, recipe: typeof recipe === 'string' ? recipe : null }
    }),
    agents: agents.map((a) => a.name),
  }
}
