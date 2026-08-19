/**
 * Compiling a Tool's source, server-side, on write.
 *
 * A Tool ships two sources and they compile under different rules:
 *
 *   ui.tsx   TSX bundled to one ESM module for the sandboxed frame. React and
 *            the Visvine UI kit stay bare imports (EXTERNALS) — the frame
 *            document resolves them through an import map to vendor ESM the
 *            server builds once, so a Tool bundle never carries its own copy of
 *            React and every Tool shares one instance.
 *   data.js  a plain script for the QuickJS isolate, which has no module
 *            loader. Nothing is bundled here; the source is only parse-checked
 *            and lowered, and module syntax is refused outright.
 *
 * Two rules make this a boundary rather than a build step:
 *
 *   • Nothing but EXTERNALS may be imported. `import 'lodash'` has no bundle to
 *     resolve from, `import './x'` would reach into the server's filesystem,
 *     and `import 'https://…'` is exfiltration wearing a module's clothes. The
 *     onResolve guard below refuses all three by refusing everything else. A
 *     dynamic `import(expr)` with a non-literal `expr` never reaches that
 *     guard — esbuild can't resolve what it can't read statically — so it is
 *     refused separately, by scanning the source for the shape.
 *   • Every failure comes back as a diagnostic, never as a throw. Compiling is
 *     driven by an author's note write, so a bad paste must answer with line
 *     and column, not a 500.
 *
 * Size and time are capped because this runs inside a request that a member can
 * trigger at will. The caps are diagnostics too — an oversized Tool is the
 * author's problem to see, not an exception to swallow.
 */
import { createHash } from 'node:crypto'
import { build, type Message, type Metafile, type Plugin } from 'esbuild'

/**
 * Ceilings for one compile. `maxBundleBytes` is the larger of the two because
 * JSX expands: every `<a/>` becomes a `jsx("a", {})` call carrying a purity
 * annotation, so a bundle running two to five times its source is ordinary
 * rather than suspicious.
 */
export const TOOL_BUNDLE_LIMITS = {
  maxSourceBytes: 512_000,
  maxBundleBytes: 1_000_000,
  timeoutMs: 10_000,
} as const

/**
 * The only import specifiers a Tool may name. Left as bare ESM imports in the
 * bundle — the import map in the frame document is what points them at real
 * files, which is also why this list is the contract and not a convenience:
 * anything not mapped there would fail to load in the browser anyway.
 */
export const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom/client',
  '@visvine/tool-kit',
] as const

//  (the legacy root API) is deliberately NOT here. The frame's
// import map (lib/tools/frameDocument.ts) only serves , so
// allowing the bare specifier would compile cleanly and then fail to resolve
// at runtime — the worst kind of error for an author. Refusing it here gives
// them the rule and the fix in one line. Pinned by tests/tools-compile.test.ts.

const ALLOWED_IMPORTS: ReadonlySet<string> = new Set(EXTERNALS)

/** Named in every refusal, so the author learns the whole rule from one error. */
const IMPORT_RULE =
  'Only react, react/jsx-runtime, react-dom/client and @visvine/tool-kit may be imported (use react-dom/client, not react-dom)'

const UI_FILENAME = 'ui.tsx'
const DATA_FILENAME = 'data.js'

/**
 * One compile error or warning. `line` is 1-based and `column` 0-based —
 * esbuild's own convention, kept as-is so a diagnostic can be handed straight
 * to an editor. `text` is the offending source line, which is what makes the
 * message readable in a note-write response with no file to open.
 */
export interface CompileDiagnostic {
  message: string
  line: number | null
  column: number | null
  text: string | null
}

export type CompileResult =
  | { ok: true; bundle: string; sizeBytes: number; warnings: CompileDiagnostic[] }
  | { ok: false; errors: CompileDiagnostic[]; warnings: CompileDiagnostic[] }

// ── diagnostics ───────────────────────────────────────────────────────────────

