/**
 * The Tool perimeter — "which notes, types, connectors and agents may this Tool
 * touch", with nothing attached to it.
 *
 * This is the sibling of lib/connectors/perimeter.ts. A connector's perimeter is
 * about the outside world (hosts, request paths); a Tool's is about the inside:
 * the context paths it may read and write, the node types it may claim, the
 * connectors and agents it may drive. Everything here is pure, so the bridge,
 * the isolate runner, the marketplace review UI and the install checklist all
 * refuse — and describe — in the same words.
 *
 * Two things this module is NOT:
 *   • It is not authorization. A Tool's perimeter only ever NARROWS what the
 *     viewer could already read through their own grants; the bridge applies
 *     both, and the perimeter alone never grants anything.
 *   • It never throws for a policy decision. Every gate returns `null` when the
 *     thing is allowed and a refusal string otherwise, exactly like refuseHost /
 *     refusePath, so a Tool can catch the reason and a reviewer can read it.
 *
 * Perimeter entries are written literally in the Tool's index note by its
 * author, and an install shows them to an admin before anything runs, so a
 * denial may quote them back. The thing being judged — a path an installed Tool
 * asked for — may not be quotable, but it is always the viewer's own space data,
 * never a secret.
 */

/**
 * A Tool's declared reach. `read`/`write` are context-note globs; the other
 * three are name lists. Every list is deny-by-default: empty means none.
 */
export interface ToolPerimeter {
  /** Note globs the Tool may read, relative to the space's context root. */
  read: string[]
  /** Note globs the Tool may write. Says nothing about reading them. */
  write: string[]
  /** Node types the Tool may query and claim a surface for. */
  types: string[]
  /** Connector names the Tool's `data.js` may call. */
  connectors: string[]
  /** Agent names the Tool may run. */
  agents: string[]
}

/** The five dimensions, in the order a reviewer should read them. */
const PERIMETER_KEYS = ['read', 'write', 'types', 'connectors', 'agents'] as const
type PerimeterKey = (typeof PERIMETER_KEYS)[number]

/** How each dimension is named in refusals and review bullets. */
const DIMENSION_LABEL: Record<PerimeterKey, string> = {
  read: 'read globs',
  write: 'write globs',
  types: 'types',
  connectors: 'connectors',
  agents: 'agents',
}

function freezePerimeter(perimeter: ToolPerimeter): ToolPerimeter {
  for (const key of PERIMETER_KEYS) Object.freeze(perimeter[key])
  return Object.freeze(perimeter)
}

/**
 * A Tool that declared nothing. Frozen on purpose: it is the fallback a broken
 * or unparsed note falls back to, so a caller pushing an entry into it would
 * widen the reach of every other Tool in the process.
 */
export const EMPTY_PERIMETER: ToolPerimeter = freezePerimeter({
  read: [],
  write: [],
  types: [],
  connectors: [],
  agents: [],
})

export type ParseToolPerimeterResult =
  | { ok: true; perimeter: ToolPerimeter }
  | { ok: false; error: string }

/** A name-list entry: a bare name, `prefix-*`, or `*` for all of them. */
const NAME_ENTRY_RE = /^[a-z0-9][a-z0-9_-]{0,62}\*?$|^\*$/i

/** A glob entry: POSIX-ish path characters plus `*`; no traversal, no backslashes. */
const GLOB_ENTRY_RE = /^[A-Za-z0-9._*/-]+$/

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Drop a leading slash so `/deals/x.md` and `deals/x.md` are the same path. */
function normalizePath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

/** A single segment's regex source: `*` matches within the segment only. */
function segmentSource(segment: string): string {
  return segment.split('*').map(escapeRe).join('[^/]*')
}

const globCache = new Map<string, RegExp>()

