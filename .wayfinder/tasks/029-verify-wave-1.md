---
id: 029
title: Verify wave 1
status: done
kind: verify
size: null
wave: 1
depends_on: []
touches: []
created_by: null
session: 10ee15b4-8b0a-4d90-9a59-97da767461d1
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 1.

## Outcome

PASS: All gates green except knip.

Ran from apps/web: `tsc --noEmit` clean; `eslint . --max-warnings=0` clean; `node --import tsx --test tests/*.test.ts` = **718 pass / 0 fail** (33 suites, includes all 8 new tools-*.test.ts files); `next build` **exit 0** (the earlier in-flight typecheck failures in features/tools/kit/runtime.ts and lib/tools/compile.ts reported by several agents are gone). `prisma migrate status` = "Database schema is up to date!"; `prisma migrate diff --from-config-datasource --to-schema` shows only the pre-existing pgvector index drift (applied by apply-sql-functions.mjs, never in schema.prisma) — no app_tool_* drift, so migration SQL and schema agree.

`knip` exits 1: 2 unused exported types (ToolConfig, ToolTypeSurface in lib/tools/config.ts). Both are used inside their own module but imported nowhere else yet; wave 2 will import ToolConfig. Filed as an xs issue since the plan and CLAUDE.md both state knip stays at zero.

Diff review against the plan — every task did what it claimed:
- 003 perimeter.ts/config.ts: full named API present, gates deny-by-default (empty list → refusal, distinct message), read/write independent, glob grammar as specified with a compile cache, TOOL_RAIL_ICONS validated, BUILT_IN_TYPES blocks `mode: page` on built-ins including legacy spellings via entityKindOf, wrapSource picks a fence longer than the longest backtick run and unwrapSource treats frontmatter `lang:` as authoritative.
- 004 compile.ts: EXTERNALS/TOOL_BUNDLE_LIMITS exactly as specified, onResolve refuses everything else, esbuild in serverExternalPackages, esbuild 0.28.2 in package.json + lockfile.
- 005: four models + back-relations, hand-written migration applied cleanly, the two deliberate non-FK columns documented.
- 006: `tool` EntityKind is folder-only (parseEntityHref rejects the flat form, entityNotePaths registers the index alone), `tools` in ALL/NAV_HIDDEN feature keys, isPersistableFeatureKey lets `tool:<slug>` ride order/more/adminOnly, `tools/` frozen for AI origins in lockedDenial, RESERVED blocks a custom "tool"/"tools" type.
- 007 isolate: capabilities land under a frozen `visvine` built with Object.create(null) + bracket assignment (so a `__proto__` key stays a data property), omitDefaults genuinely omits the globals, globals deep-frozen through marshalValue; MAX_CONCURRENT_RUNS/timeout/redaction untouched.
- 008: proxy calls toolsHostDecision first — runtime paths pass through, everything else on the tools host is a 404 with no cookie touched; frame token has its own `aud`; CSP has all nine directives with X-Frame-Options deliberately absent.
- 009: 11 BridgeMethods, BRIDGE_LIMITS matching the spec, PROTOCOL_VERSION pinned in both places, and the kit's only non-relative imports are `react`, `react/jsx-runtime`, `react-dom/client` plus a type-only import from lib/tools/protocol — the app-code boundary holds.

Nits (not worth an agent):
- esbuild is **not** in `.next/standalone` — nothing imports lib/tools/compile.ts yet, so nft has nothing to trace. Expected at wave 1; re-check once wave 2 wires the build hook (task 004 already flagged it for wave 6).
- proxy PUBLIC_PATHS uses `startsWith("/api/tools/runtime")`, so a future `/api/tools/runtime-foo` route would be public; isToolRuntimePath itself is exact-or-slash.
- isolate: capability keys `"a"` and `"a.b"` together silently drop `"a"`; and `const __visvine_root` / `__ns_N` lexical bindings survive the eval (same frozen objects as `visvine`, so no escalation — just scope noise).
- parseToolConfig treats `note` as non-built-in, so `type: note, mode: page` parses; unreachable today because RESERVED blocks a custom "note" type, but task 022 should guard the dispatch.
- `tools` has no admin-console toggle and defaults false for new spaces — already scheduled as task 028.