function diagnostic(message: string, location?: Message['location']): CompileDiagnostic {
  return {
    message,
    line: location?.line ?? null,
    column: location?.column ?? null,
    text: location?.lineText ?? null,
  }
}

/**
 * esbuild's notes carry the half of the explanation that isn't in `text` — for a
 * JSX mistake, which tag went unclosed and where. Folded into the message
 * because a diagnostic has one line to be useful in.
 */
function fromMessage(m: Message): CompileDiagnostic {
  const notes = m.notes.map((n) => n.text).filter(Boolean)
  const message = notes.length > 0 ? `${m.text} (${notes.join(' ')})` : m.text
  return diagnostic(message, m.location)
}

/**
 * A failed build rejects with a BuildFailure carrying `errors`/`warnings`. Any
 * other throw — a timeout here, or esbuild's child process dying — has no
 * messages to unpack and becomes a single locationless diagnostic, because the
 * one thing this function must never do is throw at its caller.
 */
function fromThrow(e: unknown): { errors: CompileDiagnostic[]; warnings: CompileDiagnostic[] } {
  const failure = e as { errors?: Message[]; warnings?: Message[] }
  if (Array.isArray(failure.errors) && failure.errors.length > 0) {
    return {
      errors: failure.errors.map(fromMessage),
      warnings: (failure.warnings ?? []).map(fromMessage),
    }
  }
  return { errors: [diagnostic(e instanceof Error ? e.message : String(e))], warnings: [] }
}

// ── caps ──────────────────────────────────────────────────────────────────────

/** Byte length, not string length: the caps are about transport and storage. */
function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function overSourceCap(source: string, filename: string): CompileDiagnostic | null {
  const size = bytes(source)
  if (size <= TOOL_BUNDLE_LIMITS.maxSourceBytes) return null
  return diagnostic(
    `${filename} is ${size} bytes, over the ${TOOL_BUNDLE_LIMITS.maxSourceBytes} byte source limit`,
  )
}

/**
 * esbuild has no timeout of its own, and it does its work in a child process
 * this side cannot interrupt. Losing the race abandons the build rather than
 * killing it — acceptable because the loser is a runaway compile in a shared
 * service, and the alternative is a request that never answers. Racing already
 * attaches a handler to `work`, so a later rejection stays handled.
 */
function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  const { timeoutMs } = TOOL_BUNDLE_LIMITS
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${timeoutMs}ms`)), timeoutMs)
    timer.unref?.()
  })
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer))
}

// ── ui.tsx ────────────────────────────────────────────────────────────────────

/**
 * The import boundary.
 *
 * Every specifier in the graph passes through here before esbuild's own
 * resolution, so refusing by default is what keeps the compiler off the
 * filesystem — there is no `resolveDir` on the stdin input either, which means
 * a path that slipped past this would have no directory to resolve against.
 * Allowed specifiers are marked external here rather than relying on the
 * `external` option, so the outcome does not depend on which of the two esbuild
 * consults first.
 */
const importGuard: Plugin = {
  name: 'visvine-tool-imports',
  setup(hooks) {
    hooks.onResolve({ filter: /.*/ }, (args) => {
      if (ALLOWED_IMPORTS.has(args.path)) return { path: args.path, external: true }
      return { errors: [{ text: `Cannot import ${JSON.stringify(args.path)}. ${IMPORT_RULE}` }] }
    })
  },
}

/** Every specifier esbuild parsed, including ones tree-shaking then dropped. */
function importedPaths(metafile: Metafile): string[] {
  return Object.values(metafile.inputs).flatMap((input) => input.imports.map((i) => i.path))
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch)
}

/** Index just past a `'...'`/`"..."` string, honoring backslash escapes. Clamped to the source length on an unterminated string rather than looping forever. */
function skipQuoted(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === quote) return i + 1
    i++
  }
  return i
}

function skipLineComment(source: string, start: number): number {
  let i = start + 2
  while (i < source.length && source[i] !== '\n') i++
  return i
}

function skipBlockComment(source: string, start: number): number {
  let i = start + 2
  while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
  return Math.min(i + 2, source.length)
}

/**
 * Index just past a template literal, stepping into `${}` splices — which may
 * hold their own strings, comments, or nested templates, including a further
 * `import(...)` call — rather than treating the whole literal as opaque text.
 * A splice's contents are dispatched through `advanceToken`, the same
 * per-character step the top-level scan uses, so an import buried inside an
 * interpolation is found exactly like one at the top level; `violations`
 * defaults to a scratch array for callers (like `isBareLiteralArg`) that only
 * want the end offset and don't want findings recorded twice.
 */
function skipTemplate(source: string, start: number, violations: number[] = []): number {
  let i = start + 1
  let braceDepth = 0
  while (i < source.length) {
    const ch = source[i]
    if (braceDepth === 0) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '`') return i + 1
      if (ch === '$' && source[i + 1] === '{') {
        braceDepth = 1
        i += 2
        continue
      }
      i++
      continue
    }
    // Inside a `${...}` splice, the same rules as top-level code apply.
    if (ch === '{') {
      braceDepth++
      i++
    } else if (ch === '}') {
      braceDepth--
      i++
    } else {
      i = advanceToken(source, i, violations)
    }
  }
  return i
}

