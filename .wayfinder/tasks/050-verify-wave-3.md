---
id: 050
title: Verify wave 3
status: done
kind: verify
size: null
wave: 3
depends_on: []
touches: []
created_by: null
session: f0aa78e9-dbd0-4556-9028-094d3de166ed
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 3.

## Outcome

PASS: Ran every gate from the plan's verification section, from the repo root:

- `pnpm --filter @visvine/web exec tsc --noEmit` — exit 0, clean.
- `pnpm lint` (`eslint . --max-warnings=0`) — exit 0, clean.
- `pnpm test` — **943/943 pass**, 33 suites, 0 fail (includes the 4 new wave-3 suites: tools-rail 16, tools-mcp 23, mcp-scopes 4, tools-entity-folder 8).
- `pnpm build` — exit 0; `/t/[slug]`, `/tools`, `/tools/preview/[name]` and all eight new API routes appear in the route manifest.
- `pnpm --filter @visvine/web exec knip` — **2 items, not zero** (issue below).

Read the full wave diff (39 modified + 36 new files, ~1128 insertions) against the plan and each task's outcome. All seven wave-3 surfaces are genuinely there and wired, not stubbed:

- **015 REST** — eight route handlers, all space-scoped ones behind the new `lib/tools/route.ts#requireToolsAccess` (session → member context → `tools` key → principal). Gates read correctly: registry detail 404s a non-approved version for anyone but author/super-admin and withholds *both* sources; review routes are `isSuperAdmin`-only; install/patch/delete/publish are `isAdmin`-only; `installVersion` refuses a non-approved version; the PATCH `.refine` genuinely rejects 0 or 2 actions.
- **016 MCP** — `registerAppTools` wired from `tools.ts`, nine tools, two new scopes with consent copy, `TOOL_SCOPES` split 3/5/1 and covered both directions by mcp-scopes.test.ts.
- **017 rail** — `installedTools` rides the space DTO through `listVisibleSpaces` (one batched query), `SpaceContext` hydrates from `/api/data/communities` which uses it, so Sidebar/ToolPage/SpaceToolsPanel all read the same data. `navFeatureKeys` puts tool keys last so installing can't move a space's front door; `composeOrder`/`carriedMore` do preserve unknown `tool:` keys through the whole-value PUT.
- **018/019/020** — marketplace, author page, preview, review section all present and imported (knip's ToolFrame/PerimeterSummary exemptions correctly dropped now that they have consumers).
- **021 docs** — spot-checked `docs/tools.md` against the shipped code: the MCP tool/scope table, the REST paths, the runtime routes and the permissions table all match what actually landed. `TOOLS_ORIGIN` is in `.env.example`, README and the runbook.
- **028/038/039** — the note-store change (`ensureToolNode` before `enforceIndexContract`) uses the store's own `throw new Error(denial)` convention; audit calls use the established `void logAudit(...)` fire-and-forget (logAudit swallows internally).

No `@ts-ignore`, `eslint-disable`, or `as any` added anywhere in the wave. The two TODOs in the diff are the ones task 048 already tracks.

Four issues filed, none a blocker. Nits not worth an agent: `defaultLandingHref` can now return `/t/<slug>`, which is fine but untested; task 046 (Mine tab's last-publication status) is a real unbuilt piece of task 018's brief, already filed as its own task; `installs.ts#featureConfigWithoutRail` still leaves a dead `enabled['tool:<slug>']` key behind on uninstall (harmless, noted by task 018).
