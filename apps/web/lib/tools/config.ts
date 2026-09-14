/**
 * The Tool note contract — pure, no I/O (tests import this directly).
 *
 * A Tool is the third note-first entity, after connectors and agents, and the
 * first one that needs a whole folder:
 *
 *   tools/<name>/index.md    the CONFIG + docs
 *   ---
 *   type: tool
 *   title: Deal Pipeline
 *   description: Kanban over deal notes
 *   version: 3                                  # bumped by publish
 *   surfaces:
 *     rail: { label: Deals, icon: kanban }      # optional rail item + full page
 *     types: [{ type: deal, mode: page }]       # page for custom types, tab on built-ins
 *   perimeter:
 *     read: ["deals/**", "clients/index.md"]
 *     write: ["deals/**"]
 *     types: [deal]
 *     connectors: [hubspot]
 *     agents: ["deal-*"]
 *   ---
 *   The body is author-facing docs: what the Tool does and how it works.
 *
 *   tools/<name>/ui.md       the UI source — one fenced ```tsx block
 *   tools/<name>/data.md     the data source — one fenced ```js block
 *
 * The sources live inside markdown because the note store only accepts `.md`
 * (lib/notes/store.ts#assertMarkdown), and a note is what buys the feature note
 * history, grants, the write gate and MCP authoring for free. Authors never see
 * the wrapper: over MCP they address `ui.tsx` / `data.js` and the service wraps
 * and unwraps around them (see TOOL_SOURCE_FILES).
 *
 * Everything here follows the connector precedent — `{ ok, … } | { ok: false,
 * error }`, never a throw for a policy decision — so a half-written Tool still
 * describes itself on the roster instead of vanishing.
 */
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { entityKindOf } from '@/lib/notes/entities'
import { parseToolPerimeter, type ToolPerimeter } from './perimeter'

/** The context namespace every Tool lives under. */
export const TOOLS_DIR = 'tools'

/**
 * A Tool name is also a URL segment (`/t/<name>`), a node id suffix
 * (`tool:<name>`) and a rail key (`tool:<name>`), so it stays lower-case,
 * hyphenated and short. Underscores are out — unlike agents — because these
 * names are read by people browsing a marketplace.
 */
export const TOOL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

const TOOL_TYPE = 'tool'
const INDEX_BASENAME = 'index.md'

/** `tools/<name>` — the Tool's entity folder. */
export function toolFolderPath(name: string): string {
  return `${TOOLS_DIR}/${name}`
}

/** `tools/<name>/index.md` — config in the frontmatter, docs in the body. */
export function toolIndexPath(name: string): string {
  return `${toolFolderPath(name)}/${INDEX_BASENAME}`
}

/** `tools/<name>/ui.md` — the wrapped TSX the author writes as `ui.tsx`. */
export function toolUiPath(name: string): string {
  return `${toolFolderPath(name)}/${TOOL_SOURCE_FILES.ui.path}`
}

/** `tools/<name>/data.md` — the wrapped JS the author writes as `data.js`. */
export function toolDataPath(name: string): string {
  return `${toolFolderPath(name)}/${TOOL_SOURCE_FILES.data.path}`
}

/** `tools/<name>/icon.md` — the wrapped SVG the author writes as `icon.svg`. */
export function toolIconPath(name: string): string {
  return `${toolFolderPath(name)}/${TOOL_SOURCE_FILES.icon.path}`
}

/** Drop a leading slash, so `/tools/x/index.md` reads like the stored path. */
function normalizePath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

/**
 * The Tool a context path belongs to, or null.
 *
 * Null for anything that isn't inside a valid Tool folder — the namespace's own
 * index (`tools/index.md`), a loose note (`tools/notes.md`), a folder whose
 * name a Tool could never have (`tools/Deal Pipeline/index.md`). Storage form
 * is always the folder, so there is no flat `tools/<name>.md` reading.
 */
export function toolNameOfPath(path: string): string | null {
  const m = /^tools\/([^/]+)\/.+$/.exec(normalizePath(path))
  if (!m || !TOOL_NAME_RE.test(m[1])) return null
  return m[1]
}

/**
 * What role a path plays inside its Tool folder: the config note, one of the two
 * sources, or `other` for anything else in the `tools/` namespace (a sub-note an
 * author filed beside them, the namespace index, a loose note). Null when the
 * path is not under `tools/` at all — that is the "not my business" answer the
 * store hooks branch on.
 */
