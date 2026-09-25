/**
 * A Tool's sources → its build: the compile, the config, the icon and every
 * diagnostic, in one pure step (esbuild aside) that nothing is saved by.
 *
 * `rebuildTool` (./builds.ts) reads a working copy's notes and stores what
 * this returns; `check_package` and `push_tool` (./package) build a package
 * with it before anything is written; `visvine-tool check` builds a folder of
 * work on the author's own machine with it — so all three answer the same
 * errors for the same sources.
 */
import { compileToolData, compileToolUi, type CompileDiagnostic, type CompileResult } from './compile'
import {
  TOOL_CUSTOM_RAIL_ICON,
  TOOL_SOURCE_FILES,
  manifestOf,
  parseToolConfig,
  toolModuleFileOf,
  toolDataPath,
  toolIconPath,
  toolIndexPath,
  toolUiPath,
  unwrapSource,
  type ToolConfig,
} from './config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { sanitizeToolIcon } from './iconSvg'

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
  /** `icon.md`, when the author shipped their own rail glyph. */
  icon: string | null
  /** The module notes under `src/`, by their path relative to the folder (`src/chart.md`). */
  modules?: Record<string, string>
  /** Where they were read from. Not part of the source hash. */
  folder?: string
}

/** What a build is, before anything stores it. */
export interface BuiltTool {
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

/** The two compiles, injectable so a test can build without esbuild. */
export interface ToolCompilers {
  compileUi(
    source: string,
    opts?: { modules?: Readonly<Record<string, string>>; dependencies?: readonly string[] },
  ): Promise<CompileResult>
  compileData(source: string): Promise<CompileResult>
}

const REAL_COMPILERS: ToolCompilers = { compileUi: compileToolUi, compileData: compileToolData }

function diagnosticsOf(result: CompileResult, file: string): BuildDiagnostic[] {
  const messages = result.ok ? [] : result.errors
  return messages.map((d) => ({ ...d, file: d.file ?? file }))
}

function warningsOf(result: CompileResult, file: string): BuildDiagnostic[] {
  return result.warnings.map((d) => ({ ...d, file: d.file ?? file }))
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
 * Build a Tool from its sources — the notes as a working copy keeps them
 * (index composed with its facts, each source wrapped in its fenced note).
 */
export async function buildFromSources(
  name: string,
  sources: ToolSources,
  compilers: ToolCompilers = REAL_COMPILERS,
): Promise<BuiltTool> {
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

  // src/ — the Tool's own modules, unwrapped and handed to the ui compile.
  const modules: Record<string, string> = {}
  for (const [relative, note] of Object.entries(sources.modules ?? {})) {
    const unwrapped = unwrapSource(note)
    const file = unwrapped ? toolModuleFileOf(relative, unwrapped.lang) : null
    if (!unwrapped || !file) {
      errors.push({
        file: relative.replace(/\.md$/, '.tsx'),
        message: `${relative} is not a module — a module is src/<name>.tsx or .ts, written through the tool service`,
        line: null,
        column: null,
        text: null,
      })
      continue
    }
    modules[file] = unwrapped.code
  }

  // ui.tsx — required: the runtime mounts its default export.
  let uiBundle: string | null = null
  let sizeBytes = 0
  const ui = TOOL_SOURCE_FILES.ui
  if (sources.ui === null) {
    errors.push(missingSource(ui.authorName, toolUiPath(name, sources.folder)))
  } else {
    const unwrapped = unwrapSource(sources.ui)
    if (!unwrapped || unwrapped.lang !== ui.lang) {
      errors.push(unreadableSource(ui.authorName, toolUiPath(name, sources.folder)))
    } else {
      const result = await compilers.compileUi(unwrapped.code, {
        modules,
        dependencies: config ? Object.keys(manifestOf(config).dependencies) : [],
      })
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
      errors.push(unreadableSource(data.authorName, toolDataPath(name, sources.folder)))
    } else {
      const result = await compilers.compileData(unwrapped.code)
      errors.push(...diagnosticsOf(result, data.authorName))
      warnings.push(...warningsOf(result, data.authorName))
      if (result.ok) {
        dataBundle = result.bundle
        sizeBytes += result.sizeBytes
      }
    }
  }

  // icon.svg — optional, and not code. Sanitizing here rather than at render
  // time is what makes the stored value the trusted one: nothing downstream
  // (the rail, the marketplace card, the review queue) re-parses author markup,
  // it renders what this step approved. See lib/tools/iconSvg.ts.
  let iconSvg: string | null = null
  const iconFile = TOOL_SOURCE_FILES.icon
  if (sources.icon !== null) {
    const unwrapped = unwrapSource(sources.icon)
    if (!unwrapped || unwrapped.lang !== iconFile.lang) {
      errors.push(unreadableSource(iconFile.authorName, toolIconPath(name, sources.folder)))
    } else {
      const result = sanitizeToolIcon(unwrapped.code)
      if (result.ok) iconSvg = result.svg
      else {
        errors.push({
          file: iconFile.authorName,
          message: result.error,
          line: null,
          column: null,
          text: null,
        })
      }
    }
  }

  // Naming `custom` without shipping the glyph would leave a hole in the rail,
  // which is chrome a Tool is not allowed to touch — so it is an error the
  // author sees, not a silent fallback to a shape they did not pick.
  if (config?.surfaces.rail?.icon === TOOL_CUSTOM_RAIL_ICON && iconSvg === null) {
    errors.push({
      file: INDEX_FILENAME,
      message:
        `\`surfaces.rail.icon: ${TOOL_CUSTOM_RAIL_ICON}\` needs an ${iconFile.authorName} — ` +
        `upload one, or pick a built-in icon instead.`,
      line: null,
      column: null,
      text: null,
    })
  }

  const ok = configError === null && uiBundle !== null && errors.length === 0
  return {
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
    iconSvg: ok ? iconSvg : null,
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
