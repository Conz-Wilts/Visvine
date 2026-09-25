// Where a space's agents ARE.
//
// An agent is the folder whose index declares `type: agent`
// (lib/agents/shared/folder.ts): `agents/<name>/` or a folder of the space's
// own. Nothing may find an agent by building its path — every read by name
// comes here, and so does every "is this path inside an agent?" question the
// gates, the hooks and the trigger matcher ask.
//
// The home folder is one indexed row lookup, the common case. A moved agent is
// found through its state row's `brief_note_id` — the note keeps its id
// through a move — and, for a brief with no row yet, by the declaration.

import prisma from '@/lib/prisma'
import { INDEX_BASENAME } from '@/lib/notes/shared/indexNote'
import {
  agentFileIn,
  agentFolderDenial,
  agentHomeFolder,
  agentNameOfFolder,
  ancestorFolders,
  AGENTS_HOME,
  declaresAgent,
  type AgentFile,
} from './shared/folder'

const SHARED_OWNER_KEY = 'shared'

/** The agent a path sits in, and what the path is there. */
export interface AgentAt {
  name: string
  folder: string
  file: AgentFile | null
}

/**
 * The folder of the agent `name` in `spaceId`, or null when it has none.
 * `agents/<name>` first, then wherever its brief note moved, then any folder
 * named `name` whose index declares `type: agent`.
 */
export async function agentFolderIn(spaceId: string, name: string): Promise<string | null> {
  const home = agentHomeFolder(name)
  const atHome = await prisma.contextNote.findFirst({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { in: [`${home}/${INDEX_BASENAME}`, `${home}.md`] } },
    select: { id: true },
  })
  if (atHome) return home
  const state = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { briefNoteId: true } })
  if (state?.briefNoteId) {
    const note = await prisma.contextNote.findFirst({
      where: { id: state.briefNoteId, spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null },
      select: { path: true, content: true },
    })
    const folder = note ? movedFolderOf(note.path, note.content, name) : null
    if (folder) return folder
  }
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED_OWNER_KEY,
      deletedAt: null,
      path: { endsWith: `/${name}/${INDEX_BASENAME}` },
      content: { contains: 'agent', mode: 'insensitive' },
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  for (const row of rows) {
    const folder = movedFolderOf(row.path, row.content, name)
    if (folder) return folder
  }
  return null
}

/** The folder a brief outside `agents/` makes for `name`, or null. */
function movedFolderOf(path: string, content: string, name: string): string | null {
  if (!path.endsWith(`/${INDEX_BASENAME}`)) return null
  const folder = path.slice(0, -(INDEX_BASENAME.length + 1))
  if (agentNameOfFolder(folder) !== name || agentFolderDenial(folder)) return null
  if (folder.startsWith(`${AGENTS_HOME}/`)) return folder
  return declaresAgent(content) ? folder : null
}

/**
 * The agent whose folder `path` is inside (at any depth), or null. The nearest
 * folder wins: an agent's sub-notes are its own, and a folder of the space's
 * own that happens to sit inside an agent is still that agent's.
 */
export async function agentContaining(spaceId: string, path: string): Promise<AgentAt | null> {
  const clean = path.replace(/^\/+/, '')
  const underHome = /^agents\/([^/]+)\//.exec(clean)
  if (underHome) {
    const folder = agentHomeFolder(underHome[1])
    return { name: underHome[1], folder, file: agentFileIn(folder, clean) }
  }
  const folders = ancestorFolders(clean).filter((f) => !agentFolderDenial(f))
  if (folders.length === 0) return null
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED_OWNER_KEY,
      deletedAt: null,
      path: { in: folders.map((f) => `${f}/${INDEX_BASENAME}`) },
      content: { contains: 'agent', mode: 'insensitive' },
    },
    select: { path: true, content: true },
  })
  const agentFolders = new Set(rows.filter((r) => declaresAgent(r.content)).map((r) => r.path.slice(0, -(INDEX_BASENAME.length + 1))))
  const folder = folders.find((f) => agentFolders.has(f))
  if (!folder) return null
  return { name: agentNameOfFolder(folder), folder, file: agentFileIn(folder, clean) }
}

/**
 * Every agent folder in a space: `agents/<name>` for each brief there, plus
 * each folder of the space's own whose index declares `type: agent`. Keyed by
 * name; a folder under `agents/` wins its name over one elsewhere.
 */
export async function agentFolders(spaceId: string): Promise<Map<string, string>> {
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED_OWNER_KEY,
      deletedAt: null,
      OR: [
        { path: { startsWith: `${AGENTS_HOME}/`, endsWith: `/${INDEX_BASENAME}` } },
        { path: { endsWith: `/${INDEX_BASENAME}` }, content: { contains: 'agent', mode: 'insensitive' } },
      ],
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  const out = new Map<string, string>()
  for (const row of rows) {
    const folder = row.path.slice(0, -(INDEX_BASENAME.length + 1))
    const name = agentNameOfFolder(folder)
    if (movedFolderOf(row.path, row.content, name) !== folder) continue
    const held = out.get(name)
    if (held && held === agentHomeFolder(name)) continue
    out.set(name, folder)
  }
  return out
}