function skipTrivia(source: string, start: number): number {
  let i = start
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++
    } else if (source[i] === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i)
    } else if (source[i] === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i)
    } else {
      break
    }
  }
  return i
}

/**
 * Whether the text starting at `argStart` — the position right after
 * `import(` — is a single string or splice-free template literal followed
 * only by trivia and the call's closing `)`. That shape is the one thing
 * esbuild's resolver can read statically; anything else (a variable, string
 * concatenation, a second argument, an interpolated template) never reaches
 * `onResolve` at all, so the guard in `importGuard` never gets a chance to
 * run against it.
 */
function isBareLiteralArg(source: string, argStart: number): boolean {
  let i = skipTrivia(source, argStart)
  if (source[i] === '"' || source[i] === "'") {
    i = skipQuoted(source, i)
  } else if (source[i] === '`') {
    const end = skipTemplate(source, i)
    if (source.slice(i, end).includes('${')) return false
    i = end
  } else {
    return false
  }
  i = skipTrivia(source, i)
  return source[i] === ')'
}

/**
 * Advances one token from position `i`, recording a violation if it starts an
 * `import(...)` call whose argument isn't a bare literal. Shared by the
 * top-level scan and by `skipTemplate`'s `${}` splices, so a dynamic import
 * buried inside an interpolation is found the same way as one at the top
 * level, rather than being skipped over as opaque template text.
 */
function advanceToken(source: string, i: number, violations: number[]): number {
  const ch = source[i]
  if (ch === '/' && source[i + 1] === '/') return skipLineComment(source, i)
  if (ch === '/' && source[i + 1] === '*') return skipBlockComment(source, i)
  if (ch === '"' || ch === "'") return skipQuoted(source, i)
  if (ch === '`') return skipTemplate(source, i, violations)
  if (ch === 'i' && source.startsWith('import', i) && !isIdentChar(source[i - 1] ?? '')) {
    const afterKeyword = i + 'import'.length
    if (!isIdentChar(source[afterKeyword] ?? '')) {
      const parenAt = skipTrivia(source, afterKeyword)
      if (source[parenAt] === '(') {
        if (!isBareLiteralArg(source, parenAt + 1)) violations.push(i)
        return parenAt + 1
      }
    }
  }
  return i + 1
}

/**
 * Every `import(...)` call site in the source whose argument isn't a bare
 * literal — the case that slips past `importGuard` and the post-build
 * `metafile.inputs[].imports` sweep entirely, because esbuild only resolves
 * (and only lists) a specifier it can read statically. Walked over the
 * source itself, not the bundle, and token-aware rather than a plain
 * pattern match, for the same reason `exportsDefault` reads the metafile
 * instead of grepping generated code: a match inside a string or comment
 * would be a false positive, and a `import('lodash')` that tree-shook away
 * would be a false negative.
 */
