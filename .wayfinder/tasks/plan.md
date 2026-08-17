# Wayfinder

## Goal

One of the big features we're trying to build for Visvine is the ability for users to create their own tools. I'm not sure of the exact mechanism yet, but maybe we let them use vibe-coding tools, so we'd add an MCP feature that lets a user create a tool, view their creation, and then upload it to a tool marketplace where others can add it. This is a feature we'd like to build end-to-end.

The cool part is connecting it to our data structure: letting users seed their tool's data using context notes or connectors. I think this could be a really exciting opportunity worth working toward. We'd like users to be able to build essentially anything.

Tool building and adding would only be available in the desktop version of the app. I don't think adding it to the web version would be a good idea, though I could be wrong.

A good test of whether this works would be to see if we could rebuild the harness we just coded, using Visvine itself.

I'd also like the build to understand its own limits, for example, a tool should only render in the main content area and shouldn't affect the navbar. It should also have auth tied to context types. Maybe if you create a tool connected to a context type, you could then build a page for that type of context note, similar to how profiles have pages, spaces have pages, or events have event pages.

This is a hard task, but I believe we can get it done if we plan it properly. Thanks.

## Brief

# User-created Tools, end to end

Let Visvine users **build essentially anything** as a Tool, run it inside their space, and share it through a Tool marketplace — with the Tool's data seeded from Visvine's own structure: context notes and connectors.

## Outcome

A member, in the desktop app, points a vibe-coding agent (Claude Code / Cursor) at Visvine's MCP server, describes a Tool, and gets a working one: it renders in the main content area of their space, reads and writes real space data within its declared reach, and can be published to a marketplace where other spaces install it.

**Acceptance test:** rebuild the Wayfinder harness itself as a Visvine Tool — the goal, waves and task board over context notes, dispatching work through the existing agents feature. If that's buildable, the mechanism is real. This lands as the final wave, not a follow-on.

## What a Tool is

- **Sandboxed UI + isolate data.** The author writes **TSX/JSX**, compiled server-side on write (compile errors come straight back to the author). It renders in an iframe on a **separate, cookie-less origin** under strict CSP, and can reach Visvine *only* by postMessage to a capability-gated bridge. Data logic runs on the existing QuickJS connector isolate — no sockets, no filesystem, perimeter-gated `fetch`/`sql`/`mcp`.
- **A Tool is a note.** `tools/<name>/index.md` (frontmatter = config, body = docs) plus `ui.tsx` / `data.js` sibling files in the entity folder — so note history, grants, privilege and MCP writes all come free. Third instance of the connector/agent pattern.
- Users say **"Tool"**; code says `AppTool` / `tools/` to disambiguate from built-in tools and MCP tools.
- **Looks native**: Visvine CSS tokens (including the theme accent) are injected and a small Visvine UI kit is importable, so marketplace Tools don't look like twelve different websites.

## A Tool knows its own limits

- **Main content area only** — never the navbar, never the sidebar chrome.
- **Declared perimeter.** Frontmatter names the context paths/globs, node types and connectors it may touch, exactly like the connector `allow:` rules. The bridge refuses anything undeclared, so a Tool's reach is reviewable before anyone installs it.
- **Auth is the viewer's own grants, always.** A Tool can never surface a note the viewer couldn't already read; its declaration narrows that, never widens it. No new permission model.
- **Hard caps, visible failure**: bundle-size cap, isolate timeouts, row/byte caps on reads, rate limits. A crash or timeout renders an in-pane error card with a report path — never a broken app shell.

## Where a Tool appears

1. **Its own sidebar rail item and full-pane page**, like Channels or Resources. Installing auto-adds the rail item; admins reorder or hide it with the existing `featureConfig` order / "More" controls.
2. **The page for a context type** — the profiles / space pages / event pages analogy. Today that dispatch is a hardcoded switch in `directory/[nodeId]`; it becomes data-driven. **Built-ins win**: Tools may own the page for member-invented custom types only, while person/space/event/resource keep their built-in pages and a Tool may add an extra tab. One Tool per type.

## Marketplace

