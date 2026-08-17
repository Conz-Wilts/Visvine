---
id: 021
title: "docs/tools.md: authoring guide, architecture, limits, ops runbook (tools origin)"
status: todo
kind: build
size: s
wave: 3
depends_on: [010, 011, 012, 013, 014]
touches: [docs/tools.md, CLAUDE.md, README.md]
created_by: 002
session: null
model: null
effort: null
---

## Task

Write docs/tools.md in the style of docs/agents.md: (1) what a Tool is and the note layout (`tools/<name>/index.md`, `ui.md`/`data.md` as fenced sources addressed as `ui.tsx`/`data.js`), frontmatter reference (surfaces, perimeter semantics incl. glob rules and 'narrows, never widens'), (2) the authoring loop over MCP (tool list, scopes, the write→diagnostics cycle, preview URLs/deep link, publish → review → install → upgrade), (3) runtime architecture: tools origin, sandbox + CSP, frame token, bridge methods and limits (`BRIDGE_LIMITS`, `TOOL_BUNDLE_LIMITS`), data.js handlers in the isolate, degraded mode, error card, (4) surfaces: rail row + `/t/<slug>`, type pages (built-ins win; custom types page; one tool per type; admin picks), (5) permissions (members author, admins install/publish, super-admins review), (6) **ops runbook**: `TOOLS_ORIGIN`, prod steps — create DNS `tools.visvine.com` CNAME to ghs.googlehosted.com (or per Cloud Run domain-mapping instructions), `gcloud run domain-mappings create --service visvine-web --domain tools.visvine.com --region australia-southeast1`, add `TOOLS_ORIGIN=https://tools.visvine.com` to the deploy env in .github/workflows/deploy.yml (describe the exact edit; do not edit deploy.yml yourself), verify with curl that the tools host 404s `/directory` and serves `/api/tools/runtime/vendor/react.js`; local dev = `TOOLS_ORIGIN=http://127.0.0.1:3000`, (7) verification commands (tests, verify scripts). Add a short '### Tools (user-created)' subsection under Architecture in CLAUDE.md pointing at docs/tools.md with the 5 facts an agent must know (notes must be .md → fenced sources; bridge is the only door; tools origin env; feature key `tools` + `tool:<slug>` rail keys; review is super-admin). Mention `TOOLS_ORIGIN` in README's env section if one exists. Read the actual code (lib/tools/*, protocol.ts) so the doc matches names exactly.
