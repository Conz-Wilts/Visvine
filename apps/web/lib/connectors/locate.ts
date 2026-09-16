// Where a context's connector notes ARE.
//
// A connector is the note that declares `type: connector`, wherever a space
// filed it (lib/notes/shared/configKinds.ts): `connectors/<name>.md` is where
// a new one lands, and a team folder is as good a home. So nothing may find a
// connector by building its path — every grant-free reader that used to query
// `connectors/` comes here, and the answer is the same one the console lists
// and the runtime loads.
//
// Two reads. `connectorNotePathIn` answers one name: the built-in folder
// first (one indexed row lookup, the common case), then the declaring notes.
// `connectorNoteRows` lists them all, narrowed in the database to notes whose
// text says `type: connector` — case-insensitive, because a hand-written
// `type: Connector` counts everywhere else — and then read through the real
// parser, so a note that only mentions the words in prose is not one.
//
// No principal here on purpose: these answer WHAT the space has, for the
// callers that read configuration rather than a member's view of it (the
// machine policy, the webhook door, the agent options). A caller with a
// person behind it reads the path this returns through their lens.

import prisma from '@/lib/prisma'
import { connectorHomeDenial, connectorNameOfPath, CONNECTORS_HOME, isConnectorNoteAt } from '@/lib/notes/shared/configKinds'

export interface ContextRef {
  spaceId: string
  ownerKey: string
}

export interface ConnectorNoteRow {
  name: string
  path: string
  content: string
}

/** `connectors/<name>.md` — where a connector is written unless it was moved. */
export function connectorHomePath(name: string): string {
  return `${CONNECTORS_HOME}/${name}.md`
}

/**
 * Every connector note in a context, by name order, or only the `names`
 * asked for. A note in the built-in folder wins its name over one elsewhere —
 * two such notes is a state the write gate refuses, so this is only the tie
 * rule for data written before the gate existed.
 */
export async function connectorNoteRows(context: ContextRef, names?: readonly string[]): Promise<ConnectorNoteRow[]> {
  if (names && names.length === 0) return []
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      path: { endsWith: '.md' },
      content: { contains: 'type: connector', mode: 'insensitive' },
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  const wanted = names ? new Set(names) : null
  const byName = new Map<string, ConnectorNoteRow>()
  for (const row of rows) {
    const name = connectorNameOfPath(row.path)
    if (!name || (wanted && !wanted.has(name))) continue
    if (!isConnectorNoteAt(row.path, row.content)) continue
    const held = byName.get(name)
    if (held && held.path === connectorHomePath(name)) continue
    byName.set(name, { name, path: row.path, content: row.content })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Where the connector `name` lives in a context, or null when it has none.
 * Grant-free: the caller reads the path through whatever lens it holds.
 */
export async function connectorNotePathIn(context: ContextRef, name: string): Promise<string | null> {
  if (connectorHomeDenial(connectorHomePath(name))) return null
  const home = connectorHomePath(name)
  const at = await prisma.contextNote.findFirst({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: home, deletedAt: null },
    select: { id: true },
  })
  if (at) return home
  const [row] = await connectorNoteRows(context, [name])
  return row?.path ?? null
}
