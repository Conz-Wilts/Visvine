/**
 * Where an agent's brief lives: `agents/<name>/index.md`, the index of the
 * agent's own folder (lib/agents/config.ts). The name is the folder segment,
 * so it is unique in the space by construction and every read-by-name is one
 * path lookup. The flat form `agents/<name>.md` is an alias a note written
 * before the folder era may still sit at until `db:agents:folders` moves it;
 * it is read here so such an agent keeps running, never written.
 */
import prisma from '@/lib/prisma'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import {
  agentActivationPath,
  agentBriefAliasPath,
  agentBriefPath,
  hasActivationFrontmatter,
  parseAgentActivation,
  type ParseActivationResult,
} from './config'

const SHARED_OWNER_KEY = 'shared'

export interface AgentBriefRow {
  /** The note row's own id — what says this is the SAME brief and not a new
   *  agent that happens to have taken the name back. */
  id: string
  path: string
  content: string
  createdBy: string | null
}

/** The brief note at `name` in `spaceId` itself, or null. */
export async function findOwnAgentBrief(spaceId: string, name: string): Promise<AgentBriefRow | null> {
  const index = agentBriefPath(name)
  const rows = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { in: [index, agentBriefAliasPath(name)] } },
    select: { id: true, path: true, content: true, createdBy: true },
  })
  // The folder form wins when both exist — the alias is only ever a leftover.
  return rows.find((r) => r.path === index) ?? rows[0] ?? null
}

/**
 * The brief for `name`, or null when the agent does not exist. A space's own
 * note first; failing that, a run-in COPY — a state row of this space naming
 * the house whose brief it runs (docs/sub-spaces.md) — reads the house's.
 * One step, never a chain: a house has no house.
 */
export async function findAgentBrief(spaceId: string, name: string): Promise<AgentBriefRow | null> {
  const own = await findOwnAgentBrief(spaceId, name)
  if (own) return own
  const copy = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { sharedFrom: true } })
  if (!copy?.sharedFrom) return null
  return findOwnAgentBrief(copy.sharedFrom, name)
}

export interface AgentActivationSource {
  /** The parse of whichever note carries the activation, or null when there is none. */
  parsed: ParseActivationResult | null
  /** The note the activation was read from — the brief, or a pre-merge activation.md. */
  path: string | null
  /** That note's content, for a caller about to write `active: false` back into it. */
  content: string | null
  /** True when it came from the pre-merge `agents/<name>/activation.md`. */
  legacy: boolean
}

/**
 * Where this agent's activation is, and what it says.
 *
 * The brief IS the activation now, so the answer is normally its own
 * frontmatter. A brief carrying no activation keys is one written before the
 * merge: its `activation.md` is read instead, so it keeps running until
 * `db:agents:activation` folds it in. The brief always wins once it has any —
 * a stale sibling can never contradict the note a person just edited.
 */
export async function findAgentActivation(spaceId: string, name: string): Promise<AgentActivationSource> {
  const brief = await findAgentBrief(spaceId, name)
  if (brief) {
    const fm = parseFrontmatter(brief.content)
    if (hasActivationFrontmatter(fm)) {
      return { parsed: parseAgentActivation(fm), path: brief.path, content: brief.content, legacy: false }
    }
  }
  const legacy = await prisma.contextNote.findFirst({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, path: agentActivationPath(name), deletedAt: null },
    select: { content: true },
  })
  if (legacy) {
    return { parsed: parseAgentActivation(parseFrontmatter(legacy.content)), path: agentActivationPath(name), content: legacy.content, legacy: true }
  }
  return { parsed: brief ? parseAgentActivation({}) : null, path: brief?.path ?? null, content: brief?.content ?? null, legacy: false }
}