export function toolFileKindOfPath(path: string): 'index' | 'ui' | 'data' | 'icon' | 'other' | null {
  const raw = normalizePath(path)
  if (raw !== TOOLS_DIR && !raw.startsWith(`${TOOLS_DIR}/`)) return null
  const name = toolNameOfPath(raw)
  if (!name) return 'other'
  const basename = raw.slice(toolFolderPath(name).length + 1)
  if (basename === INDEX_BASENAME) return 'index'
  if (basename === TOOL_SOURCE_FILES.ui.path) return 'ui'
  if (basename === TOOL_SOURCE_FILES.data.path) return 'data'
  if (basename === TOOL_SOURCE_FILES.icon.path) return 'icon'
  return 'other'
}

/** True for anything in the `tools/` namespace, whatever its role. */
export function isToolPath(path: string): boolean {
  return toolFileKindOfPath(path) !== null
}

/**
 * The source files, keyed by the role the runtime knows them by.
 *
 * `path` is the note basename inside the Tool folder; `authorName` is what the
 * file is called everywhere a person or an authoring agent sees it, and `lang`
 * is both the fence info string and what the compiler is told to expect.
 *
 * `icon` is optional and is not code: it holds the author's own rail glyph, and
 * it lives here rather than in a bucket for the same reason the sources do — a
 * Tool is notes, so its icon versions with `publish`, travels through the
 * marketplace install path, and lands in the review queue with everything else.
 * It is sanitized on the way in (lib/tools/iconSvg.ts), which matters more than
 * for the sources: unlike ui.tsx, the icon renders in the app's own document.
 */
export const TOOL_SOURCE_FILES = {
  ui: { path: 'ui.md', authorName: 'ui.tsx', lang: 'tsx' },
  data: { path: 'data.md', authorName: 'data.js', lang: 'js' },
  icon: { path: 'icon.md', authorName: 'icon.svg', lang: 'svg' },
} as const

type ToolSourceLang = (typeof TOOL_SOURCE_FILES)[keyof typeof TOOL_SOURCE_FILES]['lang']

const SOURCE_TYPE = 'tool-source'
const SOURCE_LANGS: readonly ToolSourceLang[] = [
  TOOL_SOURCE_FILES.ui.lang,
  TOOL_SOURCE_FILES.data.lang,
  TOOL_SOURCE_FILES.icon.lang,
]

/** The longest run of consecutive backticks anywhere in the code. */
function longestBacktickRun(code: string): number {
  let longest = 0
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return longest
}

/**
 * Wrap source code as the markdown note the store will accept.
 *
 * The fence is one backtick longer than the longest run in the code, so source
 * that itself contains a ```` ``` ```` fence (a Tool rendering markdown, a
 * template string of docs) survives the round trip instead of terminating its
 * own block. Trailing whitespace is dropped, which is the one thing
 * unwrapSource(wrapSource(code)) does not give back verbatim.
 */
export function wrapSource(code: string, lang: ToolSourceLang): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1))
  return (
    `---\n` +
    `type: ${SOURCE_TYPE}\n` +
    `lang: ${lang}\n` +
    `---\n\n` +
    `${fence}${lang}\n${code.trimEnd()}\n${fence}\n`
  )
}

/**
 * The inverse of {@link wrapSource}: the code inside the note's first fenced
 * block, or null when the note isn't a wrapped source at all.
 *
 * The frontmatter `lang:` is authoritative, not the fence's info string — the
 * frontmatter is what the compile pipeline and the write gate read, and a note
 * whose two disagreed would otherwise compile as whichever the reader happened
 * to trust. A closing fence is a line of backticks alone, at least as long as
 * the opening one, which is what lets inner fences through.
 */
