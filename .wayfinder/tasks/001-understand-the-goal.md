---
id: 001
title: Understand the goal
status: done
kind: intake
size: null
wave: 0
depends_on: []
touches: []
created_by: null
session: 8040c803-d7bd-4e83-aff5-d6aac97430b6
model: opus
effort: low
---

## Task

Understand this goal well enough to plan it (thorough depth):

One of the big features we're trying to build for Visvine is the ability for users to create their own tools. I'm not sure of the exact mechanism yet, but maybe we let them use vibe-coding tools, so we'd add an MCP feature that lets a user create a tool, view their creation, and then upload it to a tool marketplace where others can add it. This is a feature we'd like to build end-to-end.

The cool part is connecting it to our data structure: letting users seed their tool's data using context notes or connectors. I think this could be a really exciting opportunity worth working toward. We'd like users to be able to build essentially anything.

Tool building and adding would only be available in the desktop version of the app. I don't think adding it to the web version would be a good idea, though I could be wrong.

A good test of whether this works would be to see if we could rebuild the harness we just coded, using Visvine itself.

I'd also like the build to understand its own limits, for example, a tool should only render in the main content area and shouldn't affect the navbar. It should also have auth tied to context types. Maybe if you create a tool connected to a context type, you could then build a page for that type of context note, similar to how profiles have pages, spaces have pages, or events have event pages.

This is a hard task, but I believe we can get it done if we plan it properly. Thanks.

## Outcome

User-created Tools, settled end to end across seven interview rounds. A Tool is author-written TSX compiled server-side, rendered in a cookie-less separate-origin sandboxed iframe that can only reach Visvine through a capability-gated postMessage bridge, with data logic on the existing QuickJS connector isolate. It is stored as a note entity folder (`tools/<name>/index.md` + `ui.tsx`/`data.js`), making it the third instance of the connector/agent pattern. Authoring is external and agentic over Visvine's MCP server, desktop-only and enforced server-side; installed Tools run on desktop and web, never mobile. Marketplace is real but gated: publish snapshots an immutable version, a super-admin reviews perimeter + diff in /admin, installs pin a version, upgrades are admin-approved, entry is a navbar icon next to the calendar opening /tools (Browse/Installed/Mine). Acceptance test — rebuilding the Wayfinder harness as a Visvine Tool — is in scope as the final wave.

Key constraints the plan must honour: a Tool renders only in the main content area (never navbar or sidebar chrome); its reach is a declared frontmatter perimeter (context paths/globs, node types, named connectors) that the bridge refuses to exceed; auth is always the viewer's own note grants, narrowed but never widened; hard caps (bundle size, isolate timeout, read row/byte caps, rate limits) with an in-pane error card on failure. Two surfaces in v1: an auto-added sidebar rail item with a full-pane page, and the page for a *member-invented* context type — which requires making the hardcoded NodeRoute dispatch in `app/(auth)/directory/[nodeId]/page.tsx` data-driven; built-in person/space/event/resource pages always win, with Tools limited to adding a tab there. Members author, admins install/publish (via `writeDenial`, mirroring agents). Missing dependencies at install show a requirements checklist and the Tool runs degraded. Free only, but author identity and version history are modelled now.

Notable implementation facts found: the QuickJS isolate and its perimeter/allow-rule gate already exist in `lib/connectors/isolate.ts`; entity folders shipped 2026-08-17 and give multi-file storage for free; `esbuild` is NOT yet a dependency and must be added for the compile step; the navbar already carries the global icons so the marketplace icon has a natural home; the desktop shell is thin (`window.visvineDesktop.isDesktop` only), so the desktop-only gate must be server-side. Verification is Node tests on the pure parts, a live scripted end-to-end MCP author→install→render→write run, an adversarial escape suite (undeclared reads, cookie theft, content-area escape, cross-space access), then the harness rebuild. Two assumptions left to the plan: local dev serves the tool origin from a second local port, and the published-version registry is a new non-space-scoped table with the author's note as working copy.