- Navbar icon **next to the calendar** — global things belong at the top — opening one `/tools` destination with **Browse / Installed / Mine**.
- **Publish → review → install.** Publishing snapshots an **immutable version** and queues a submission for a **Visvine super-admin**, who sees the declared perimeter and a code diff. Installs **pin** a version; a new version arrives as an admin-approved upgrade that shows what changed in the perimeter — code never changes under a space silently.
- **Missing dependencies don't block**: install shows a requirements checklist and the Tool runs **degraded** behind a clear banner, unsatisfied reads returning empty.
- **Free only** in this build, but the registry models author identity and version history so paid Tools are addable later.

## Who and where

- **Members author; admins install and publish** — mirroring agents (member-writable brief, admin-gated activation) via `writeDenial`.
- **Authoring is desktop-only, enforced server-side**, not merely hidden in the UI.
- **Installed Tools run in desktop and web.**
- **Mobile has no Tools** — these are power tools for desktop and web for now. No native work; the native clients simply must not break.

## Verification

- Node tests on the pure parts: perimeter enforcement, compile pipeline, type-page dispatch.
- A **live scripted end-to-end run** in the style of the connector and agent verifications: author a Tool over MCP → install it → assert it renders and writes.
- An **adversarial escape suite**: a hostile Tool attempting undeclared context reads, cookie or session theft, escaping the content area, and cross-space access — each must fail.
- The **harness rebuild** as the final proof.

## Non-goals

- No in-app AI Tool builder (external agent over MCP is the authoring path).
- No open, ungated marketplace; no paid Tools.
- No Tool code compiled into the app build.
- No headless render/screenshot feedback to the authoring agent (compile errors + a `visvine-desktop://` preview deep link instead).
- No Tools on mobile.
- Tools never override the built-in person/space/event/resource pages.

## Context

## Codebase facts (verified)

