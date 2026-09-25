// Where a context's model notes ARE.
//
// A model is the note that declares `type: model`, wherever a space filed it
// (lib/notes/shared/configKinds.ts): `models/<name>.md` is where a new one
// lands, and a folder of the space's own is as good a home. The same two
// reads as lib/connectors/locate.ts, for the same reason — nothing may find a
// model by building its path.

import prisma from '@/lib/prisma'
import { isModelNoteAt, MODELS_HOME, modelNameOfNotePath } from '@/lib/notes/shared/configKinds'
import type { ContextRef } from '@/lib/connectors/locate'

export interface ModelNoteRow {
  name: string
  path: string
  content: string
}

/** `models/<name>.md` — where a model is written unless it was moved. */
export function modelHomePath(name: string): string {
  return `${MODELS_HOME}/${name}.md`
}

/**
 * Every model note in a context, in path order, the home folder first. A note
 * in `models/` wins its name over one elsewhere — two such notes is a state
 * the write gate refuses, so this is only the tie rule for older data.
 */
export async function modelNoteRows(context: ContextRef): Promise<ModelNoteRow[]> {
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      path: { endsWith: '.md' },
      content: { contains: 'model', mode: 'insensitive' },
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  const byName = new Map<string, ModelNoteRow>()
  for (const row of rows) {
    if (!isModelNoteAt(row.path, row.content)) continue
    const name = modelNameOfNotePath(row.path)
    if (!name) continue
    const held = byName.get(name)
    if (held && held.path === modelHomePath(name)) continue
    byName.set(name, { name, path: row.path, content: row.content })
  }
  const home = (r: ModelNoteRow) => (r.path === modelHomePath(r.name) ? 0 : 1)
  return [...byName.values()].sort((a, b) => home(a) - home(b) || a.path.localeCompare(b.path))
}

/** Where the model `name` lives in a context, or null. Grant-free. */
export async function modelNotePathIn(context: ContextRef, name: string): Promise<string | null> {
  const home = modelHomePath(name)
  const at = await prisma.contextNote.findFirst({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: home, deletedAt: null },
    select: { id: true },
  })
  if (at) return home
  const row = (await modelNoteRows(context)).find((r) => r.name === name)
  return row?.path ?? null
}
