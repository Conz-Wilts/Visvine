/**
 * A space's compiled working copy of one Tool — the `app_tool_builds` row.
 *
 * The notes are the source of truth and the row is an index that can always be
 * rebuilt from them, exactly as `agent_state` is derived from an agent's notes
 * (lib/agents/hooks.ts). Every write to `tools/<name>/…` re-derives it through
 * lib/tools/hooks.ts, so a build is never stale and a compile error reaches the
 * author on the write that caused it rather than at render time.
 *
 * Three shapes worth knowing:
 *
 *  • **The hash decides whether to compile.** `sourceHash` covers all three
 *    sources; an unchanged hash returns the stored row untouched, which is what
 *    makes it safe to call this from a store hook that fires on every save
 *    (including the no-op saves the store deliberately lets through).
 *  • **`ok` is narrow.** The config must parse and `ui.tsx` must compile;
 *    `data.js` is optional, but a present one that fails takes the build down
 *    with it. A Tool that half-compiles is not runnable, so it does not claim
 *    to be.
 *  • **Nothing throws for a bad Tool.** A broken config, an unwrapped source, a
 *    syntax error — all of it lands in the row as diagnostics, because the
 *    caller is a member's note write and a paste with a typo in it is not a 500.
 *
 * The DB and the note store are reached through {@link ToolBuildDeps}, whose
 * live implementation imports them dynamically. Two reasons: the store imports
 * lib/tools/hooks.ts, which imports this module, so nothing here may pull the
 * store in at eval time; and the read/compile/persist steps are then injectable,
 * which is how tools-builds.test.ts exercises the orchestration with no DB.
 */
import type { Prisma, AppToolBuild } from '@prisma/client'
import { composeToolIndex } from './indexFacts'
import { compileToolData, compileToolUi, sourceHash, type CompileResult } from './compile'
import {
  MAX_TOOL_MODULES,
  TOOL_MODULE_DIR,
  toolDataPath,
  toolFolderPath,
  toolIconPath,
  toolIndexPath,
  toolUiPath,
  type ToolConfig,
} from './config'
import { buildFromSources, type BuildDiagnostic, type ToolSources } from './buildSources'

export type { BuildDiagnostic, ToolSources } from './buildSources'
export { toolDiagnosticLine } from './buildSources'

/** Matches store.ts's SHARED_OWNER_KEY. Tools only ever live in shared context. */
const SHARED_OWNER_KEY = 'shared'




/** What a rebuild persists. The row's own keys, minus the generated ones. */
export interface ToolBuildInput {
  spaceId: string
  name: string
  sourceHash: string
  ok: boolean
  uiBundle: string | null
  dataBundle: string | null
  errors: BuildDiagnostic[]
  warnings: BuildDiagnostic[]
  sizeBytes: number
  config: ToolConfig | null
  configError: string | null
  /** The author's own rail glyph, already sanitized. Null = uses a built-in. */
  iconSvg: string | null
}

/** The read / compile / persist steps, injectable for tests. */
export interface ToolBuildDeps {
  readSource(spaceId: string, path: string): Promise<string | null>
  /** Every note directly under `<folder>/src/`, by its full path. Absent: a Tool has no modules. */
  listModules?(spaceId: string, folder: string): Promise<Array<{ path: string; content: string }>>
  /** The Tool's facts row (toolFacts.ts); absent reads the index note alone. */
  readFacts?(spaceId: string, name: string): Promise<Record<string, unknown> | null>
  /** Where the Tool's folder is — `tools/<name>` unless the space filed it elsewhere. Absent: `tools/<name>`. */
  toolFolder?(spaceId: string, name: string): Promise<string>
  compileUi(
    source: string,
    opts?: { modules?: Readonly<Record<string, string>>; dependencies?: readonly string[] },
  ): Promise<CompileResult>
  compileData(source: string): Promise<CompileResult>
  loadBuild(spaceId: string, name: string): Promise<AppToolBuild | null>
  saveBuild(input: ToolBuildInput): Promise<AppToolBuild>
}

/**
 * What a surface needs to say how a Tool is doing: does it run, what went
 * wrong, how big is it, and what did the author declare. Decoded off the row's
 * JSON columns so callers never handle `Prisma.JsonValue`.
 */
