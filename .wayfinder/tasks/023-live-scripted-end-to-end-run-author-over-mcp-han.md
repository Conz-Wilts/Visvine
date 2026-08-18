---
id: 023
title: "Live scripted end-to-end run: author over MCP handlers → publish → review → install → frame + bridge write"
status: done
kind: build
size: m
wave: 4
depends_on: [016, 015, 013, 011, 017]
touches: [apps/web/scripts/verify-tools-e2e.ts, apps/web/scripts/fixtures/tools/hello/**, apps/web/package.json]
created_by: 002
session: 7c97796f-c837-4a0f-86ff-85e8a5a41423
model: opus
effort: xhigh
---

## Task

Write apps/web/scripts/verify-tools-e2e.ts in the style of scripts/verify-connectors-demo.ts (resolve the space owner principal, call services/handlers directly, print `ok`/`FAIL` lines, exit non-zero on failure; local-DB guard). Add script `verify:tools` to apps/web/package.json. Fixture Tool under scripts/fixtures/tools/hello/ (`index.md`, `ui.tsx` using `@visvine/tool-kit` to list notes under `demo/**` and write `demo/from-tool.md`, `data.js` with a `summarise` handler that reads notes and returns counts).

Steps asserted, in order: (1) `appToolHandlers.createTool` with a synthetic `McpContext` for the owner → folder exists; (2) `writeTool` ui.tsx with a deliberate syntax error → response carries a diagnostic with line/col; (3) `writeTool` the good ui.tsx + data.js + index.md (perimeter read/write `demo/**`, rail surface) → build ok; (4) `checkTool` → no errors, requirements empty; (5) `publishTool` → version pending; a non-admin principal publishing → refused; (6) `reviewVersion` as super-admin (`admin@local.dev` is seeded super admin) → approved; (7) `installVersion` → install exists, `featureConfig.order` contains `tool:hello`, `installedToolsForClient` lists it; (8) mint a frame token and, against a running dev server (`BASE_URL` env default `http://localhost:3000`, tools origin from `TOOLS_ORIGIN` default `http://127.0.0.1:3000`), GET the frame document → 200, CSP header contains `connect-src 'none'` and `frame-ancestors`, body contains the import map; GET the bundle → JS containing the compiled component; GET vendor react.js → 200; (9) bridge: call `handleBridgeCall` in-process for `context.list` (returns demo notes), `context.read` of an undeclared path → `perimeter` error, `context.write demo/from-tool.md` → note exists afterwards with the viewer as editor, `data.call summarise` → counts, `state.set/get` round trip; (10) publish v2 with a wider perimeter, approve → install shows `pendingVersionId` and `perimeterDiff.read.added` non-empty; `applyUpgrade` → pinned to v2; (11) uninstall → rail key removed. Clean up the fixture notes/rows at the end (idempotent re-runs). Document usage at the top. Acceptance: the script passes locally against `pnpm dev` (paste the summary lines in the outcome); tsc/lint/knip clean (scripts are excluded from knip? check knip.json and follow existing verify scripts).

## Outcome

`scripts/verify-tools-e2e.ts` drives one fixture Tool the whole distance — author over the MCP handlers → publish → super-admin review → install → real HTTP against the runtime routes → bridge → wider v2 → approve → upgrade → uninstall — and it passes **21/21 against `pnpm dev` on :3000**, leaving the shared dev DB byte-for-byte as it found it. tsc, eslint (`--max-warnings=0`), knip and the full suite (964/964) are all clean.

**The live run** (`CLOUD_SQL_CONNECTION_NAME= pnpm --filter @visvine/web verify:tools`, space `community:blackbird-ventures`, owner `admin@local.dev`):

```
1  create_tool scaffolds the folder, its three files and the directory node
     tools/hello/index.md, tools/hello/ui.tsx, tools/hello/data.js · node tool:hello type=tool
2  the write lands and answers with a located diagnostic
     ui.tsx:11:0 The character "}" is not valid inside a JSX element (…)
3  ui.tsx + data.js + index.md compile — 3681 bytes compiled · no errors
4  check_tool: compiles, nothing missing, nothing to warn about
     Reads demo/** · Writes demo/** · Sidebar row "Hello" (list) with its own full-pane page
5  publish_tool queues version 1 for review — community:blackbird-ventures/hello v1 pending
   a member of the space cannot publish — 403 Only space admins can publish a tool.
6  the super admin approves version 1 — v1 approved, 0 install(s) offered it
7  the install exists, takes a rail key and reaches the space DTO
     hello v1 · order [directory, channels, resources, connectors, agents, tool:hello] · DTO [deal-page-022, hello]
8  the dev server answers — http://localhost:3000
   GET the frame document → 200, sandbox CSP, import map
     200 · script-src 'self' 'nonce-…'; connect-src 'none'; frame-ancestors http://localhost:3000
   GET the bundle → this Tool's own compiled component — 200 · 3187 bytes · marker present
   GET the vendor React module → 200 of real ESM — 200 · 10036 bytes · text/javascript
9  context.list returns the demo notes — demo/alpha.md, demo/beta.md, demo/index.md
   a read outside the declared perimeter is refused as `perimeter`
     tool perimeter denied: people/index.md is not in this tool's read globs (demo/**)
   context.write lands the note with the VIEWER recorded as its editor
     demo/from-tool.md · editor Dev Admin <admin@local.dev> origin edit
   data.call runs the data.js handler in the isolate — 4 notes, 411 bytes, types {"note":2,"untyped":1,"Index":1}
   state.set / state.get round-trips per install
10 approving v2 offers it to the install, with the perimeter diff attached — v2 approved · read += ["people/**"]
   applyUpgrade pins the install to v2 and clears the offer — now on v2
11 uninstalling drops the row and takes its rail key with it — order [directory, …, agents]
   cleanup leaves no fixture notes, registry rows or rail key behind — 0 note(s), 0 rows, tool:hello gone

21 passed, 0 failed
```

**The fixture** (`scripts/fixtures/tools/hello/`) is five real files, not string literals: `index.md` (perimeter read/write `demo/**`, rail row `Hello`/`list`), `index.v2.md` (identical but `read` also names `people/**` — the wider perimeter step 10 needs), `ui.tsx` (kit `PageHeader`/`Card`/`Table`/`Banner`, `useQuery` over `context.list('demo/**')`, a button that writes `demo/from-tool.md`, plus `data.call('summarise')`), `ui.broken.tsx` (an unclosed `<main>`) and `data.js` (`handlers.summarise` walks the same glob through `visvine.context.list`/`read` and returns `{glob, notes, bytes, byType}` — reading each note proves the isolate goes through the same perimeter gate the frame does).

**Three deviations from the task text, all forced.** (1) `installedToolsForClient` no longer exists — task 054 deleted it as dead code; the check uses its replacement `installedToolsForSpaces`, asserting the DTO carries `slug` and `href: /t/hello`. (2) Step 7 goes through `appToolHandlers.installTool { key }` rather than calling `installVersion` directly, since the task's own title says the flow is over MCP and `installVersion` is exactly what runs beneath it (the key→newest-approved resolution comes free). (3) The three HTTP checks hit `TOOLS_ORIGIN` default `http://127.0.0.1:3000`, which with `TOOLS_ORIGIN` unset locally is the documented same-origin fallback — the frame route answers on the app host by design, so `frame-ancestors http://localhost:3000` is the app origin rather than `'self'`, and the run is honest about which it got.

**Cleanup is per-key, not a snapshot restore.** The workspace DB is shared with other agents right now (another one installed `deal-page-022` mid-run), so `cleanup()` names only the six paths it can have written, purges exactly its own trash rows, drops the two folder rows only when nothing else lives under them, and edits `featureConfig` key by key under `updateSpaceConfig`'s lock. Two ordering facts are baked in with comments: the Tool's index note is deleted LAST (deleting a source note re-runs the build hook, and only the index deletion drops the build), and `appToolBuild.deleteMany` runs after the notes for the same reason. `orderWasAbsent` handles the one thing uninstall cannot undo — installing materialises an absent `featureConfig.order`. Verified afterwards by hand against psql: no fixture notes, folders, node, registry/build/install rows, and `feature_config` identical to the pre-run value.

**Four out-of-scope edits, one line each and all the same edit.** `scripts/fixtures/**` is added to `tsconfig.json#exclude`, `eslint.config.mjs#globalIgnores` and a new `knip.json#ignore`. Without them the acceptance criterion is unmeetable: `ui.tsx` imports `@visvine/tool-kit`, which only resolves through the frame's import map at run time, `data.js` assigns to a `handlers` global the isolate provides, and `ui.broken.tsx` is a deliberate syntax error — tsc reported its three parse errors before the exclusion. Each carries a comment saying these are Tool source files fed to the server-side compiler, not app code. I confirmed TypeScript's own `readConfigFile` (what tsc, Next and eslint-config-next all use) parses the commented tsconfig, and that nothing in the repo `JSON.parse`s it. `package.json` gains `"verify:tools": "tsx scripts/verify-tools-e2e.ts"`.

**One local-env gotcha worth knowing** (documented in the script header): this box's `apps/web/.env` still carries a `CLOUD_SQL_CONNECTION_NAME` from a `dev:cloud` session, and `scripts/guard-local-db.mjs` refuses on sight even though `DATABASE_URL` points at Docker. Every run here was `CLOUD_SQL_CONNECTION_NAME= pnpm …`. I did not touch `.env`.

**Verification:** the run above (twice consecutively, to prove idempotence — the second started from a clean slate and ended 21/21 too), `pnpm exec tsc --noEmit` → 0, `eslint . --max-warnings=0` → 0, `knip --no-progress` → 0, `node --import tsx --test tests/*.test.ts` → 964 pass / 0 fail.