export function unwrapSource(md: string): { code: string; lang: ToolSourceLang } | null {
  const fm = parseFrontmatter(md)
  if (trimmedString(fm.type).toLowerCase() !== SOURCE_TYPE) return null
  const lang = trimmedString(fm.lang).toLowerCase()
  if (!(SOURCE_LANGS as readonly string[]).includes(lang)) return null
  const { body } = splitFrontmatter(md)

  const lines = body.split('\n')
  const open = lines.findIndex((line) => /^`{3,}/.test(line))
  if (open === -1) return null
  const fence = /^`+/.exec(lines[open])?.[0] ?? ''
  const closeRe = new RegExp(`^\`{${fence.length},}[ \\t]*$`)
  for (let i = open + 1; i < lines.length; i++) {
    if (closeRe.test(lines[i])) {
      return { code: lines.slice(open + 1, i).join('\n'), lang: lang as ToolSourceLang }
    }
  }
  return null
}

// ── the config note ──────────────────────────────────────────────────────────

/**
 * Where a Tool may take over a node type's page. `page` replaces the type's
 * whole page (custom types only); `tab` adds one tab beside whatever is there.
 */
export interface ToolTypeSurface {
  type: string
  mode: 'page' | 'tab'
}

export interface ToolConfig {
  name: string
  title: string
  description: string
  /** Bumped by publish; 0 until a Tool has ever been published. */
  version: number
  surfaces: {
    /** A sidebar rail row and its own full-pane page, or null for neither. */
    rail: { label: string; icon: string } | null
    types: ToolTypeSurface[]
  }
  perimeter: ToolPerimeter
  /**
   * Marketplace tags from `tags:` — at most {@link TOOL_TAGS_MAX}, each
   * matching {@link TOOL_TAG_RE}, lower-cased and de-duplicated. Snapshotted
   * into the published version so a card can be filtered by them.
   */
  tags: string[]
  /**
   * `preview:` — an image of the Tool for its marketplace card: a same-origin
   * `/api/media/...` path (uploaded through the media route) or an `https://`
   * URL. Null when the author gave none.
   */
  previewUrl: string | null
}

/** How many `tags:` an index note may carry. */
export const TOOL_TAGS_MAX = 8

/** What one tag looks like: short, lower-case, hyphenated — a facet, not a sentence. */
const TOOL_TAG_RE = /^[a-z0-9-]{1,24}$/

/**
 * The built-in rail icons a Tool may choose from.
 *
 * A named set rather than free-form: the rail renders real icon components from
 * the app's own set (assets/icons, see docs/icons.md), and a marketplace Tool
 * naming an icon that doesn't exist would render a hole in the sidebar chrome it
 * is not allowed to touch. Small on purpose — enough shapes to say what a Tool
 * is, few enough that installs look like the rest of the app.
 *
 * These names are a published contract (a Tool's frontmatter refers to them),
 * so they are not the icon FILE names — features/tools/components/toolIcons.tsx
 * maps them onto the owned set. A Tool that wants a shape outside this list
 * ships its own: see {@link TOOL_CUSTOM_RAIL_ICON}.
 */
export const TOOL_RAIL_ICONS = [
  'grid',
  'kanban',
  'list',
  'table',
  'calendar',
  'chart',
  'note',
  'folder',
  'people',
  'sparkle',
] as const

const DEFAULT_RAIL_ICON: (typeof TOOL_RAIL_ICONS)[number] = 'grid'

/**
 * The rail icon that means "use my own": the Tool draws its glyph in
 * `icon.svg` instead of picking one of ours.
 *
 * Not a shape in TOOL_RAIL_ICONS because it isn't one — it is a pointer at
 * another file, and keeping it out of that list keeps "which built-in did you
 * pick" and "did you ship your own" two separate questions everywhere they are
 * asked. An author who names it without writing icon.svg gets a build error,
 * not a silent fallback, because a rail row is the one place a Tool's identity
 * shows before you click it.
 */
export const TOOL_CUSTOM_RAIL_ICON = 'custom'

/**
 * Node types a Tool may never own the page for.
 *
 * person/space/event/resource and friends have built-in pages that are the
 * product — a Tool replacing one could hide a member's profile or a space's
 * home. Those types accept `mode: tab` only. The list carries the entity kinds
 * plus `tool` and `index`, and entityKindOf covers the synonyms data still
 * holds ('space', 'org', 'people'), so `type: space` can't sneak a page
 * past under an old spelling.
 */
const BUILT_IN_TYPES = new Set([
  'person',
  'space',
  'event',
  'resource',
  'section',
  'channel',
  'connector',
  'agent',
  'tool',
  'index',
])

function isBuiltInType(type: string): boolean {
  return BUILT_IN_TYPES.has(type) || entityKindOf(type) !== null
}

export type ParseToolConfigResult = { ok: true; config: ToolConfig } | { ok: false; error: string }

/**
 * `tags:` → a clean list. A single string is accepted as one tag (`tags: crm`
 * is what people write). Lower-cased because tags are facets, and a facet
 * spelled two ways is two facets to a filter.
 */
export function parseToolTags(raw: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, tags: [] }
  const list = Array.isArray(raw) ? raw : [raw]
  const tags: string[] = []
  for (const entry of list) {
    if (typeof entry !== 'string') {
      return { ok: false, error: `Bad \`tags\` entry ${JSON.stringify(entry)} — tags are strings` }
    }
    const tag = entry.trim().toLowerCase()
    if (!TOOL_TAG_RE.test(tag)) {
      return {
        ok: false,
        error: `Bad tag ${JSON.stringify(entry)} — use 1-24 lower-case letters, digits and hyphens`,
      }
    }
    if (!tags.includes(tag)) tags.push(tag)
  }
  if (tags.length > TOOL_TAGS_MAX) {
    return { ok: false, error: `Too many \`tags\` — ${TOOL_TAGS_MAX} at most` }
  }
  return { ok: true, tags }
}