// Compile a glob to an anchored regex.
//
// The grammar, kept deliberately small so a reviewer reading `deals/**` in a
// note knows exactly what it covers:
//   • paths are context-relative and POSIX (`deals/acme/index.md`);
//   • a single `*` matches within one segment — `people/*/index.md` covers
//     `people/ana/index.md` but not `people/ana/notes/index.md`;
//   • `**` as a WHOLE segment crosses segments — trailing (`deals/**`) means
//     everything below, in the middle (`people/**/index.md`) means any depth
//     including none. Glued to text (`deals**`) it is just two `*`s, i.e. still
//     within-segment;
//   • a trailing `/` (`deals/`) is shorthand for that folder and everything
//     below it — the same as `deals/**`.
// `?` is NOT a wildcard: a glob is matched against note paths somebody wrote,
// and one-character wildcards buy nothing but surprises.
function globRegExp(pattern: string): RegExp {
  const cached = globCache.get(pattern)
  if (cached) return cached

  // `deals/` → `deals/**`; a bare `**` already means everything.
  const normalized = pattern.endsWith('/') ? `${pattern}**` : pattern
  const parts = normalized.split('/')
  const source: string[] = ['^']
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1
    if (parts[i] === '**') {
      // Trailing: the rest of the path, however deep. Middle: zero or more
      // whole segments, which is what makes `people/**/index.md` also match
      // `people/index.md`.
      source.push(last ? '.*' : '(?:[^/]+/)*')
      continue
    }
    source.push(segmentSource(parts[i]))
    if (!last) source.push('/')
  }
  source.push('$')
  const re = new RegExp(source.join(''))
  globCache.set(pattern, re)
  return re
}

/** Does `path` match this glob? See {@link globRegExp} for the grammar. */
export function globMatch(pattern: string, path: string): boolean {
  const glob = normalizePath(pattern.trim())
  const target = normalizePath(path.trim())
  if (!glob || !target) return false
  return globRegExp(glob).test(target)
}

/** Does a name list entry (`hubspot`, `deal-*`, `*`) cover this name? */
function nameMatch(entry: string, name: string): boolean {
  const pattern = entry.trim().toLowerCase()
  const wanted = name.trim().toLowerCase()
  if (!pattern || !wanted) return false
  if (pattern === '*') return true
  if (pattern.endsWith('*')) return wanted.startsWith(pattern.slice(0, -1))
  return pattern === wanted
}

function parseGlobList(
  raw: unknown,
  field: string,
): { ok: true; list: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, list: [] }
  if (!Array.isArray(raw)) return { ok: false, error: `\`perimeter.${field}\` must be a list of note globs` }
  const list: string[] = []
  for (const entry of raw) {
    const value = typeof entry === 'string' ? entry.trim() : ''
    if (!value || !GLOB_ENTRY_RE.test(value) || value.split('/').some((seg) => seg === '.' || seg === '..')) {
      return {
        ok: false,
        error:
          `Bad \`perimeter.${field}\` entry ${JSON.stringify(entry)} — use a context-relative glob ` +
          'like "deals/**", "people/*/index.md" or "deals/" (that folder and everything below)',
      }
    }
    list.push(value)
  }
  return { ok: true, list: [...new Set(list)] }
}

function parseNameList(
  raw: unknown,
  field: string,
  lowercase: boolean,
): { ok: true; list: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, list: [] }
  if (!Array.isArray(raw)) return { ok: false, error: `\`perimeter.${field}\` must be a list of names` }
  const list: string[] = []
  for (const entry of raw) {
    const value = typeof entry === 'string' ? entry.trim() : ''
    if (!value || !NAME_ENTRY_RE.test(value)) {
      return {
        ok: false,
        error:
          `Bad \`perimeter.${field}\` entry ${JSON.stringify(entry)} — use a name, ` +
          'a prefix like "deal-*", or "*" for all of them',
      }
    }
    list.push(lowercase ? value.toLowerCase() : value)
  }
  return { ok: true, list: [...new Set(list)] }
}

/**
 * The frontmatter `perimeter:` block → a perimeter. Never throws; a bad entry
 * comes back as an author-readable error so the note still describes itself.
 * A missing block is a Tool that declared nothing, not an error — plenty of
 * Tools are pure UI over their own state.
 */
export function parseToolPerimeter(raw: unknown): ParseToolPerimeterResult {
  if (raw === undefined || raw === null) return { ok: true, perimeter: { ...EMPTY_PERIMETER } }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`perimeter` must be a map with read, write, types, connectors and agents' }
  }
  const block = raw as Record<string, unknown>

  const read = parseGlobList(block.read, 'read')
  if (!read.ok) return read
  const write = parseGlobList(block.write, 'write')
  if (!write.ok) return write
  // Type names are normalised lower-case, matching how parseToolConfig stores a
  // `surfaces.types` claim, so the two are comparable without a second pass.
  const types = parseNameList(block.types, 'types', true)
  if (!types.ok) return types
  const connectors = parseNameList(block.connectors, 'connectors', true)
  if (!connectors.ok) return connectors
  const agents = parseNameList(block.agents, 'agents', true)
  if (!agents.ok) return agents

  return {
    ok: true,
    perimeter: {
      read: read.list,
      write: write.list,
      types: types.list,
      connectors: connectors.list,
      agents: agents.list,
    },
  }
}

