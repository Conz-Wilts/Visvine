---
id: 004
title: Server-side TSX compile pipeline (esbuild) with size caps
status: done
kind: build
size: m
wave: 1
depends_on: []
touches: [apps/web/package.json, pnpm-lock.yaml, apps/web/lib/tools/compile.ts, apps/web/next.config.ts, apps/web/tests/tools-compile.test.ts]
created_by: 002
session: 0222f891-faba-4ad8-98a7-91af0730b47d
model: opus
effort: xhigh
---

## Task

Add `esbuild` (latest 0.2x) as a runtime dependency of apps/web (`pnpm --filter @visvine/web add esbuild`) and add it to `serverExternalPackages` in apps/web/next.config.ts (native binary; must not be bundled by Turbopack). Create **apps/web/lib/tools/compile.ts** exporting:

- `TOOL_BUNDLE_LIMITS = { maxSourceBytes: 512_000, maxBundleBytes: 1_000_000, timeoutMs: 10_000 }`.
- `EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@visvine/tool-kit']` — left as bare ESM imports (resolved later by an import map in the frame document).
- `compileToolUi(source: string, opts?: { filename?: string }): Promise<CompileResult>` where `type CompileResult = { ok: true; bundle: string; sizeBytes: number; warnings: CompileDiagnostic[] } | { ok: false; errors: CompileDiagnostic[]; warnings: CompileDiagnostic[] }` and `CompileDiagnostic = { message: string; line: number|null; column: number|null; text: string|null }`. Use `esbuild.build` with `stdin` (loader 'tsx', jsx 'automatic', jsxImportSource 'react'), `bundle: true`, `format: 'esm'`, `platform: 'browser'`, `target: 'es2022'`, `write: false`, `external: EXTERNALS`, `minify: false`, `sourcemap: false`, `logLevel: 'silent'`, and a plugin that refuses ANY other import (`import 'lodash'`, `import './x'`, `import 'https://…'`) with a clear diagnostic (`Only react, react/jsx-runtime, react-dom/client and @visvine/tool-kit may be imported`). Enforce source and bundle size caps (diagnostic, not throw). Verify the output has a default export (`export default` or `export { X as default }`) — required: the runtime mounts `default`. Wrap esbuild errors into diagnostics; never let esbuild throw out of this function.
- `compileToolData(source: string): Promise<CompileResult>` — for data.js: parse-check only via esbuild `transform` (loader 'js', format 'esm' → then strip to a plain script? No: data.js is executed inside the QuickJS isolate which has no module loader; the contract is a plain script that assigns handlers to `exports.<name> = async (args, ctx) => …` OR defines `const handlers = {...}` — normalise: transform with esbuild to es2020, and reject `import`/`export` statements with a diagnostic telling the author to use `handlers.<name> = …`). Return the transformed code as `bundle`.
- `sourceHash(parts: string[]): string` (sha256 hex of the joined sources; used by builds).

Tests: compiles a JSX component to a bundle importing react/jsx-runtime; rejects a disallowed import; reports line/column for a syntax error; enforces size caps; data.js parse errors; missing default export.

Acceptance: tsc/lint/test/knip clean; `pnpm --filter @visvine/web build` is NOT required here but note in the task outcome whether esbuild resolves under `output: standalone` (grep .next/standalone if you do run it).

## Outcome

Added esbuild 0.28.2 to apps/web (+ `serverExternalPackages`) and built `apps/web/lib/tools/compile.ts`: `compileToolUi` bundles TSX to one ESM module with react/react-dom/@visvine/tool-kit left as bare imports and every other specifier refused, `compileToolData` parse-checks and lowers data.js to es2020 as a plain script, plus `TOOL_BUNDLE_LIMITS`, `EXTERNALS` and `sourceHash`. 15 new tests in `apps/web/tests/tools-compile.test.ts`; tsc/eslint/knip clean for these files and the full suite is 718/718.

Detail:

- **Import boundary.** An onResolve plugin (filter `/.*/`) marks the five EXTERNALS external itself and returns a diagnostic for anything else, so the outcome does not depend on whether esbuild consults `external` or plugins first; `stdin` carries no `resolveDir`, so nothing can reach the server filesystem. Probing found esbuild drops an import whose binding is unused *before* resolving it, so the guard never sees it — closed by also scanning `metafile.inputs[].imports` after a successful build. Verified refused: bare package, relative, `node:fs`, `https://…`, side-effect-only, dynamic `import()`, and the tree-shaken unused case.
- **Default export** is read from `metafile.outputs[].exports` rather than matched in the text: `export default function App(){}` and `export { App as default }` both compile to the same clause, and a regex would also match one inside a string.
- **data.js** deliberately sets no output `format`. With `format: 'esm'`, esbuild wraps anything touching `exports` in its `__commonJS` shim (handler assignments would then sit in a function nobody calls) and rejects `with` under strict mode. Unset + `bundle: false` + `platform: 'neutral'` gives byte-identical output to `transform` while `metafile.inputs[].format === 'esm'` provides a parser-accurate "used module syntax" verdict — the one question `transform` cannot answer and a regex over source answers wrongly. The refusal names the fix (`handlers.<name> = async (args, ctx) => …`) and is pointed at the offending line by a best-effort scan.
- Caps are diagnostics, never throws; esbuild has no timeout of its own, so `TOOL_BUNDLE_LIMITS.timeoutMs` is a `Promise.race` that abandons (cannot kill) a runaway compile.
- `sourceHash` joins parts on NUL so `['a','b']` and `['a\nb']` differ.

Verification: `node --import tsx --test tests/tools-compile.test.ts` 15/15; `pnpm test` 718/718; `pnpm exec tsc --noEmit` reports nothing in `lib/tools/compile.ts` or the test (the only remaining errors are another agent's in-flight `features/tools/kit/runtime.ts`); `eslint . --max-warnings=0` zero problems; `knip` flags nothing for compile.ts and does not list esbuild as unused.

**Standalone/esbuild note (asked for in the task):** did not run `next build` — another wave-1 agent's `features/tools/kit/runtime.ts` currently fails typecheck, so the build would fail for reasons unrelated to this task. Instead I ran Next's own tracer (`next/dist/compiled/@vercel/nft`) over `require.resolve('esbuild')`: it traces `esbuild/lib/main.js`, both package.json files, and **the platform binary** (`@esbuild/win32-x64/esbuild.exe`) — so `output: standalone` should carry it; on the Alpine builder the same trace resolves `@esbuild/linux-x64/bin/esbuild` (a static Go binary, so musl is fine), and `pnpm-lock.yaml` carries `@esbuild/linux-x64@0.28.2`. Two things still worth an eye in wave 6: (1) the Docker `pnpm install --frozen-lockfile` prints `Ignored build scripts: esbuild@0.28.2` because pnpm 10 ignores postinstalls and root `package.json#pnpm.onlyBuiltDependencies` lists only `electron` — esbuild works without its postinstall (verified locally: `transform`/`build` both run), so I left root package.json alone as out of scope; (2) a real `next build` + `grep .next/standalone` for the linux binary once the tree typechecks.