/**
 * `preview:` → a URL the marketplace may put in an <img>. One shape only: a
 * same-origin media path (`/api/media/...`, which is where the upload route
 * puts things). An absolute URL of any scheme is refused too — the card is
 * rendered to every marketplace visitor, so a third-party host would learn each
 * viewer's IP the moment they browsed. `data:`, `javascript:`, a bare filename:
 * refused rather than rendered.
 */
export function parseToolPreviewUrl(
  raw: unknown,
): { ok: true; previewUrl: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, previewUrl: null }
  if (typeof raw !== 'string') return { ok: false, error: '`preview` must be a URL string' }
  const value = raw.trim()
  if (value.length > 2048) return { ok: false, error: '`preview` URL is too long (2048 max)' }
  if (/^\/api\/media\/[^\s?#]+(\?[^\s#]*)?$/.test(value)) return { ok: true, previewUrl: value }
  return {
    ok: false,
    error: '`preview` must be a same-origin /api/media/... path (upload the image first); external URLs are not allowed',
  }
}

function trimmedString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function parseVersion(raw: unknown): { ok: true; version: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, version: 0 }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 0) return { ok: false, error: '`version` must be an integer of 0 or more' }
  return { ok: true, version: n }
}

function parseRail(
  raw: unknown,
  fallbackLabel: string,
): { ok: true; rail: { label: string; icon: string } | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === false) return { ok: true, rail: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`surfaces.rail` must be a map with a label and an icon' }
  }
  const rail = raw as Record<string, unknown>
  if (rail.label !== undefined && rail.label !== null && typeof rail.label !== 'string') {
    return { ok: false, error: '`surfaces.rail.label` must be a string' }
  }
  const label = trimmedString(rail.label) || fallbackLabel
  const icon = trimmedString(rail.icon).toLowerCase() || DEFAULT_RAIL_ICON
  if (icon !== TOOL_CUSTOM_RAIL_ICON && !(TOOL_RAIL_ICONS as readonly string[]).includes(icon)) {
    return {
      ok: false,
      error:
        `Unknown \`surfaces.rail.icon\` ${JSON.stringify(rail.icon)} — pick one of ` +
        `${TOOL_RAIL_ICONS.join(', ')}, or \`${TOOL_CUSTOM_RAIL_ICON}\` to use your own ${TOOL_SOURCE_FILES.icon.authorName}`,
    }
  }
  return { ok: true, rail: { label, icon } }
}

/**
 * `surfaces.types` → claims. An entry is either `{ type, mode }` or a bare type
 * name, which means `mode: tab` — the reading that can never take a page away
 * from something that already had one.
 */
function parseTypeSurfaces(
  raw: unknown,
): { ok: true; types: ToolTypeSurface[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, types: [] }
  if (!Array.isArray(raw)) {
    return { ok: false, error: '`surfaces.types` must be a list of type claims' }
  }
  const types: ToolTypeSurface[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    let type = ''
    let mode = 'tab'
    if (typeof entry === 'string') {
      type = entry.trim().toLowerCase()
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const claim = entry as Record<string, unknown>
      type = trimmedString(claim.type).toLowerCase()
      if (claim.mode !== undefined && claim.mode !== null) mode = trimmedString(claim.mode).toLowerCase()
    }
    if (!type) {
      return {
        ok: false,
        error: `Bad \`surfaces.types\` entry ${JSON.stringify(entry)} — use a type name or { type: deal, mode: page }`,
      }
    }
    if (mode !== 'page' && mode !== 'tab') {
      return { ok: false, error: `\`surfaces.types\` mode for "${type}" must be page or tab` }
    }
    if (seen.has(type)) return { ok: false, error: `\`surfaces.types\` claims "${type}" twice` }
    seen.add(type)
    if (mode === 'page' && isBuiltInType(type)) {
      return {
        ok: false,
        error:
          `A tool may not claim \`mode: page\` for the built-in type "${type}" — ` +
          'built-in pages stay built in; use `mode: tab` to add a tab beside one',
      }
    }
    types.push({ type, mode })
  }
  return { ok: true, types }
}

