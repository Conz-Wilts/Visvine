/**
 * Where an agent's brief lives. An agent is named by its leaf — `digest` —
 * and the brief may sit anywhere under `agents/` except `agents/live/`: at
 * `agents/digest.md` or inside a folder of agents (`agents/ops/digest.md`).
 * The folders are ordinary context folders (each one an index note) and only
 * organise; the name is what activation, state rows, runs and the `agent:`
 * node key on. So every read-by-name goes through {@link findAgentBrief}.
 *
 * Two briefs sharing a leaf would be one agent with two bodies. The canonical
 * one is the shallowest path (then alphabetical); the roster flags the rest as
 * duplicates rather than guessing.
 */
import prisma from '@/lib/prisma'
import { isAgentBriefPath } from '@/lib/notes/entities'

const SHARED_OWNER_KEY = 'shared'

export interface AgentBriefRow {
  path: string
  content: string
  createdBy: string | null
}

/** Shallowest first, then alphabetical — the order duplicates are ranked in. */
export function canonicalBriefOrder(a: string, b: string): number {
  const depth = a.split('/').length - b.split('/').length
  return depth !== 0 ? depth : a.localeCompare(b)
}

/** Every live brief in the space with this leaf name, canonical first. */
async function findAgentBriefs(spaceId: string, name: string): Promise<AgentBriefRow[]> {
  const rows = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'agents/', endsWith: `/${name}.md` } },
    select: { path: true, content: true, createdBy: true },
  })
  return rows.filter((r) => isAgentBriefPath(r.path)).sort((a, b) => canonicalBriefOrder(a.path, b.path))
}

/** The canonical brief for `name`, or null when the agent does not exist. */
export async function findAgentBrief(spaceId: string, name: string): Promise<AgentBriefRow | null> {
  return (await findAgentBriefs(spaceId, name))[0] ?? null
}
