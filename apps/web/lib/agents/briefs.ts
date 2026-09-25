/**
 * Where an agent's brief lives: the index of the agent's own folder —
 * `agents/<name>/index.md`, or a folder of the space's own named `<name>`
 * (lib/agents/location.ts). The name is the folder's last segment. The flat form `agents/<name>.md` is an alias a note written
 * before the folder era may still sit at until `db:agents:folders` moves it;
 * it is read here so such an agent keeps running, never written.
 */
import prisma from '@/lib/prisma'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import {
  agentActivationPath,
  agentBriefAliasPath,
  hasActivationFrontmatter,
  parseAgentActivation,
  parseAgentBrief,
  type ParseActivationResult,
  type ParseBriefResult,
} from './config'
import { agentFolderIn } from './location'
import { ACTIVATION_BASENAME, agentHomeFolder, agentNameOfFolder, briefFolderOf } from './shared/folder'
import { configFromColumns, effectiveFrontmatter, type AgentConfig } from './shared/agentConfig'

const SHARED_OWNER_KEY = 'shared'

export interface AgentBriefRow {
  /** The space the note is in — the house's, for a run-in copy. */
  spaceId: string
  /** The note row's own id — what says this is the SAME brief and not a new
   *  agent that happens to have taken the name back. */
  id: string
  path: string
  content: string
  createdBy: string | null
}

/**
 * The brief note at `name` in `spaceId` itself, or null: the index of the
 * agent's folder wherever the space filed it (lib/agents/location.ts), or the
 * flat alias `agents/<name>.md`.
 */
export async function findOwnAgentBrief(spaceId: string, name: string): Promise<AgentBriefRow | null> {
  const folder = (await agentFolderIn(spaceId, name)) ?? agentHomeFolder(name)
  const index = `${folder}/index.md`
  const rows = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { in: [index, agentBriefAliasPath(name)] } },
    select: { id: true, path: true, content: true, createdBy: true },
  })
  // The folder form wins when both exist — the alias is only ever a leftover.
  const row = rows.find((r) => r.path === index) ?? rows[0] ?? null
  return row ? { ...row, spaceId } : null
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
 * How the agent at `name` in `spaceId` runs — its record, or null for a row
 * from before the record existed (its note still says). A run-in copy runs
 * the HOUSE's record, as it runs the house's brief.
 */
export async function agentConfigOf(spaceId: string, name: string): Promise<AgentConfig | null> {
  const row = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } })
  if (row?.sharedFrom) return agentConfigOf(row.sharedFrom, name)
  if (!row?.configuredAt) return null
  const subs = await prisma.agentSubscription.findMany({ where: { spaceId, name }, orderBy: { createdAt: 'asc' } })
  return configFromColumns(row, subs)
}

/** One agent as every reader sees it: the note's prose with the record's run keys laid over it. */
export interface ComposedAgent {
  /** The frontmatter the parsers read — the note's own keys, the record's run keys. */
  fm: NoteFrontmatter
  body: string
  brief: ParseBriefResult
  activation: ParseActivationResult
}

export function composeAgent(noteContent: string, config: AgentConfig | null): ComposedAgent {
  const fm = effectiveFrontmatter(parseFrontmatter(noteContent), config)
  const body = splitFrontmatter(noteContent).body
  return { fm, body, brief: parseAgentBrief(fm, body), activation: parseAgentActivation(fm) }
}

export interface AgentRecord extends ComposedAgent {
  note: AgentBriefRow
  /** The record, or null when the note still carries it (a row from before). */
  config: AgentConfig | null
}

/**
 * THE read of an agent: its note and its record, composed. Null when there is
 * no such agent. Every reader — runner, tick, roster, chat, tools — goes
 * through this, so none of them knows which half a key lives in.
 */
export async function readAgent(spaceId: string, name: string): Promise<AgentRecord | null> {
  const [note, config] = await Promise.all([findAgentBrief(spaceId, name), agentConfigOf(spaceId, name)])
  if (!note) return null
  if (config) return { note, config, ...composeAgent(note.content, config) }
  // Not yet a record: the note's own keys, with a pre-merge activation.md as before.
  const composed = composeAgent(note.content, null)
  const activation = (await findAgentActivation(spaceId, name)).parsed ?? composed.activation
  return { note, config: null, ...composed, activation }
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
  const config = brief ? await agentConfigOf(spaceId, name) : null
  if (brief && config) {
    return { parsed: composeAgent(brief.content, config).activation, path: brief.path, content: brief.content, legacy: false }
  }
  if (brief) {
    const fm = parseFrontmatter(brief.content)
    if (hasActivationFrontmatter(fm)) {
      return { parsed: parseAgentActivation(fm), path: brief.path, content: brief.content, legacy: false }
    }
  }
  const activationPath = brief?.path.endsWith('/index.md') ? `${brief.path.slice(0, -'index.md'.length)}${ACTIVATION_BASENAME}` : agentActivationPath(name)
  const legacy = await prisma.contextNote.findFirst({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, path: activationPath, deletedAt: null },
    select: { content: true },
  })
  if (legacy) {
    return { parsed: parseAgentActivation(parseFrontmatter(legacy.content)), path: activationPath, content: legacy.content, legacy: true }
  }
  return { parsed: brief ? parseAgentActivation({}) : null, path: brief?.path ?? null, content: brief?.content ?? null, legacy: false }
}

/**
 * A reader of `space`'s notes that sees each agent brief's SHARE the way the
 * share-down rules need it (`isSharedDown`): the note's frontmatter with the
 * record's `share` / `share_as` laid over it, since a brief note no longer
 * carries them. One query for the whole space; other notes pass through.
 */
export async function withAgentShares(spaceId: string): Promise<(path: string, fm: NoteFrontmatter) => NoteFrontmatter> {
  const rows = await prisma.agentState.findMany({
    where: { spaceId, configuredAt: { not: null }, sharedFrom: null },
    select: { name: true, shareMode: true, shareRooms: true, shareAs: true },
  })
  const byName = new Map(rows.map((r) => [r.name, r]))
  return (path, fm) => {
    const m = /^agents\/([^/]+)(?:\/index)?\.md$/.exec(path)
    // A brief filed in a folder of the space's own is named by its folder.
    const filed = !m && typeof fm.type === 'string' && fm.type.trim().toLowerCase() === 'agent' ? briefFolderOf(path, 'type: agent') : null
    const row = m ? byName.get(m[1]) : filed ? byName.get(agentNameOfFolder(filed)) : undefined
    if (!row) return fm
    const out: NoteFrontmatter = { ...fm }
    delete out.share
    delete out.share_as
    if (row.shareMode === 'all') out.share = 'all'
    else if (row.shareMode === 'rooms' && row.shareRooms.length) out.share = row.shareRooms
    if (out.share !== undefined && row.shareAs === 'run-in') out.share_as = 'run-in'
    return out
  }
}