export interface BuildSummary {
  ok: boolean
  errors: BuildDiagnostic[]
  warnings: BuildDiagnostic[]
  sizeBytes: number
  config: ToolConfig | null
  configError: string | null
  updatedAt: string
  /** Which sources this build was compiled from — what a check report is stamped with. */
  sourceHash: string
  /**
   * The author's own rail glyph, sanitized. Null = the Tool uses a built-in
   * shape. Carried on the summary so the author's roster can SHOW the icon it
   * would publish with, which is the only way to tell a rejected upload from an
   * accepted one at a glance.
   */
  iconSvg: string | null
}

// ── live dependencies ─────────────────────────────────────────────────────────

/**
 * The real steps. Every import is dynamic: this module is reached from the note
 * store (store → lib/tools/hooks → here), so a static `@/lib/notes/store` would
 * close an eval-time cycle. The module cache makes the repeat cost nothing.
 */
const liveDeps: ToolBuildDeps = {
  async readSource(spaceId, path) {
    const store = await import('@/lib/notes/store')
    return store.readNoteOrNull({ spaceId, ownerKey: SHARED_OWNER_KEY }, path)
  },
  async toolFolder(spaceId, name) {
    const { toolFolderIn } = await import('./location')
    return toolFolderIn(spaceId, name)
  },
  async listModules(spaceId, folder) {
    const { default: prisma } = await import('@/lib/prisma')
    const prefix = `${folder}/${TOOL_MODULE_DIR}/`
    const rows = await prisma.contextNote.findMany({
      where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: prefix, endsWith: '.md' } },
      select: { path: true, content: true },
      orderBy: { path: 'asc' },
      take: MAX_TOOL_MODULES + 8,
    })
    return rows.filter((row) => !row.path.slice(prefix.length).includes('/') && !row.path.endsWith('/index.md'))
  },
  async readFacts(spaceId, name) {
    const { readToolFacts } = await import('./toolFacts')
    return readToolFacts(spaceId, name)
  },
  compileUi: compileToolUi,
  compileData: compileToolData,
  async loadBuild(spaceId, name) {
    const { default: prisma } = await import('@/lib/prisma')
    return prisma.appToolBuild.findUnique({ where: { app_tool_build_identity: { spaceId, name } } })
  },
  async saveBuild(input) {
    const { default: prisma } = await import('@/lib/prisma')
    const data = {
      sourceHash: input.sourceHash,
      ok: input.ok,
      uiBundle: input.uiBundle,
      dataBundle: input.dataBundle,
      errors: input.errors as unknown as Prisma.InputJsonValue,
      warnings: input.warnings as unknown as Prisma.InputJsonValue,
      sizeBytes: input.sizeBytes,
      config: (input.config ?? null) as unknown as Prisma.InputJsonValue,
      configError: input.configError,
      iconSvg: input.iconSvg,
    }
    return prisma.appToolBuild.upsert({
      where: { app_tool_build_identity: { spaceId: input.spaceId, name: input.name } },
      create: { spaceId: input.spaceId, name: input.name, ...data },
      update: data,
    })
  },
}

// ── source identity ───────────────────────────────────────────────────────────

/**
 * The identity of a Tool's sources.
 *
 * Each source is preceded by a presence marker so a missing note and an empty
 * one hash differently — deleting `data.js` and blanking it are different acts,
 * and the second must not be mistaken for a no-op.
 */
export function toolSourceHash(sources: ToolSources): string {
  return sourceHash([
    sources.index === null ? '-' : '+',
    sources.index ?? '',
    sources.ui === null ? '-' : '+',
    sources.ui ?? '',
    sources.data === null ? '-' : '+',
    sources.data ?? '',
    sources.icon === null ? '-' : '+',
    sources.icon ?? '',
    ...Object.entries(sources.modules ?? {})
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([path, content]) => [path, content]),
  ])
}

/**
 * Whether the stored build is still the one these sources would produce — the
 * compile-skip decision, kept pure so it is testable on its own.
 *
 * A build whose row is missing is never current, and a row whose hash matches
 * always is: the hash covers every input the compile reads, so re-running it
 * could only produce the same bytes.
 */
export function buildIsCurrent(existing: { sourceHash: string } | null, hash: string): boolean {
  return existing !== null && existing.sourceHash === hash
}

