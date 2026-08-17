---
id: 023
title: "Live scripted end-to-end run: author over MCP handlers → publish → review → install → frame + bridge write"
status: todo
kind: build
size: m
wave: 4
depends_on: [016, 015, 013, 011, 017]
touches: [apps/web/scripts/verify-tools-e2e.ts, apps/web/scripts/fixtures/tools/hello/**, apps/web/package.json]
created_by: 002
session: null
model: null
effort: null
---

## Task

Write apps/web/scripts/verify-tools-e2e.ts in the style of scripts/verify-connectors-demo.ts (resolve the space owner principal, call services/handlers directly, print `ok`/`FAIL` lines, exit non-zero on failure; local-DB guard). Add script `verify:tools` to apps/web/package.json. Fixture Tool under scripts/fixtures/tools/hello/ (`index.md`, `ui.tsx` using `@visvine/tool-kit` to list notes under `demo/**` and write `demo/from-tool.md`, `data.js` with a `summarise` handler that reads notes and returns counts).

Steps asserted, in order: (1) `appToolHandlers.createTool` with a synthetic `McpContext` for the owner → folder exists; (2) `writeTool` ui.tsx with a deliberate syntax error → response carries a diagnostic with line/col; (3) `writeTool` the good ui.tsx + data.js + index.md (perimeter read/write `demo/**`, rail surface) → build ok; (4) `checkTool` → no errors, requirements empty; (5) `publishTool` → version pending; a non-admin principal publishing → refused; (6) `reviewVersion` as super-admin (`admin@local.dev` is seeded super admin) → approved; (7) `installVersion` → install exists, `featureConfig.order` contains `tool:hello`, `installedToolsForClient` lists it; (8) mint a frame token and, against a running dev server (`BASE_URL` env default `http://localhost:3000`, tools origin from `TOOLS_ORIGIN` default `http://127.0.0.1:3000`), GET the frame document → 200, CSP header contains `connect-src 'none'` and `frame-ancestors`, body contains the import map; GET the bundle → JS containing the compiled component; GET vendor react.js → 200; (9) bridge: call `handleBridgeCall` in-process for `context.list` (returns demo notes), `context.read` of an undeclared path → `perimeter` error, `context.write demo/from-tool.md` → note exists afterwards with the viewer as editor, `data.call summarise` → counts, `state.set/get` round trip; (10) publish v2 with a wider perimeter, approve → install shows `pendingVersionId` and `perimeterDiff.read.added` non-empty; `applyUpgrade` → pinned to v2; (11) uninstall → rail key removed. Clean up the fixture notes/rows at the end (idempotent re-runs). Document usage at the top. Acceptance: the script passes locally against `pnpm dev` (paste the summary lines in the outcome); tsc/lint/knip clean (scripts are excluded from knip? check knip.json and follow existing verify scripts).