function findNonLiteralDynamicImports(source: string): number[] {
  const violations: number[] = []
  let i = 0
  while (i < source.length) {
    i = advanceToken(source, i, violations)
  }
  return violations
}

/** `Message['location']` for a plain character offset, so a source-scan finding can be handed to `diagnostic()` like an esbuild one. */
function locationAt(source: string, filename: string, index: number): Message['location'] {
  const before = source.slice(0, index)
  const line = before.split('\n').length
  const column = index - before.lastIndexOf('\n') - 1
  const lineText = source.split('\n')[line - 1] ?? ''
  return { file: filename, namespace: '', line, column, length: 0, lineText, suggestion: '' }
}

/**
 * Whether the bundle exports `default`, read off the metafile rather than
 * matched in the text: `export default function App() {}` and
 * `export { App as default }` compile to the same `export { App as default }`
 * clause, and a regex over generated code would also match one inside a string.
 */
function exportsDefault(metafile: Metafile): boolean {
  const outputs = Object.values(metafile.outputs)
  const output = outputs.find((o) => o.entryPoint) ?? outputs[0]
  return output?.exports.includes('default') ?? false
}

/**
 * Bundle `ui.tsx` into the single ESM module the frame runtime mounts.
 *
 * Resolves with `ok: false` for anything the author can fix — a syntax error, a
 * forbidden import, a missing default export, a bundle over the cap — and never
 * rejects.
 */
export async function compileToolUi(
  source: string,
  opts: { filename?: string } = {},
): Promise<CompileResult> {
  const filename = opts.filename ?? UI_FILENAME
  const oversize = overSourceCap(source, filename)
  if (oversize) return { ok: false, errors: [oversize], warnings: [] }

  let built
  try {
    built = await withTimeout(
      build({
        stdin: { contents: source, loader: 'tsx', sourcefile: filename },
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        jsxImportSource: 'react',
        write: false,
        external: [...EXTERNALS],
        minify: false,
        sourcemap: false,
        // Errors are the return value here; esbuild must not also print them to
        // the server's stdout on an author's typo.
        logLevel: 'silent',
        metafile: true,
        plugins: [importGuard],
      }),
      `Compiling ${filename}`,
    )
  } catch (e) {
    return { ok: false, ...fromThrow(e) }
  }

  const warnings = built.warnings.map(fromMessage)
  const bundle = built.outputFiles[0]?.text ?? ''
  const sizeBytes = bytes(bundle)
  const errors: CompileDiagnostic[] = []

  // A dynamic import whose specifier esbuild can't read statically never
  // reaches `importGuard.onResolve` and never lands in `metafile.inputs[].imports`
  // either, so it would otherwise compile clean straight through to the bundle.
  for (const index of findNonLiteralDynamicImports(source)) {
    errors.push(
      diagnostic(
        `Cannot import a non-literal value. ${IMPORT_RULE}`,
        locationAt(source, filename, index),
      ),
    )
  }

  // The guard never sees an import whose binding went unused, because esbuild
  // drops those before resolving them. Harmless in the bundle — the import is
  // gone — but the author asked for something they may not have, so say so.
  for (const path of importedPaths(built.metafile)) {
    if (!ALLOWED_IMPORTS.has(path)) {
      errors.push(diagnostic(`Cannot import ${JSON.stringify(path)}. ${IMPORT_RULE}`))
    }
  }

  if (!exportsDefault(built.metafile)) {
    errors.push(
      diagnostic(
        `${filename} must have a default export — the Tool runtime mounts \`default\` as the component`,
      ),
    )
  }

  if (sizeBytes > TOOL_BUNDLE_LIMITS.maxBundleBytes) {
    errors.push(
      diagnostic(
        `The compiled bundle is ${sizeBytes} bytes, over the ${TOOL_BUNDLE_LIMITS.maxBundleBytes} byte limit`,
      ),
    )
  }

  if (errors.length > 0) return { ok: false, errors, warnings }
  return { ok: true, bundle, sizeBytes, warnings }
}