/** Read the notes that make up a Tool. Only `index` and `ui` are required. */
export async function readToolSources(
  spaceId: string,
  name: string,
  deps: ToolBuildDeps = liveDeps,
): Promise<ToolSources> {
  const folder = deps.toolFolder ? await deps.toolFolder(spaceId, name) : toolFolderPath(name)
  const [note, ui, data, icon, facts, moduleRows] = await Promise.all([
    deps.readSource(spaceId, toolIndexPath(name, folder)),
    deps.readSource(spaceId, toolUiPath(name, folder)),
    deps.readSource(spaceId, toolDataPath(name, folder)),
    deps.readSource(spaceId, toolIconPath(name, folder)),
    deps.readFacts ? deps.readFacts(spaceId, name) : Promise.resolve(null),
    deps.listModules ? deps.listModules(spaceId, folder) : Promise.resolve([]),
  ])
  // The index as every reader parses it: the note with the facts row rendered
  // into its frontmatter — so the hash, the config and publish all cover both.
  const index = note === null ? null : composeToolIndex(note, facts)
  const modules = Object.fromEntries(moduleRows.map((row) => [row.path.slice(folder.length + 1), row.content]))
  return { index, ui, data, icon, folder, ...(moduleRows.length ? { modules } : {}) }
}

// ── the rebuild ───────────────────────────────────────────────────────────────

/**
 * Re-derive one Tool's build from its notes, and store it.
 *
 * Returns the stored row unchanged when the sources hash to what it was
 * compiled from — the common case, since the store fires its hooks on every
 * save including ones that changed nothing.
 */
export async function rebuildTool(
  spaceId: string,
  name: string,
  deps: ToolBuildDeps = liveDeps,
): Promise<AppToolBuild> {
  const sources = await readToolSources(spaceId, name, deps)
  const hash = toolSourceHash(sources)
  const existing = await deps.loadBuild(spaceId, name)
  if (existing && buildIsCurrent(existing, hash)) return existing

  return deps.saveBuild({ spaceId, name, sourceHash: hash, ...(await buildFromSources(name, sources, deps)) })
}

/** The stored build for one Tool, or null when it has never compiled. */
export async function getBuild(spaceId: string, name: string): Promise<AppToolBuild | null> {
  const { default: prisma } = await import('@/lib/prisma')
  return prisma.appToolBuild.findUnique({ where: { app_tool_build_identity: { spaceId, name } } })
}

/** Every stored build in a space, by tool name — one query for a roster. */
export async function listBuilds(spaceId: string): Promise<Map<string, AppToolBuild>> {
  const { default: prisma } = await import('@/lib/prisma')
  const rows = await prisma.appToolBuild.findMany({ where: { spaceId } })
  return new Map(rows.map((row) => [row.name, row]))
}

/** Drop a Tool's build. Idempotent — a Tool that never compiled has no row. */
export async function deleteBuild(spaceId: string, name: string): Promise<void> {
  const { default: prisma } = await import('@/lib/prisma')
  await prisma.appToolBuild.deleteMany({ where: { spaceId, name } })
}

// ── reading a row back ────────────────────────────────────────────────────────

/**
 * Decode a diagnostics JSON column. Defensive rather than trusting: the column
 * is written by this module, but a row from an older shape (or a hand-edited
 * one) must degrade to fewer diagnostics instead of crashing a page that only
 * wanted to say "3 errors".
 */
function asDiagnostics(value: unknown): BuildDiagnostic[] {
  if (!Array.isArray(value)) return []
  const out: BuildDiagnostic[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const d = entry as Record<string, unknown>
    if (typeof d.message !== 'string') continue
    out.push({
      file: typeof d.file === 'string' ? d.file : 'index.md',
      message: d.message,
      line: typeof d.line === 'number' ? d.line : null,
      column: typeof d.column === 'number' ? d.column : null,
      text: typeof d.text === 'string' ? d.text : null,
    })
  }
  return out
}

/** The row a surface can render: JSON columns decoded, dates serialized. */
export function toBuildSummary(row: AppToolBuild): BuildSummary {
  return {
    ok: row.ok,
    errors: asDiagnostics(row.errors),
    warnings: asDiagnostics(row.warnings),
    sizeBytes: row.sizeBytes,
    config: (row.config as unknown as ToolConfig | null) ?? null,
    configError: row.configError,
    updatedAt: row.updatedAt.toISOString(),
    sourceHash: row.sourceHash,
    iconSvg: row.iconSvg,
  }
}