- **Isolate runtime exists.** `apps/web/lib/connectors/isolate.ts` — `runInIsolate(perimeter, code, options)`; one QuickJS isolate per run, capabilities installed as globals via `installCapability(ctx, scope, name, pending, fn)` (`fetch`, `sql`, `sleep`, `__mcp*`), 64MB heap / 1MB stack / 256KB output, timeout clamped 1–120s (`SANDBOX_LIMITS` in `config.ts`), `MAX_CONCURRENT_RUNS = 4`. Capabilities are hardcoded today — Tools need an `extraCapabilities` option.
- **Perimeter gate** `lib/connectors/perimeter.ts`: `GatePerimeter {hosts, allow: AllowRule[], allowPrivate}`, `refuseHost`, `refusePath`; `AllowRule` = "METHOD /path*" parsed by `config.ts#parseAllowRule`. Tool perimeter is a sibling concept (note globs / types / connectors / agents), not hosts.
- **Notes must be `.md`** (`lib/notes/store.ts#assertMarkdown`). So Tool source lives as markdown notes whose body is one fenced code block: `tools/<name>/ui.md` (```tsx) and `tools/<name>/data.md` (```js). Authors see them as `ui.tsx` / `data.js` over MCP.
- **Note-as-config pattern**: connectors (`connectors/<name>.md`, admin-write via `contextService.writeDenial` lines ~236–265) and agents (`agents/<name>.md` + `agents/live/<name>.md`; store hooks in `lib/agents/hooks.ts` called from `lib/notes/store.ts` after write/rename/delete). Entity kinds + dirs in `lib/notes/entities.ts` (`ENTITY_DIRS`, `entityKindOf`), node ids `<kind>:<slug>`; entity folders `<ns>/<slug>/index.md` + siblings; `lockedDenial` freezes `agents/` for AI origins.
- **Custom (member-invented) types** are `NodeTypeConfig.scope: 'note'` in `Space.nodeTypes` — notes with that `type:` are plain context notes with NO graph node; they open at `/directory/note/<path>` (`app/(auth)/directory/note/[...path]/page.tsx`, tabs Context/Raw). Built-in entity types route through `app/(auth)/directory/[nodeId]/page.tsx#NodeRoute` (prefix switch). So a Tool-owned **type page for a custom type = a first tab on the note route**; for built-ins a Tool may only add a tab in NodeRoute.
- **Feature keys** `lib/featureAccess.ts`: `ALL_FEATURE_KEYS`, `CORE_FEATURE_KEYS`, `NAV_HIDDEN_FEATURE_KEYS`, `NODE_TYPE_FEATURE_KEYS`, `mergeFeatureConfig`, `sortFeatureKeys`, `moreFeatureKeys`. UI registry `features/shared/lib/features.tsx` (`FEATURES`, `railFeatures`, `moreFeatures`). Sidebar `features/shared/components/layout/Sidebar.tsx`; SpaceToolsPanel `features/admin/components/SpaceToolsPanel.tsx`; space DTO built in `lib/spaces/queries.ts` (`featureConfig` selected) → `SpaceContext.tsx` (`useSpace()`).
- **Navbar** `features/shared/components/layout/Navbar.tsx` right cluster: admin cog, context toggle, calendar (`/events?scope=discover`). Session exposes `isSuperAdmin` (`/api/auth/session`, `useSession()`).
- **Admin console** `app/(auth)/admin/page.tsx` sections array (general/tools/types/members/invite) + `renderSection` switch; `?section=` URL state.
- **MCP**: 17 tools in `lib/mcp/tools.ts` (`registerTool`), scopes in `lib/mcp/scopes.ts` (`TOOL_SCOPES`, `context:read/write`, `connectors:use`, `agents:run`), `withCtx(extra, toolName, fn)` in `lib/mcp/auth.ts`, route `app/api/mcp/route.ts`, `resolveTarget()` in `lib/mcp/context.ts`.
- **contextService** (`lib/notes/contextService.ts`): `readVisible`, `canReadPath`, `visibleVault`, `searchContext`, `writeGated`, `appendLogGated`, `moveGated`, `writeDenial`; principal via `principalOf(context)`; frontmatter via `lib/notes/shared/markdown.ts` (`parseFrontmatter`, `splitFrontmatter`, `joinFrontmatter`, yaml lib).
- **Agents**: brief parse `lib/agents/config.ts` (`parseAgentBrief`, `agentBriefPath`), manual run = POST `/api/internal/agents/run` (dispatch in `lib/agents/dispatch.ts`, runner `runner.ts`), MCP `run_agent` exists.
- **Prisma**: models `Space, ContextNote, ContextNoteRevision, ContextFolder, ConnectorSecret, AgentState, AgentRun, UserAlias, ContextGrant, Node, Link, User, SpaceMember…`; latest migration `20260817120000_agents`; convention `YYYYMMDDHHMMSS_name/migration.sql`, hand-written and commented.
- **Desktop**: UA carries `VisvineDesktop/<version>` (`apps/desktop/src/urls.ts#desktopUserAgent`); deep links `visvine-desktop://open/<path>` map to in-app paths generically (`deepLinkToPath`) — no desktop code needed for a preview deep link.
- **Deploy**: Cloud Run `visvine-web`, `australia-southeast1`, `--allow-unauthenticated`, prod URL `https://visvine.com`; `next.config.ts` sets CSP headers (`script-src 'self' 'unsafe-inline' 'unsafe-eval'`, `connect-src https:`), `serverExternalPackages` includes the QuickJS variant, `output: standalone`.
- **Deps**: `esbuild` absent (must add to `apps/web`); `playwright` only in `apps/desktop` devDeps; `yaml`, `zod`, `jose` present. Tests = `node --import tsx --test tests/*.test.ts`; verify scripts = `apps/web/scripts/verify-*.ts` calling services directly with a resolved owner principal.
- **Wayfinder data model** (`.wayfinder/tasks/*.md`): task frontmatter `id, title, status, kind, size, wave, depends_on[], touches[], model, effort` + `## Task` / `## Outcome` body; `plan.md` = Goal / Brief / Context / Plan sections.

## Decisions (settled with the human on 2026-08-18)