// ── data.js ───────────────────────────────────────────────────────────────────

const MODULE_SYNTAX_MESSAGE =
  'data.js runs as a plain script in the isolate, which has no module loader — ' +
  'remove the import/export and assign handlers instead: ' +
  'handlers.<name> = async (args, ctx) => …'

/**
 * Point the module-syntax refusal at a line. esbuild's metafile says whether the
 * file is a module but not where, and the parse has already succeeded by this
 * point, so there is nothing to ask it. A leading `import`/`export` keyword is
 * how all but the most contrived cases are written; when the scan comes up empty
 * the message still stands on its own.
 */
function locateModuleSyntax(source: string): Message['location'] {
  const lines = source.split('\n')
  for (const [i, lineText] of lines.entries()) {
    if (!/^\s*(?:import|export)\b/.test(lineText)) continue
    return {
      file: DATA_FILENAME,
      namespace: '',
      line: i + 1,
      column: lineText.length - lineText.trimStart().length,
      length: 0,
      lineText,
      suggestion: '',
    }
  }
  return null
}

/**
 * Parse-check and lower `data.js` for the isolate.
 *
 * Not a bundle: `bundle: false` means no specifier is resolved at all, and no
 * output `format` is set on purpose. Asking for `esm` would wrap anything that
 * touches `exports` in esbuild's `__commonJS` shim — the handler assignments
 * would then sit in a function nobody calls — and would also reject `with`
 * under strict mode. Unset, esbuild lowers the syntax and leaves the script a
 * script, which is exactly the contract the isolate runs.
 */
export async function compileToolData(source: string): Promise<CompileResult> {
  const oversize = overSourceCap(source, DATA_FILENAME)
  if (oversize) return { ok: false, errors: [oversize], warnings: [] }

  let built
  try {
    built = await withTimeout(
      build({
        stdin: { contents: source, loader: 'js', sourcefile: DATA_FILENAME },
        bundle: false,
        platform: 'neutral',
        target: 'es2020',
        write: false,
        minify: false,
        sourcemap: false,
        logLevel: 'silent',
        // Only for `inputs[].format`, which is esbuild's parser telling us
        // whether the file used module syntax — the one question a transform
        // cannot answer, and the one a regex over source answers wrongly.
        metafile: true,
      }),
      `Compiling ${DATA_FILENAME}`,
    )
  } catch (e) {
    return { ok: false, ...fromThrow(e) }
  }

  const warnings = built.warnings.map(fromMessage)
  const input = Object.values(built.metafile.inputs)[0]
  if (input?.format === 'esm') {
    return {
      ok: false,
      errors: [diagnostic(MODULE_SYNTAX_MESSAGE, locateModuleSyntax(source))],
      warnings,
    }
  }

  const bundle = built.outputFiles[0]?.text ?? ''
  const sizeBytes = bytes(bundle)
  if (sizeBytes > TOOL_BUNDLE_LIMITS.maxBundleBytes) {
    return {
      ok: false,
      errors: [
        diagnostic(
          `The compiled ${DATA_FILENAME} is ${sizeBytes} bytes, over the ${TOOL_BUNDLE_LIMITS.maxBundleBytes} byte limit`,
        ),
      ],
      warnings,
    }
  }

  return { ok: true, bundle, sizeBytes, warnings }
}

// ── build identity ────────────────────────────────────────────────────────────

/**
 * The identity of a set of sources, for deciding whether a stored build is still
 * the one this source would produce.
 *
 * Joined on NUL rather than a newline so `['a', 'b']` and `['a\nb']` hash
 * differently — a Tool's sources are text notes, which cannot contain a NUL.
 */
export function sourceHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex')
}
