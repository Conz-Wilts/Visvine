/**
 * Where an agent's brief lives: `agents/<name>/index.md`, the index of the
 * agent's own folder (lib/agents/config.ts). The name is the folder segment,
 * so it is unique in the space by construction and every read-by-name is one
 * path lookup. The flat form `agents/<name>.md` is an alias a note written
 * before the folder era may still sit at until `db:agents:folders` moves it;
 * it is read here so such an agent keeps running, never written.
 */
import prisma from '@/lib/prisma'
import { agentBriefAliasPath, agentBriefPath } from './config'

const SHARED_OWNER_KEY = 'shared'

export interface AgentBriefRow {
  path: string
  content: string
  createdBy: string | null
}

/** The brief for `name`, or null when the agent does not exist. */
export async function findAgentBrief(spaceId: string, name: string): Promise<AgentBriefRow | null> {
  const index = agentBriefPath(name)
  const rows = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { in: [index, agentBriefAliasPath(name)] } },
    select: { path: true, content: true, createdBy: true },
  })
  // The folder form wins when both exist — the alias is only ever a leftover.
  return rows.find((r) => r.path === index) ?? rows[0] ?? null
}