- **Desktop-only authoring is DROPPED.** Authoring (MCP + in-app) works on desktop and web; desktop only gains the `visvine-desktop://open/tools/preview/<name>` deep link, with a web URL fallback. Mobile still has no Tools.
- **Tool origin = subdomain + sandbox.** Prod `tools.visvine.com` → same Cloud Run service (human adds DNS + Cloud Run domain mapping; plan ships a runbook + `TOOLS_ORIGIN` env). Server refuses cookies and serves only `/api/tools/runtime/*` on that host. Local dev: app on `http://localhost:3000`, tools origin `http://127.0.0.1:3000` (different origin, same server, no cookie sharing). Iframe additionally uses `sandbox="allow-scripts"` (no `allow-same-origin`) + strict CSP (`default-src 'none'; script-src 'self'; connect-src 'none'; img-src 'self' data: blob: https://storage.googleapis.com; style-src 'self' 'unsafe-inline'; frame-ancestors <app origin>`).
- **Harness rebuild scope = board + agent dispatch**: goal/plan/waves/task board over notes (`harness/<project>/index.md` + `harness/<project>/tasks/<id>.md`), "Run" on a task writes/uses an agent brief and triggers a run via the existing agents feature; results write back to the task note.
- Tool source files stored as fenced-code markdown notes (see above); Tool node kind `tool` → dir `tools/`, node id `tool:<name>`; feature key `tools` (nav-hidden, gates the node type); each installed Tool is a dynamic rail row keyed `tool:<slug>` in `featureConfig.order/more`.
- Bridge topology: iframe ⇄ (postMessage) ⇄ host `ToolFrame` in the app page ⇄ (fetch, viewer session) ⇄ `POST /api/tools/bridge` — the iframe never holds a cookie; the server enforces perimeter + viewer grants + caps per call. `data.js` handlers run in the QuickJS isolate with the same bridge handlers installed as capabilities.
- Frame documents/bundles served under the tools origin are gated by a short-lived HS256 frame token (AUTH_SECRET) minted by the host page, so bundle URLs are not public.
- Tool bundles are ESM with `react`, `react/jsx-runtime`, `react-dom/client`, `@visvine/tool-kit` external, resolved by an import map in the frame document to vendor ESM files the server builds once with esbuild and caches.

## Plan

# Plan — User-created Tools

## Approach

Build Tools as the third note-first entity (after connectors and agents), reusing every existing seam: notes for storage/history/grants, the QuickJS isolate for `data.js`, `featureConfig` for rail placement, MCP for authoring, super-admin for review. New code lives in `apps/web/lib/tools/*` (pure + server), `apps/web/features/tools/*` (UI + the in-frame SDK/kit), a handful of routes, one Prisma migration, and MCP registrations in a new `lib/mcp/appTools.ts` wired from `tools.ts`.

**Runtime shape.** A Tool renders in `<iframe sandbox="allow-scripts">` whose document is served from the tools origin (`TOOLS_ORIGIN`, prod `https://tools.visvine.com`, dev `http://127.0.0.1:3000`) with a strict CSP (`connect-src 'none'`). The frame boots a tiny runtime that mounts the Tool's compiled ESM bundle (React + `@visvine/tool-kit` via import map → server-built vendor ESM) and talks **only** by postMessage to the host `ToolFrame` component in the Visvine page. The host forwards bridge calls to `POST /api/tools/bridge` with the viewer's session; the server checks the Tool's declared perimeter, then reads/writes through `contextService` under the viewer's own principal, with row/byte caps and rate limits. `data.js` handlers run in the isolate with the same bridge handlers installed as capabilities. Failures render an in-pane error card.

**Storage.** `tools/<name>/index.md` (frontmatter config + docs body), `tools/<name>/ui.md` (single ```tsx fence), `tools/<name>/data.md` (single ```js fence). Notes must be `.md`, so authors address them as `ui.tsx`/`data.js` over MCP and the service wraps/unwraps. A store hook compiles on every write (esbuild) into `app_tool_builds`; compile errors come back on the write. Frontmatter:

```yaml
type: tool
title: Deal Pipeline
description: Kanban over deal notes
version: 3            # bumped by publish
surfaces:
  rail: { label: Deals, icon: kanban }          # optional rail item + full page
  types: [{ type: deal, mode: page }]           # page for custom types, or mode: tab on built-ins
perimeter:
  read:  ["deals/**", "people/*/index.md"]      # note globs
  write: ["deals/**"]
  types: [deal]
  connectors: [hubspot]
  agents: ["deal-*"]
```