/**
 * A Tool's frontmatter → validated config. Never throws; every error is written
 * for whoever is holding the note — an author over MCP, or an admin reading why
 * an install won't run.
 */
export function parseToolConfig(fm: NoteFrontmatter, name: string): ParseToolConfigResult {
  if (!TOOL_NAME_RE.test(name)) {
    return {
      ok: false,
      error: `"${name}" is not a valid tool name — use lower-case letters, digits and hyphens (63 max)`,
    }
  }
  if (trimmedString(fm.type).toLowerCase() !== TOOL_TYPE) {
    return { ok: false, error: 'tool frontmatter must include `type: tool`' }
  }

  const version = parseVersion(fm.version)
  if (!version.ok) return version

  const title = trimmedString(fm.title) || name
  const description = trimmedString(fm.description)

  let rail: { label: string; icon: string } | null = null
  let types: ToolTypeSurface[] = []
  if (fm.surfaces !== undefined && fm.surfaces !== null) {
    if (typeof fm.surfaces !== 'object' || Array.isArray(fm.surfaces)) {
      return { ok: false, error: '`surfaces` must be a map with `rail` and `types`' }
    }
    const surfaces = fm.surfaces as Record<string, unknown>
    const parsedRail = parseRail(surfaces.rail, title)
    if (!parsedRail.ok) return parsedRail
    const parsedTypes = parseTypeSurfaces(surfaces.types)
    if (!parsedTypes.ok) return parsedTypes
    rail = parsedRail.rail
    types = parsedTypes.types
  }

  const perimeter = parseToolPerimeter(fm.perimeter)
  if (!perimeter.ok) return { ok: false, error: perimeter.error }

  const tags = parseToolTags(fm.tags)
  if (!tags.ok) return tags
  const preview = parseToolPreviewUrl(fm.preview)
  if (!preview.ok) return preview

  return {
    ok: true,
    config: {
      name,
      title,
      description,
      version: version.version,
      surfaces: { rail, types },
      perimeter: perimeter.perimeter,
      tags: tags.tags,
      previewUrl: preview.previewUrl,
    },
  }
}

/**
 * The starting index note for a new Tool.
 *
 * Lives beside {@link parseToolConfig} because the point is that it round-trips:
 * whatever this writes must parse. The perimeter and surfaces are scaffolding —
 * every key present and empty — so an authoring agent editing the note is
 * filling blanks in rather than guessing the shape, and a Tool that has declared
 * nothing yet reaches nothing rather than defaulting open.
 */
export function newToolIndexNote(input: {
  name: string
  title?: string
  description?: string
  /** A sidebar row label — set, the scaffold gets a rail row with the default icon. */
  railLabel?: string
}): string {
  const title = trimmedString(input.title) || input.name
  const description = trimmedString(input.description)
  const railLabel = trimmedString(input.railLabel)
  const front = [
    `type: ${TOOL_TYPE}`,
    `title: ${JSON.stringify(title)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    `version: 0`,
    `surfaces:`,
    railLabel
      ? `  rail: { label: ${JSON.stringify(railLabel)}, icon: ${DEFAULT_RAIL_ICON} }`
      : `  rail: null`,
    `  types: []`,
    `perimeter:`,
    `  read: []`,
    `  write: []`,
    `  types: []`,
    `  connectors: []`,
    `  agents: []`,
  ]
  const body = [
    `# ${title}`,
    ``,
    description || `${title} is a tool in this space.`,
    ``,
    `## How it works`,
    ``,
    `The interface lives in ${TOOL_SOURCE_FILES.ui.authorName} beside this note and renders in the`,
    `main content area only. Data logic lives in ${TOOL_SOURCE_FILES.data.authorName}, which runs`,
    `server-side and reads space data through the bridge.`,
    ``,
    `Nothing is reachable until it is declared: add note globs to \`perimeter.read\``,
    `and \`perimeter.write\`, node types to \`perimeter.types\`, and connector or agent`,
    `names to the lists beside them. A reader can see the whole reach of this tool`,
    `in that block, and the bridge refuses anything it does not name.`,
  ]
  return `---\n${front.join('\n')}\n---\n\n${body.join('\n')}\n`
}
