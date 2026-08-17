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
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import {
  compileToolData,
  compileToolUi,
  sourceHash,
  type CompileDiagnostic,
  type CompileResult,
} from './compile'
import {
  TOOL_SOURCE_FILES,
  parseToolConfig,
  toolDataPath,
  toolIndexPath,
  toolUiPath,
  unwrapSource,
  type ToolConfig,
} from './config'

/** Matches store.ts's SHARED_OWNER_KEY. Tools only ever live in shared context. */
const SHARED_OWNER_KEY = 'shared'

/** The author-facing name of the index note, for diagnostics. */
const INDEX_FILENAME = 'index.md'

/**
 * A compile diagnostic with the file it came from. `CompileDiagnostic` alone
 * carries a line and a column but not a name — the compiler is handed one
 * source at a time — and a build holds diagnostics from two files at once, so
 * the file is stamped on as they are collected (see {@link toolDiagnosticLine}).
 */
export interface BuildDiagnostic extends CompileDiagnostic {
  /** The author-facing filename: `index.md`, `ui.tsx` or `data.js`. */
  file: string
}

/** The three notes a Tool is made of; null for one that doesn't exist. */
export interface ToolSources {
  index: string | null
  ui: string | null
  data: string | null
}

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
}

/** The read / compile / persist steps, injectable for tests. */
export interface ToolBuildDeps {
  readSource(spaceId: string, path: string): Promise<string | null>
  compileUi(source: string): Promise<CompileResult>
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
 * The identity of a Tool's three sources.
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

/** Read the three notes that make up a Tool. */
export async function readToolSources(
  spaceId: string,
  name: string,
  deps: ToolBuildDeps = liveDeps,
): Promise<ToolSources> {
  const [index, ui, data] = await Promise.all([
    deps.readSource(spaceId, toolIndexPath(name)),
    deps.readSource(spaceId, toolUiPath(name)),
    deps.readSource(spaceId, toolDataPath(name)),
  ])
  return { index, ui, data }
}

// ── the rebuild ───────────────────────────────────────────────────────────────

function diagnosticsOf(result: CompileResult, file: string): BuildDiagnostic[] {
  const messages = result.ok ? [] : result.errors
  return messages.map((d) => ({ ...d, file }))
}

function warningsOf(result: CompileResult, file: string): BuildDiagnostic[] {
  return result.warnings.map((d) => ({ ...d, file }))
}

function missingSource(file: string, path: string): BuildDiagnostic {
  return {
    file,
    message: `${file} is missing — write it at ${path}`,
    line: null,
    column: null,
    text: null,
  }
}

function unreadableSource(file: string, path: string): BuildDiagnostic {
  return {
    file,
    message:
      `${path} is not a ${file} source note — its body must be one fenced code block ` +
      'under `type: tool-source`. Write it through the tool service rather than by hand.',
    line: null,
    column: null,
    text: null,
  }
}

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

  const errors: BuildDiagnostic[] = []
  const warnings: BuildDiagnostic[] = []

  // The config. A Tool with no index note is not a Tool — but it still gets a
  // row, because that row is where the author reads why nothing runs.
  let config: ToolConfig | null = null
  let configError: string | null = null
  if (sources.index === null) {
    configError = `${toolIndexPath(name)} does not exist — a tool is its index note beside its sources`
  } else {
    const parsed = parseToolConfig(parseFrontmatter(sources.index), name)
    if (parsed.ok) config = parsed.config
    else configError = parsed.error
  }

  // ui.tsx — required: the runtime mounts its default export.
  let uiBundle: string | null = null
  let sizeBytes = 0
  const ui = TOOL_SOURCE_FILES.ui
  if (sources.ui === null) {
    errors.push(missingSource(ui.authorName, toolUiPath(name)))
  } else {
    const unwrapped = unwrapSource(sources.ui)
    if (!unwrapped || unwrapped.lang !== ui.lang) {
      errors.push(unreadableSource(ui.authorName, toolUiPath(name)))
    } else {
      const result = await deps.compileUi(unwrapped.code)
      errors.push(...diagnosticsOf(result, ui.authorName))
      warnings.push(...warningsOf(result, ui.authorName))
      if (result.ok) {
        uiBundle = result.bundle
        sizeBytes += result.sizeBytes
      }
    }
  }

  // data.js — optional, but a broken one is still broken. A Tool that reads
  // nothing but its own props is a legitimate Tool; a Tool whose data layer
  // does not parse is not.
  let dataBundle: string | null = null
  const data = TOOL_SOURCE_FILES.data
  if (sources.data !== null) {
    const unwrapped = unwrapSource(sources.data)
    if (!unwrapped || unwrapped.lang !== data.lang) {
      errors.push(unreadableSource(data.authorName, toolDataPath(name)))
    } else {
      const result = await deps.compileData(unwrapped.code)
      errors.push(...diagnosticsOf(result, data.authorName))
      warnings.push(...warningsOf(result, data.authorName))
      if (result.ok) {
        dataBundle = result.bundle
        sizeBytes += result.sizeBytes
      }
    }
  }

  const ok = configError === null && uiBundle !== null && errors.length === 0
  return deps.saveBuild({
    spaceId,
    name,
    sourceHash: hash,
    ok,
    // A failed build keeps no bundle: whatever is stored is what the runtime
    // may serve, so half a Tool must never be servable.
    uiBundle: ok ? uiBundle : null,
    dataBundle: ok ? dataBundle : null,
    errors,
    warnings,
    sizeBytes,
    config,
    configError,
  })
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
      file: typeof d.file === 'string' ? d.file : INDEX_FILENAME,
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
  }
}

/**
 * One diagnostic as an editor-shaped line: `ui.tsx:12:5 message`, or
 * `ui.tsx message` when the compiler had no location to give (a size cap, a
 * missing default export). esbuild's line is 1-based and its column 0-based;
 * both are passed through as they are, so the numbers mean what an editor
 * jumping to them would mean.
 */
export function toolDiagnosticLine(d: BuildDiagnostic): string {
  const at = d.line === null ? '' : `:${d.line}:${d.column ?? 0}`
  return `${d.file}${at} ${d.message}`
}
