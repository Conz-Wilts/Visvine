// Where an agent's folder may sit, and what a path inside one is.
//
// An agent is the folder whose index declares `type: agent`. `agents/<name>/`
// is where a new one lands; a folder of the space's own is as good a home — a
// space that files its agents by team keeps `teams/growth/digest/index.md`,
// and that IS the agent `digest`. The folder's last segment is the agent's
// name, and the name is its identity (the state row, runs, subscribers and
// the `agent:<name>` node all key on it), so an agent moves between folders
// and never changes name that way.
//
// Everything here is pure: the path of the folder is handed in by whoever
// found it (lib/agents/location.ts), so the one rule is shared by the gate,
// the hooks, the runner and node:test.

import { INDEX_BASENAME } from '../../notes/shared/indexNote'
import { namespaceOf } from '../../notes/shared/namespaces'
import { parseFrontmatter } from '../../notes/shared/markdown'

/** The built-in folder a new agent is written to. */
export const AGENTS_HOME = 'agents'

/** An agent's name: its folder's last segment. */
const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** `agents/<name>` — where an agent's folder is unless it was moved. */
export function agentHomeFolder(name: string): string {
  return `${AGENTS_HOME}/${name}`
}

/** The last segment of a folder path — the agent's name. */
export function agentNameOfFolder(folder: string): string {
  return folder.slice(folder.lastIndexOf('/') + 1)
}

/** The pre-merge activation note's basename — still read, never written. */
export const ACTIVATION_BASENAME = 'activation.md'

/** What a path inside an agent's folder is. */
export type AgentFile = 'brief' | 'activation' | 'own'

/**
 * What `path` is inside the agent folder `folder`, or null when it is not
 * directly in it. Only the top level: a sub-folder under the agent is fine to
 * READ but its index would be a folder the agent made, and folders are a
 * person's to make.
 */
export function agentFileIn(folder: string, path: string): AgentFile | null {
  if (!path.startsWith(`${folder}/`)) return null
  const rest = path.slice(folder.length + 1)
  if (!rest.endsWith('.md') || rest.includes('/')) return null
  if (rest === INDEX_BASENAME) return 'brief'
  if (rest === ACTIVATION_BASENAME) return 'activation'
  return 'own'
}

/**
 * Why an agent's folder may not be `folder`, or null when it may:
 * `agents/<name>` or a folder of the space's own. Never inside another
 * built-in folder (whose paths mean something else), never under a federated
 * address, and never the top of the context.
 */
export function agentFolderDenial(folder: string): string | null {
  const clean = folder.replace(/^\/+|\/+$/g, '')
  if (!clean) return 'An agent is a folder of its own, not the context root.'
  const name = agentNameOfFolder(clean)
  if (!AGENT_NAME_RE.test(name)) {
    return 'An agent’s folder name is its name: lowercase letters, digits, "-" and "_", up to 64 characters.'
  }
  const ns = namespaceOf(clean)
  if (!ns) return null
  if (ns.writes === 'nobody') return 'An agent is written in the space that owns it.'
  if (ns.dir !== AGENTS_HOME) {
    return `"${ns.dir}" is one of the space's built-in folders — an agent sits in "${AGENTS_HOME}/" or in a folder of your own.`
  }
  if (clean !== agentHomeFolder(name)) {
    return `Inside "${AGENTS_HOME}/" an agent is ${AGENTS_HOME}/<name> — to group agents, use a folder of your own.`
  }
  return null
}

/** True when this content declares `type: agent`. */
export function declaresAgent(content: string | null | undefined): boolean {
  if (!content || !/^\s*type\s*:\s*["']?agent["']?\s*$/im.test(content)) return false
  const type = parseFrontmatter(content).type
  return typeof type === 'string' && type.trim().toLowerCase() === 'agent'
}

/**
 * The agent folder a brief at `path` with `content` makes, or null: an index
 * declaring `type: agent` in a folder an agent may sit in. Under `agents/`
 * the path alone is enough — every index there is a brief, as it always was.
 */
export function briefFolderOf(path: string, content: string | null | undefined): string | null {
  return briefFolderFor(path, () => declaresAgent(content))
}

/** {@link briefFolderOf} over parsed frontmatter — the tree's read. */
export function briefFolderOfMeta(path: string, frontmatter: Record<string, unknown> | null | undefined): string | null {
  return briefFolderFor(path, () => typeof frontmatter?.type === 'string' && frontmatter.type.trim().toLowerCase() === 'agent')
}

function briefFolderFor(path: string, declared: () => boolean): string | null {
  if (!path.endsWith(`/${INDEX_BASENAME}`)) return null
  const folder = path.slice(0, -(INDEX_BASENAME.length + 1))
  if (agentFolderDenial(folder)) return null
  if (folder.startsWith(`${AGENTS_HOME}/`)) return folder
  return declared() ? folder : null
}

/** Every folder above `path`, nearest first: `a/b/c.md` → `a/b`, `a`. */
export function ancestorFolders(path: string): string[] {
  const out: string[] = []
  let cut = path.lastIndexOf('/')
  while (cut > 0) {
    out.push(path.slice(0, cut))
    cut = path.lastIndexOf('/', cut - 1)
  }
  return out
}

/**
 * The folder a brief note at `path` is the index of — `agents/<name>` for the
 * flat alias `agents/<name>.md` a note from before the folder era may sit at.
 */
export function agentFolderOfBrief(path: string, name: string): string {
  return path.endsWith(`/${INDEX_BASENAME}`) ? path.slice(0, -(INDEX_BASENAME.length + 1)) : agentHomeFolder(name)
}