**Registry.** `app_tool_versions` (global, immutable snapshot: author, source space, config, perimeter, sources, bundle, review status), `app_tool_submissions` (queue for super-admins), `app_tool_installs` (space-scoped, pinned version, enabled, requirements snapshot, type-page claims). Publish → pending → super-admin approves in `/admin?section=review` (perimeter + code diff vs previous) → browsable in `/tools`; admins install (requirements checklist; runs degraded when unmet); upgrades are admin-approved and show the perimeter diff.

**Surfaces.** Navbar icon next to the calendar → `/tools` (Browse / Installed / Mine). Each install adds a rail row `tool:<slug>` → `/t/<slug>` full-pane page. Tool-owned type pages: for member-invented types, a first tab on `/directory/note/<path>`; for built-ins, an extra tab in `NodeRoute`. `/directory/tool:<name>` shows the author's Tool tab (build status, perimeter, preview, publish) + Context/Raw. Preview at `/tools/preview/<name>` (deep link `visvine-desktop://open/tools/preview/<name>`).

## Waves

**Wave 1 — foundations (pure/server, all parallel).** Tool config/paths/source-wrapping + perimeter matcher; esbuild compile pipeline; Prisma models + migration; `tool` entity kind + `tools` feature key + dynamic `tool:<slug>` rail keys; isolate `extraCapabilities`; tools-origin gate (proxy host split, CSP, frame token); bridge protocol types + in-frame SDK + UI kit + SDK `.d.ts`/guide text.

**Wave 2 — services (build on wave 1).** Build hooks + tool service (working copies); server bridge + `data.js` runner + `/api/tools/bridge` route + limits; registry library (publish/review/install/upgrade/requirements); runtime routes (frame doc, bundle, vendor ESM); host `ToolFrame` client + shared PerimeterSummary/CodeDiff components.

**Wave 3 — surfaces.** Registry + install REST routes; MCP authoring tools + scopes; sidebar rail rows + `/t/[slug]` page + SpaceToolsPanel ordering; `/tools` marketplace UI + navbar icon; author node page + preview page; admin review section; docs + runbook + env.

**Wave 4 — type pages + verification.** Data-driven type-page dispatch (note route + NodeRoute + TypesPanel); scripted end-to-end verify (author over MCP → install → render → write); adversarial escape suite (node + Playwright).

**Wave 5 — acceptance.** The Wayfinder Tool (source under `examples/tools/wayfinder/`, seeded through the MCP handlers, installed, board + agent dispatch).

**Wave 6 — proof + close.** Verify script for the Wayfinder Tool; final repo audit (typecheck/lint/test/knip zero, docs current).

## Verification commands

- `pnpm --filter @visvine/web exec tsc --noEmit` · `pnpm lint` · `pnpm test` (Node test runner; new files `apps/web/tests/tools-*.test.ts`) · `pnpm --filter @visvine/web exec knip` (must stay zero).
- `pnpm db:migrate` applies the new migration on the local Docker DB.
- `pnpm --filter @visvine/web exec tsx scripts/verify-tools-e2e.ts` (dev server on :3000, `TOOLS_ORIGIN=http://127.0.0.1:3000`).
- `pnpm --filter @visvine/web exec tsx scripts/verify-tools-escape.ts` (Playwright against the dev server).
- `pnpm --filter @visvine/web exec tsx scripts/verify-wayfinder-tool.ts`.

## Risks

- **esbuild in Cloud Run standalone**: add to `serverExternalPackages` (native binary), verify `next build` traces it. Vendor ESM built at first request and cached in-process; cold-start cost is bounded (~1s).
- **`connect-src 'none'`** means Tools cannot load remote images except the allowed GCS host — accepted for v1 (exfil control).
- **Sandbox without `allow-same-origin`** blocks `localStorage`; the SDK offers `visvine.state` (per-install KV in the bridge) instead — small, documented.
- **Prod origin needs human ops** (DNS + domain mapping); until done, `TOOLS_ORIGIN` unset falls back to same-origin + sandbox with a logged warning, never a hard failure.
- **`featureConfig` whole-value PUT hazard**: dynamic `tool:<slug>` keys must ride `mergeFeatureConfig`; the rail task adds tests.
- **Note store `.md` invariant** honoured by storing sources as fenced markdown; the compile hook must be idempotent and never write notes itself.
- **Isolate concurrency (4)** shared with connectors/agents — bridge `data.call` is rate-limited per install and viewer.

## Notes


