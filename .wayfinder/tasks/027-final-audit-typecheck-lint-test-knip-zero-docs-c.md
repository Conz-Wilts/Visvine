---
id: 027
title: "Final audit: typecheck/lint/test/knip zero, docs current, loose ends from the waves"
status: todo
kind: build
size: m
wave: 6
depends_on: [022, 023, 018, 020, 021, 016]
touches: [docs/tools.md, CLAUDE.md, apps/web/knip.json, apps/web/lib/tools/**, apps/web/features/tools/**, apps/web/lib/mcp/appTools.ts, apps/web/app/api/tools/**]
created_by: 002
session: null
model: null
effort: null
---

## Task

Close the feature. Run `pnpm --filter @visvine/web exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm --filter @visvine/web exec knip` and fix everything they report inside the Tools code (unused exports, dead helpers, missing entry files in knip.json). Reconcile any TODOs left by earlier tasks (grep `TODO(tools)` / `resolveBridgeTarget` duplication between the frame-token route and the bridge — unify on lib/tools/target.ts). Re-read docs/tools.md and the CLAUDE.md subsection against the final code: MCP tool names + scopes, bridge method list and limits, env vars, verify commands (`verify:tools`, `verify:tools:escape`, `verify:wayfinder-tool`), the ops runbook. Confirm `pnpm --filter @visvine/web build` succeeds on this machine (or, if the known Windows EPERM affects it, state that and confirm `next build` at least compiles the routes) and that esbuild + the QuickJS variant are both in `serverExternalPackages`. Report a crisp checklist of what is verified and what the human must do (DNS + domain mapping + `TOOLS_ORIGIN` in deploy env, run `pnpm db:migrate` in prod via the normal deploy).
