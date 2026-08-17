---
id: 002
title: Plan the work
status: done
kind: plan
size: null
wave: 0
depends_on: [001]
touches: []
created_by: null
session: 172d690b-d179-4bf9-86a1-f9212d089922
model: fable
effort: high
---

## Task

Explore the codebase, write the plan and propose the tasks in waves.

## Outcome

Plan written and 25 tasks proposed across 6 waves for user-created Tools: Tools become the third note-first entity (`tools/<name>/index.md` + fenced-source `ui.md`/`data.md`, since notes must be .md), compiled server-side with esbuild on write, rendered in a `sandbox="allow-scripts"` iframe served from a separate cookie-less origin (`TOOLS_ORIGIN`: prod `tools.visvine.com` mapped by the human, dev `127.0.0.1:3000`) under strict CSP, reaching Visvine only via postMessage → host ToolFrame → `POST /api/tools/bridge` (perimeter-gated, viewer's own grants, caps/rate limits) with `data.js` on the QuickJS isolate via new `extraCapabilities`. Registry = immutable `app_tool_versions` + super-admin review + pinned `app_tool_installs` with admin-approved upgrades and degraded mode; surfaces = navbar icon → `/tools` (Browse/Installed/Mine), per-install rail rows `tool:<slug>` → `/t/<slug>`, and data-driven type pages (custom types via the note route, extra tab on built-ins), plus MCP authoring tools (`tools:author`/`tools:install` scopes). Human decisions taken this session: desktop-only authoring DROPPED (deep-link preview kept), subdomain+sandbox origin, harness rebuild = board + agent dispatch.

Waves: 1 foundations (config/perimeter, compile, schema+migration, entity kind + feature keys, isolate capabilities, origin gate/frame token/CSP, protocol + in-frame SDK/kit) → 2 services (build hooks + service, bridge server + data runner, registry lib, runtime routes + vendor ESM, host ToolFrame) → 3 surfaces (REST routes, MCP tools, rail + `/t/[slug]`, marketplace UI + navbar, author page + preview, admin review, docs/runbook) → 4 type pages + scripted e2e verify → 5 adversarial escape suite (Playwright) + Wayfinder Tool source/seed → 6 Wayfinder verify + final audit. Touches sliced so every wave runs fully parallel; contracts (protocol.ts, config.ts names, DTOs) are spelled out in the wave-1 task descriptions so later tasks agree. Human ops remain: DNS + Cloud Run domain mapping for tools.visvine.com and `TOOLS_ORIGIN` in the deploy env (documented in docs/tools.md by task 021).
