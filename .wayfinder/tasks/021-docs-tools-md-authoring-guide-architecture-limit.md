---
id: 021
title: "docs/tools.md: authoring guide, architecture, limits, ops runbook (tools origin)"
status: done
kind: build
size: s
wave: 3
depends_on: [010, 011, 012, 013, 014]
touches: [docs/tools.md, CLAUDE.md, README.md]
created_by: 002
session: 157b7e23-070c-4eec-811d-27721a2687bf
model: sonnet
effort: high
---

## Task

Write docs/tools.md in the style of docs/agents.md: (1) what a Tool is and the note layout (`tools/<name>/index.md`, `ui.md`/`data.md` as fenced sources addressed as `ui.tsx`/`data.js`), frontmatter reference (surfaces, perimeter semantics incl. glob rules and 'narrows, never widens'), (2) the authoring loop over MCP (tool list, scopes, the write→diagnostics cycle, preview URLs/deep link, publish → review → install → upgrade), (3) runtime architecture: tools origin, sandbox + CSP, frame token, bridge methods and limits (`BRIDGE_LIMITS`, `TOOL_BUNDLE_LIMITS`), data.js handlers in the isolate, degraded mode, error card, (4) surfaces: rail row + `/t/<slug>`, type pages (built-ins win; custom types page; one tool per type; admin picks), (5) permissions (members author, admins install/publish, super-admins review), (6) **ops runbook**: `TOOLS_ORIGIN`, prod steps — create DNS `tools.visvine.com` CNAME to ghs.googlehosted.com (or per Cloud Run domain-mapping instructions), `gcloud run domain-mappings create --service visvine-web --domain tools.visvine.com --region australia-southeast1`, add `TOOLS_ORIGIN=https://tools.visvine.com` to the deploy env in .github/workflows/deploy.yml (describe the exact edit; do not edit deploy.yml yourself), verify with curl that the tools host 404s `/directory` and serves `/api/tools/runtime/vendor/react.js`; local dev = `TOOLS_ORIGIN=http://127.0.0.1:3000`, (7) verification commands (tests, verify scripts). Add a short '### Tools (user-created)' subsection under Architecture in CLAUDE.md pointing at docs/tools.md with the 5 facts an agent must know (notes must be .md → fenced sources; bridge is the only door; tools origin env; feature key `tools` + `tool:<slug>` rail keys; review is super-admin). Mention `TOOLS_ORIGIN` in README's env section if one exists. Read the actual code (lib/tools/*, protocol.ts) so the doc matches names exactly.

## Outcome

Wrote docs/tools.md in the style of docs/agents.md, covering all seven asked-for sections: (1) what a Tool is + note layout (`tools/<name>/index.md`, `ui.md`/`data.md` as fenced sources addressed as `ui.tsx`/`data.js`) + frontmatter reference with the glob/name-list grammar and "narrows, never widens"; (2) the MCP authoring loop (tool table + scopes from task 016's design, write→diagnostics cycle, preview deep link/web URL, publish→review→install→upgrade); (3) runtime architecture — tools origin, sandbox+CSP, frame token, the full bridge method table, `BRIDGE_LIMITS`/`TOOL_BUNDLE_LIMITS`, `data.js` in the isolate, degraded mode, error card; (4) surfaces — rail row + `/t/<slug>`, type-page dispatch (built-ins win, one page per type, admin picks); (5) permissions table (members author, admins publish/install, super-admins review); (6) ops runbook — `TOOLS_ORIGIN`, the DNS/domain-mapping/deploy.yml steps (described, not applied), curl verification; (7) verification commands. Also added a "### Tools (user-created)" subsection under Architecture in CLAUDE.md with the five required facts pointing at docs/tools.md, and one line in README.md's Notes section mentioning `TOOLS_ORIGIN` (README has no dedicated env-vars section — `.env.example` already documents it in full — so I added a pointer rather than inventing a new section).

Verified by reading the actual implementation rather than guessing: lib/tools/{config,perimeter,protocol,limits,origin,csp,frameToken,sdkDocs,service,bridge,target,registry,installs,requirements,dataRun,state,builds,compile,frameDocument,vendorBundle}.ts, the runtime/bridge/frame-token routes, lib/featureAccess.ts (`toolRailKey`, `TOOL_RAIL_KEY_PREFIX`, `NAV_HIDDEN_FEATURE_KEYS`), and the .env.example TOOLS_ORIGIN block, plus the wave-3 task files (015/016/017) for the REST/MCP/rail surfaces that build on this task's dependencies but hadn't landed yet, so the authoring-loop and surfaces sections describe the settled design rather than code I could grep. No code was changed, so there's no tsc/lint/test to run; I cross-checked every function/constant name I cited against the source instead. `publishTool`'s admin check uses the confusingly-named `principalIsSuperAdmin` helper (which actually means space-admin-or-system, per lib/notes/shared/permissions.ts) — I did not "fix" it, just documented it correctly as a space-admin gate.

Left for later waves, not touched here: MCP tools (lib/mcp/appTools.ts), the REST routes, and the rail/`/t/[slug]` wiring don't exist yet (tasks 015-017 in flight) — the doc names their planned shapes from the task board so it won't drift once they land, but there's nothing to run against yet.