/** The shared refusal shape: `tool perimeter denied: …`. */
function refuse(
  entries: readonly string[],
  key: PerimeterKey,
  subject: string,
  matches: (entry: string) => boolean,
): string | null {
  const label = DIMENSION_LABEL[key]
  if (entries.length === 0) return `tool perimeter denied: this tool declares no ${label}`
  if (entries.some(matches)) return null
  return `tool perimeter denied: ${subject} is not in this tool's ${label} (${entries.join(', ')})`
}

/** May the Tool read this note path? Null when it may. */
export function refuseRead(perimeter: ToolPerimeter, notePath: string): string | null {
  return refuse(perimeter.read, 'read', notePath, (glob) => globMatch(glob, notePath))
}

/**
 * May the Tool write this note path? Null when it may.
 *
 * Write implies nothing about read and read implies nothing about write: a Tool
 * that appends to a log it may not read back is a real shape, and so is a
 * dashboard that reads everything and writes nothing. Both directions must be
 * declared, and the bridge asks this gate for the write half.
 */
export function refuseWrite(perimeter: ToolPerimeter, notePath: string): string | null {
  return refuse(perimeter.write, 'write', notePath, (glob) => globMatch(glob, notePath))
}

/** May the Tool touch nodes of this type (and claim its surface)? */
export function refuseType(perimeter: ToolPerimeter, typeName: string): string | null {
  return refuse(perimeter.types, 'types', typeName, (entry) => nameMatch(entry, typeName))
}

/** May the Tool's data code call this connector? */
export function refuseConnector(perimeter: ToolPerimeter, name: string): string | null {
  return refuse(perimeter.connectors, 'connectors', name, (entry) => nameMatch(entry, name))
}

/** May the Tool run this agent? */
export function refuseAgent(perimeter: ToolPerimeter, name: string): string | null {
  return refuse(perimeter.agents, 'agents', name, (entry) => nameMatch(entry, name))
}

/** True when the Tool declared no reach at all — it can only draw its own UI. */
export function perimeterIsEmpty(perimeter: ToolPerimeter): boolean {
  return PERIMETER_KEYS.every((key) => perimeter[key].length === 0)
}

export interface PerimeterDiff {
  read: { added: string[]; removed: string[] }
  write: { added: string[]; removed: string[] }
  types: { added: string[]; removed: string[] }
  connectors: { added: string[]; removed: string[] }
  agents: { added: string[]; removed: string[] }
}

/**
 * What changed between two perimeters — the thing an admin approving an upgrade
 * is really being asked about. Entries are compared literally: `deals/**` and
 * `deals/` cover the same notes but are not the same declaration, and a review
 * that quietly treated them as equal would be hiding an edit.
 */
export function diffPerimeter(prev: ToolPerimeter, next: ToolPerimeter): PerimeterDiff {
  const of = (key: PerimeterKey) => {
    const before = new Set(prev[key])
    const after = new Set(next[key])
    return {
      added: next[key].filter((entry) => !before.has(entry)),
      removed: prev[key].filter((entry) => !after.has(entry)),
    }
  }
  return {
    read: of('read'),
    write: of('write'),
    types: of('types'),
    connectors: of('connectors'),
    agents: of('agents'),
  }
}

/**
 * Human bullet lines for the review and install surfaces.
 *
 * Reads and writes are always stated, even when empty: "writes nothing" is the
 * single most reassuring line a reviewer can be shown, and leaving it out would
 * make an all-powerful Tool and a read-only one look alike at a glance. The
 * other three appear only when the Tool asked for them.
 */
export function describePerimeter(perimeter: ToolPerimeter): string[] {
  if (perimeterIsEmpty(perimeter)) {
    return ['Declares no reach — this tool reads and writes no space data']
  }
  const list = (entries: readonly string[]) => (entries.length > 0 ? entries.join(', ') : 'nothing')
  const lines = [
    `Reads ${list(perimeter.read)}`,
    `Writes ${list(perimeter.write)}`,
  ]
  if (perimeter.types.length > 0) lines.push(`Works with node types ${perimeter.types.join(', ')}`)
  if (perimeter.connectors.length > 0) lines.push(`Calls connectors ${perimeter.connectors.join(', ')}`)
  if (perimeter.agents.length > 0) lines.push(`Runs agents ${perimeter.agents.join(', ')}`)
  return lines
}
