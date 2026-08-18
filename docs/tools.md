# Tools

User-built mini-apps that run inside a Visvine space: a member (or a vibe-coding
agent working on their behalf) authors a Tool as a note, it renders in the main
content area over the space's own context, and — once published and reviewed —
other spaces can install it. This page is the author, operator and admin guide;
the design decisions it records were made in the Tools planning map (2026-08-18).

**The quotable security property.** A Tool's UI runs in a sandboxed iframe on a
**separate, cookie-less origin** and can reach Visvine **only** by posting a
message to a bridge that re-checks the viewer's own grants on every call. A
Tool's declared reach can only **narrow** what its viewer could already see —
never widen it. Two members with different grants running the same Tool see
different data, and that is correct.

Users say "Tool"; code says `AppTool` / `tools/` to disambiguate from built-in
tools (Channels, Resources, …) and from MCP tools.

## A Tool is a folder of notes

| Path | Who writes | Holds |
|---|---|---|
| `tools/<name>/index.md` | any member (normal grants) | the **config**: `type: tool`, `title`, `description`, `version`, `surfaces`, `perimeter`; the body is author-facing docs |
| `tools/<name>/ui.md` | any member | the UI source — one fenced ` ```tsx ` block, addressed as `ui.tsx` |
| `tools/<name>/data.md` | any member | the optional data source — one fenced ` ```js ` block, addressed as `data.js` |
| `app_tool_builds` row | derived, never authoritative | the compiled bundles + diagnostics from the last write |

`tools/<name>` is an **entity folder** (`lib/notes/entities.ts`), and `tools/<name>/index.md`
is that folder's index — a directory node `tool:<name>` stands behind it, same as
`connector:<name>` and `agent:<name>`. The note store only accepts `.md`
(`lib/notes/store.ts#assertMarkdown`), so `ui.tsx` and `data.js` don't exist as
files — they are the code inside `ui.md`/`data.md`'s single fenced block, and
`lib/tools/config.ts#wrapSource`/`unwrapSource` do the wrapping. Authors never
see the wrapper: over MCP and in the author UI the files are named `ui.tsx` and
`data.js`, and the service wraps and unwraps around them (`lib/tools/service.ts`).

There is no admin-only write clause on `tools/`, unlike `connectors/` — a Tool
cannot do anything its own viewer's grants wouldn't already allow, so authoring
is exactly like authoring any other note. Writes are stamped with the human
origin `edit`, never `agent`: `tools/` is frozen for AI origins
(`contextService.lockedDenial`), precisely so an autonomous sweep can never
rewrite executable code — a person driving an authoring agent over MCP is
authoring, not sweeping.

### Frontmatter reference

```yaml
# tools/deal-pipeline/index.md
---
type: tool
title: Deal Pipeline
description: Kanban over deal notes
version: 3                                   # bumped by publish; 0 = never published
surfaces:
  rail: { label: Deals, icon: kanban }       # sidebar row + full page, or null for neither
  types: [{ type: deal, mode: page }]        # page or tab on a context type's page
perimeter:
  read:  ["deals/**", "people/*/index.md"]
  write: ["deals/**"]
  types: [deal]
  connectors: [hubspot]
  agents: ["deal-*"]
---
What this Tool is for, in a paragraph or two — author-facing docs, not config.
```

- `surfaces.rail.icon` is one of a named set (`lib/tools/config.ts#TOOL_RAIL_ICONS`:
  `grid`, `kanban`, `list`, `table`, `calendar`, `chart`, `note`, `folder`, `people`,
  `sparkle`) — real icon components from the app's own set, so a marketplace Tool
  can't render a hole in the sidebar chrome it isn't allowed to touch.
- `surfaces.types` entries are `{ type, mode }` or a bare type name (⇒ `mode: tab`).
  `mode: page` is refused outright at parse time for a built-in type
  (person/space/event/resource/section/channel/connector/agent/tool/index) —
  see [Type pages](#type-pages) for what actually happens at install time.
- `perimeter` is five deny-by-default lists (`lib/tools/perimeter.ts`): `read`/`write`
  are context-note globs, `types`/`connectors`/`agents` are name lists. **Empty
  means none** — a Tool that declares nothing can only draw its own UI.

**Glob grammar**, kept deliberately small so a reviewer reading `deals/**` in a
note knows exactly what it covers:

- paths are context-relative and POSIX (`deals/acme/index.md`);
- a single `*` matches within one segment — `people/*/index.md` covers
  `people/ana/index.md` but not `people/ana/notes/index.md`;
- `**` as a **whole segment** crosses segments — trailing (`deals/**`) means
  everything below; in the middle (`people/**/index.md`) means any depth
  including none;
- a trailing `/` (`deals/`) is shorthand for that folder and everything below it;
- `?` is not a wildcard.

**Name-list grammar** (`types`/`connectors`/`agents`): a bare name, a prefix
like `deal-*`, or `*` for all of them.

**The perimeter narrows; it never widens.** It is authorization's *subtractive*
half, checked before the viewer's own grants, and can only refuse — never
grant — what `contextService` would otherwise allow. A Tool declaring
`read: ["**"]` still sees exactly what its viewer sees, nothing more.
`lib/tools/perimeter.ts#refuseRead/refuseWrite/refuseType/refuseConnector/refuseAgent`
are the five gates every surface (bridge, isolate, review UI, install checklist)
calls — never a second copy of the rule, so a denial always quotes the same
declaration a reviewer read.

Three namespaces are **sealed against Tool writes**, whatever a perimeter
declares: `tools/`, `agents/`, `connectors/` hold configuration that *runs*, and
a Tool that could write them could grant itself unreviewed reach — see
`lib/tools/bridge.ts#SEALED_WRITE_DIRS`. This binds admins too; it is not merely
`writeDenial`'s member gate.

**The one exception: creating an agent brief the Tool named.** A Tool may
`context.write` a note at `agents/<name>.md` when its own `perimeter.agents`
names that agent — a bare `*` does not count, a prefix like `wayfinder-*` does.
Everything else in the three namespaces stays sealed, including `agents/live/**`
(the activation), `context.append` anywhere under `agents/`, and any path a Tool
did not declare an agent for.

The brief is not the thing that runs. `contextService#writeDenial` guards
`agents/live/` and nothing else, precisely because ACTIVATION is what puts an
agent on the space's model key and that stays a space admin's decision; a
Tool-written brief is something an admin can read and approve, and `claimManualRun`
refuses an inactive agent, so `agents.run` on it does nothing until they do.

**Create, never change.** An existing brief is refused: the admin who activated an
agent approved a specific brief, and `lib/agents/hooks.ts` (rule 2) deliberately
exempts admins from the auto-deactivate that catches a member's edit — so a Tool
allowed to rewrite briefs could swap an approved agent's instructions while an
admin was viewing it, and reach connectors it never declared. A Tool has no delete
and no move, so it cannot free the path either. See
`lib/tools/bridge.ts#agentBriefExemption`; the rule is exercised by
`tests/tools-bridge.test.ts` and the escape suite.

## Authoring loop (over MCP)

An authoring agent (Claude Code, Cursor, …) works entirely through Visvine's
**creator MCP server** — there is no in-app AI Tool builder. Visvine runs two MCP
servers (`lib/mcp/config.ts#MCP_SERVER_KINDS`), each its own OAuth protected
resource with its own token audience:

| Server | URL | Carries |
|---|---|---|
| **Visvine** (context) | `/api/mcp` | Everything about the space's context — read/search/write, connectors, agents — plus Tool **discovery and activation**: `list_tools`, `install_tool`. |
| **Visvine Creator** | `/api/mcp/creator` | `list_spaces` plus the **authoring loop**: `get_tool_sdk`, `create_tool`, `read_tool`, `write_tool`, `check_tool`, `preview_tool`, `publish_tool` (and `list_tools`, so an author can see what exists). |

Both addresses are shown in Settings → MCP (`/api/mcp/connect-info`). A token
minted for one server is refused by the other (`aud`), so an everyday "help me
with my notes" connection never carries the surface that writes executable code
into a space, and a coding agent pointed at the creator cannot read the space's
notes beyond the Tools themselves. The tool group lives in `lib/mcp/appTools.ts`
(`registerAppTools(server, surface)`), registered from `lib/mcp/tools.ts`
(`registerTools` for the context server, `registerCreatorTools` for the
creator), and every handler goes through `resolveTarget(ctx, space_id, scope)`
— the same space-selection seam every other MCP tool uses — so a Tool's notes
obey the caller's real grants.

| MCP tool | Server | Scope | Does |
|---|---|---|---|
| `get_tool_sdk` | creator | `context:read` | Returns `TOOL_AUTHOR_GUIDE` + `TOOL_KIT_DTS` (`lib/tools/sdkDocs.ts`) and the bridge method list — read this once before writing anything. |
| `list_tools` | both | `context:read` | Authored Tools in the space (with build status) plus installed Tools. |
| `read_tool` | creator | `context:read` | One Tool's `index.md`/`ui.tsx`/`data.js` (unwrapped) + parsed config + build diagnostics. |
| `create_tool` | creator | `tools:author` | Creates the entity folder + scaffolds (`lib/tools/service.ts#createTool`); returns the file list, the preview deep link and web URL, and a pointer to `get_tool_sdk`. |
| `write_tool` | creator | `tools:author` | Writes one of the three files (`writeToolFile`); the response **always** carries the fresh build result. |
| `check_tool` | creator | `tools:author` | Rebuilds and returns a lint report: config errors, compile diagnostics, `describePerimeter`, `computeRequirements` against this space, and warnings (empty perimeter, a downgraded page claim, a missing description). |
| `preview_tool` | creator | `tools:author` | The two preview URLs again, plus current build status — no rendering happens over MCP. |
| `publish_tool` | creator | `tools:author` | `publishTool` — admin-only; explains the review gate in its response. |
| `install_tool` | context | `tools:install` | `installVersion` — admin-only; returns the install plus any type-claim conflicts and unmet requirements. |

Every scope is declared in `lib/mcp/scopes.ts#TOOL_SCOPES`, the single source
both servers check before dispatch and reply `insufficient_scope` for. Which
server a tool sits on is decided in `registerAppTools` and pinned by
`tests/mcp-scopes.test.ts`. Each server also has its own scope **ceiling**
(`scopesForKind`): the creator advertises, hints (401 `scope=`) and negotiates
only `context:read tools:author`, so a Tool-authoring connection is never asked
to consent to writing notes, calling connectors, running agents or installing
Tools; a request that survives with no scope at all is refused `invalid_scope`.
Grants remember their server (`resource` column, CHECK-constrained), and an
unknown value is refused rather than treated as the context server.

### The write → diagnostics cycle

`write_tool` is the loop an authoring agent actually iterates on: write
`ui.tsx`, get the fresh build back, fix, repeat. A write goes through
`writeGated` under the caller's own principal (grants, restricted folders and
`writeDenial` all apply exactly as they do to any note) and then rebuilds
through the compile-on-write hook (`lib/tools/hooks.ts` → `lib/tools/builds.ts#rebuildTool`,
wired into `lib/notes/store.ts` beside the agent hooks at every write/rename/delete
site). Nothing throws for a bad Tool — a bad paste, a missing default export, an
unparseable frontmatter block all come back as diagnostics on the same response,
formatted `ui.tsx:12:5 message` (`lib/tools/builds.ts#toolDiagnosticLine`), never
as a 500. `ok` is narrow: the config must parse **and** `ui.tsx` must compile;
`data.js` is optional but a present-and-broken one still fails the build, and a
failed build stores **no bundle** — half a Tool is never servable.

### Preview

`create_tool`/`preview_tool` return two URLs for the working copy, before
anything is published:

- the **desktop deep link** `visvine-desktop://open/tools/preview/<name>`
  (resolved generically by `apps/desktop/src/urls.ts#deepLinkToPath` — no
  desktop-specific code needed);
- the **web URL** `${appOrigin}/tools/preview/<name>`.

There is no headless render/screenshot feedback loop to the authoring agent —
compile diagnostics plus a live preview link is the whole loop.

### Publish → review → install → upgrade

1. **Publish** (`publish_tool` / `lib/tools/registry.ts#publishTool`, space admin
   only) snapshots the working copy — config, perimeter, all three sources, both
   compiled bundles — into an immutable `AppToolVersion` row and queues it
   `pending`. Refuses a working copy that doesn't compile, and refuses a second
   pending version for the same Tool (withdraw the first). Version numbers count
   from 1 and never repeat, even across a rejection.
2. **Review** is a **Visvine super-admin** act (`isSuperAdmin`, env-driven —
   this is the one queue in the app that is not space-scoped). They see the
   declared perimeter and a code diff against the last approved version
   (`lib/tools/registry.ts#perimeterDiffForVersion`) and approve or reject.
   Approving flags every install pinned to an older version with an offered
   upgrade; it never changes what's running anywhere.
3. **Install** (`install_tool` / `lib/tools/installs.ts#installVersion`, space
   admin only) pins the approved version, picks a free slug
   (`deals` → `deals-2` on a clash), and resolves the declared type surfaces
   against the space (see [Type pages](#type-pages)). **Unmet requirements never
   block an install** — the Tool installs degraded behind a checklist; see
   [Degraded mode](#degraded-mode).
4. **Upgrade** (`applyUpgrade`, space admin only) moves an install onto the
   version a review approved, after the admin reads the perimeter diff. This is
   the *only* way a space's Tool code ever changes — publishing a new version
   never touches an install by itself.

## Runtime architecture

### Tools origin

A Tool is third-party code. Its iframe document is served from a **separate,
cookie-less origin** — `TOOLS_ORIGIN` — so that even a total CSP/sandbox escape
lands on a host with no `auth_session` cookie and no app route to hit
(`lib/tools/origin.ts`):

```
prod   TOOLS_ORIGIN=https://tools.visvine.com   (same Cloud Run service, a
       domain mapping the operator adds — see "Ops runbook" below)
dev    TOOLS_ORIGIN=http://127.0.0.1:3000       (same dev server as
       http://localhost:3000, but a different origin, so cookies scoped to
       localhost are neither sent nor readable)
```

Unset is a supported fallback, not a failure: `frameUrl()` serves the frame
same-origin with the app (still `sandbox="allow-scripts"` + the same strict
CSP) so the feature works before DNS is set up. `toolsHostDecision(host, path)`
is the whole proxy split as one pure function: `app` (carry on normally),
`tool-runtime` (a runtime path on the tools host — served unauthenticated, the
frame token is the credential), `not-found` (anything else on the tools host —
it must **never** serve the app, a page, or a session-bearing API).

### Sandbox + CSP

The iframe is `sandbox="allow-scripts"` — **no** `allow-same-origin`, so the
frame's own origin is the opaque `null`. On top of that, `lib/tools/csp.ts#frameCsp`
sends:

- `connect-src 'none'` — no fetch, no XHR, no WebSocket. A Tool's only way out
  is postMessage to the host page, which forwards to `/api/tools/bridge` under
  the viewer's session. This is the exfiltration control: a Tool that can read a
  note cannot ship it anywhere on its own.
- `script-src 'self'` (plus a per-response nonce for the frame document's two
  inline scripts — the import map and the boot module, which have no reliable
  external form) — only the compiled bundle and the server-built vendor ESM,
  never a CDN, never `eval`.
- `frame-ancestors <app origin>` — only the Visvine app may embed the frame, so
  a leaked frame URL is useless on its own.

### Frame token

The frame's document and its bundle can't authenticate with a session (no
cookie on that origin), so the **host page** — which does have the viewer's
session — mints a short-lived, single-purpose HS256 token
(`lib/tools/frameToken.ts`, audience `visvine-tool-frame`, 300s default TTL,
signed with `AUTH_SECRET`) naming which Tool the frame may load (`install` or
`preview`) and who is watching. The token carries no permissions of its own —
every real read or write still goes through the bridge under the viewer's own
grants — its only job is to keep bundle URLs from being public and tell the
runtime routes *which* bundle to serve.

Runtime routes, all under `/api/tools/runtime/` (`TOOL_RUNTIME_PATH_PREFIX`):

| Route | Serves |
|---|---|
| `GET /api/tools/runtime/frame?token=` | The frame's HTML document, or a 403/error card. |
| `GET /api/tools/runtime/bundle/[id]` | The compiled `ui.tsx` bundle for the token's Tool — a token for one Tool 403s on another's bundle id. |
| `GET /api/tools/runtime/vendor/[file]` | The four vendor ESM modules (public, no token: `react.js`, `react-jsx-runtime.js`, `react-dom-client.js`, `tool-kit.js`). |

### The bridge — the only door

`POST /api/tools/bridge` (`lib/tools/bridge.ts`) is the single path from a
running Tool to real Visvine data, called by the host page under the viewer's
own session and never by the frame directly. Three rules hold for every
method:

1. **Auth is always the viewer's own principal** — never the Tool's, never the
   author's.
2. **The perimeter only narrows**, checked before the grant check.
3. **Nothing throws.** Every refusal is a `BridgeError { code, message }` the
   SDK can branch on and render safely in the Tool's own pane.

Methods (`lib/tools/protocol.ts#BridgeMethods`):

| Method | Does |
|---|---|
| `context.list` | List note metadata under an optional glob, perimeter- and grant-filtered. |
| `context.read` | One note's body + parsed frontmatter. |
| `context.search` | Ranked search over what the viewer can read, perimeter-filtered after ranking. |
| `context.write` / `context.append` | Write/append a `.md` note — refused for `tools/`, `agents/`, `connectors/`, except that `write` may CREATE the brief of an agent the perimeter names (see [Frontmatter reference](#frontmatter-reference)). |
| `connectors.call` | Run a declared connector, exactly the path `run_connector` uses. |
| `agents.run` | Trigger a declared, active agent (author-or-admin, dispatched not awaited). |
| `data.call` | Call a `data.js` handler in the isolate. |
| `state.get` / `state.set` | Per-install key/value store (there is no `localStorage` in the sandbox). |
| `subject.get` | What the Tool is being shown about (set by the host on a type page; null otherwise). |

`data.call` and `subject.get` are the two methods **not** re-exposed as isolate
capabilities (`bridgeCapabilities`) — a handler calling `data.call` would nest
isolates, and `data.js` gets `subject` as a plain global instead.

### Limits

`BRIDGE_LIMITS` (`lib/tools/protocol.ts`) — enforced server-side, documented to
authors verbatim via `TOOL_AUTHOR_GUIDE` so the numbers in the SDK guide are the
numbers the server enforces:

| Limit | Value |
|---|---|
| Rows per `context.list`/`context.search` | 200 |
| Bytes per `context.read` | 256,000 |
| Bytes per `context.write`/`context.append` | 128,000 |
| Bytes of `params` per call | 64,000 |
| Calls per minute, per viewer per install | 120 |
| `data.call` wall clock | 20s |

Plus two in-process throttles (`lib/tools/limits.ts`) on top of the isolate's own
caps: a sliding-window rate limit per `(viewer, install)`, and a `data.call`
concurrency cap of **2 per install** against the isolate's `MAX_CONCURRENT_RUNS`
of 4 — a chatty Tool can't starve connectors and agents of isolate slots. And
`TOOL_BUNDLE_LIMITS` (`lib/tools/compile.ts`), the compile-time ceiling:
512,000 bytes of source, 1,000,000 bytes of compiled bundle (JSX expands 2-5×),
10s compile timeout.

`state.set` has two caps of its own (`lib/tools/state.ts`): **16 KB** per
serialized value (`STATE_MAX_BYTES`) and **100 keys** per install
(`STATE_MAX_KEYS`). Past the key cap an *install* refuses the new key —
evicting a row an installed Tool relies on would be silent data loss, where a
refusal reaches the author through the bridge — while a *preview*, which has no
author watching, drops its least-recently-written key instead. The smallness is
the point: state is for UI preferences, not for space data, which belongs in
context notes where the space can search, share and audit it.

### Audit trail

Every Tool act a person can be held to writes an audit line (`action: 'tool'`,
`logAudit`): publish, review verdict, install, upgrade, uninstall
(`registry.ts`, `installs.ts`) and every bridge `context.write`/`context.append`
(`bridge.ts`), the last detailed `tool:<name> write` — or `tool:<name>
(preview) write` — because the note store has no `tool` origin of its own to
carry it. Note writes are additionally stamped with the **viewer's** identity,
not the author's, since the viewer is who the write actually ran as.

### `data.js` in the isolate

`data.js` runs in the **same QuickJS isolate** connectors and agents use
(`lib/connectors/isolate.ts`), with `fetch`/`sql`/`mcp` omitted entirely — a
Tool's only egress is a declared connector, which is reviewable and
secret-bearing; a raw `fetch` would let any installed Tool ship space data
anywhere with nothing in the frontmatter to show for it. The bridge's own
handlers are installed as isolate capabilities instead
(`lib/tools/dataRun.ts` + `lib/tools/bridge.ts#bridgeCapabilities`), so
`visvine.context.read(path)` means the same thing in `ui.tsx` and `data.js` —
same perimeter, same refusals, no server-side path a browser-side one lacks.
Author-facing shape: `handlers.<name> = async (args, visvine) => { … }`, called
from the UI with `visvine.data.call('<name>', args)`.

### Degraded mode

A Tool's perimeter names connectors/types/agents by **name**, and those names
travel through the marketplace into spaces that may not have a matching one. A
missing dependency **never blocks an install** — the Tool installs, an admin
sees a checklist (`describeRequirements`), and the install runs behind a
banner: unsatisfied `connectors.call`/`agents.run` come back as the `degraded`
error code instead of `not_found`, and the SDK's `visvine.degraded` tells the
UI what's missing so it can say so instead of silently rendering nothing. `*`
alone is never a requirement (it asks for a capability, not a specific thing);
`deal-*` is satisfied by one match. Adding the missing piece doesn't clear the
banner automatically — an admin re-checks (`refreshRequirements`), because a
sweep on every connector/type/agent write would put a table write in the path
of every note save.

### Error card

Anything that keeps a frame from rendering — a bad or expired token, an install
that's missing or disabled, a working copy that fails to compile — answers with
`renderFrameErrorDocument` (`lib/tools/frameDocument.ts`): a script-free HTML
card listing the author's own diagnostics (`line 12:4`, the offending source),
served under the same CSP with or without a nonce. A Tool is never allowed to
render as a blank, broken app shell.

## Surfaces

### Rail row + `/t/<slug>`

An install with `surfaces.rail` set gets a sidebar row (rail key `tool:<slug>`,
`lib/featureAccess.ts#toolRailKey` / `TOOL_RAIL_KEY_PREFIX`) and a full-pane
page at `/t/<slug>`. The rail key rides the space's existing `featureConfig`
machinery (`order`/`more`/`adminOnly`) through `mergeFeatureConfig`, so admins
reorder or hide an installed Tool exactly like a built-in feature — installing
never silently reorders the front door: an empty `order` is materialised as the
registry order *first*, with the new Tool appended after it. `tools` itself
(the feature key that gates the Tool node type and the `/tools` marketplace) is
nav-hidden — it has no rail row of its own, reached only from the marketplace
icon in the navbar.

Turning `tools` off for a space is a **real** switch, not a hidden nav row:
every door re-asks it server-side. `resolveBridgeTarget` (`lib/tools/target.ts`)
checks it before any perimeter or config work, which covers both the bridge and
the frame-token route for installs *and* previews; the MCP authoring and install
handlers check it (`lib/mcp/appTools.ts`); and the rail rows and `/t/<slug>`
drop out with it, so a space that switches Tools off is never left with a row
that renders a failing frame.

### Type pages

The profiles / space pages / event pages analogy: a Tool can own the page for a
context type. `surfaces.types` entries claim `mode: page` or `mode: tab`,
resolved against the installing space by `lib/tools/installs.ts#resolveTypeClaims`:

- **Built-ins win.** `mode: page` is only ever granted for a **member-invented**
  type (`NodeTypeConfig.scope: 'note'`). A page claim on person/space/event/
  resource — or on a type the space doesn't even have — is **downgraded** to a
  tab rather than refused: the Tool still gets a surface, it just can't replace
  a member's profile or a space's home page.
- **One page per type.** If another install already owns a type's page, the
  claim is left out entirely and reported as a conflict naming the holder's
  slug — auto-granting would silently swap out a page somebody is using, and
  auto-tabbing would look like it worked when it didn't.
- **Admin picks.** Conflicts and downgrades come back from install/upgrade for
  an admin to resolve explicitly (`setTypeClaims`) — never auto-resolved.

## Permissions

| Act | Who |
|---|---|
| Author (`create_tool`, `write_tool`, edit any of the three notes) | Any member with normal grants — no admin gate on `tools/` |
| Publish (`publish_tool`) | Space admins (`isAdmin`) |
| Install / upgrade / enable / uninstall / type claims | Space admins (`isAdmin`) |
| Review a pending version | Visvine **super-admins** only (`isSuperAdmin`, env-driven `SUPER_ADMIN_EMAILS`) — the one queue in the app that is not space-scoped |

This mirrors agents: member-writable brief, admin-gated activation.

## Ops runbook

### `TOOLS_ORIGIN`

Already documented in `apps/web/.env.example`. Local dev needs nothing beyond
the default:

```
TOOLS_ORIGIN=http://127.0.0.1:3000
```

`127.0.0.1` is a different origin from the `localhost` the dev server answers
on, so the session cookie is neither sent nor readable there — that's the whole
isolation story locally, no DNS required.

### Production setup

Until the domain mapping exists, `TOOLS_ORIGIN` should stay **unset** in
production: the app falls back to the same-origin sandbox automatically (still
`sandbox="allow-scripts"` + the full CSP, just weaker host isolation), never a
hard failure.

**`TOOLS_ORIGIN` has to be a BUILD-time value, not just a runtime one.**
`next.config.ts#headers()` runs once, at `next build` time, and its output is
baked into `.next/routes-manifest.json` — the standalone production server
(`server.js`) serves headers straight from that file and never re-evaluates
`next.config.ts` per request (unlike `next dev`, which does, on every
request). So setting `TOOLS_ORIGIN` only as a Cloud Run *runtime* env var
(`--set-env-vars`, after the image already exists) has no effect on
`frame-src` at all — the CSP baked into the image at build time is whatever
was, or wasn't, in the shell that ran `next build`. Confirmed locally by
building this app twice, with and without `TOOLS_ORIGIN`, and diffing
`routes-manifest.json`'s `frame-src` between the two.

`deploy.yml` and the root `Dockerfile` already carry the plumbing for this —
`docker build --build-arg TOOLS_ORIGIN=...` sets it as a build-time `ENV`
before `next build` runs, and the same value also rides `--set-env-vars` on
the Cloud Run deploy step (the proxy's host split and `frameUrl()` read it at
*runtime* too, so both matter). Both draw from one place: the GitHub Actions
repository variable `TOOLS_ORIGIN`. To turn on the separate origin, it is a
**single checklist**, not two unrelated changes:

```sh
# 1. DNS: CNAME tools.visvine.com to Cloud Run's mapping target.
#    (gcloud prints the exact target — usually ghs.googlehosted.com; follow
#    the instructions it gives rather than hardcoding it, they occasionally change.)

# 2. Map the domain to the SAME Cloud Run service the app runs on — there is
#    no second service, the host split happens inside the app (lib/tools/origin.ts).
gcloud run domain-mappings create \
  --service visvine-web \
  --domain tools.visvine.com \
  --region australia-southeast1 \
  --project visvine-platform

# 3. Set the TOOLS_ORIGIN repository variable (Settings → Secrets and
#    variables → Actions → Variables → New repository variable). It is not a
#    secret — it's a public hostname — so it's a variable, not a secret:
gh variable set TOOLS_ORIGIN --body "https://tools.visvine.com"
#    No YAML edit needed: the next push to main builds the image with
#    --build-arg TOOLS_ORIGIN=<that value>, deploys with the matching
#    --set-env-vars, and a "Verify TOOLS_ORIGIN survived the build" step fails
#    the deploy outright if the built image's frame-src doesn't name it —
#    the CI equivalent of the diff described above, run on every deploy
#    instead of by hand.
```

**Verify** (once the mapping has propagated — can take a few minutes):

```sh
curl -sI https://tools.visvine.com/directory                        # expect 404 — the tools host must never serve the app
curl -sI https://tools.visvine.com/api/tools/runtime/vendor/react.js  # expect 200, text/javascript
```

The first curl is the important one: it proves `toolsHostDecision` is really
splitting the host, not just answering the app on a second name. To check
`frame-src` itself without waiting on DNS, inspect the response headers on any
page: `curl -sI https://visvine.com/ | grep -i content-security-policy` must
show `frame-src 'self' https://tools.visvine.com`, not `frame-src 'self'`
alone — the latter means the image was built without `TOOLS_ORIGIN` (the CI
gate above exists so that should never reach prod, but this is the direct
check if it ever does).

### Local dev

```
TOOLS_ORIGIN=http://127.0.0.1:3000
```

Vendor ESM (`react.js`, `react-jsx-runtime.js`, `react-dom-client.js`,
`tool-kit.js`) is built on demand by esbuild in dev
(`lib/tools/vendorBundle.ts`) and memoised per process. In production the same
four files are prebuilt by `scripts/build-tool-vendor.ts` (wired into
`apps/web`'s `build` script) into `public/tool-runtime/`, because Next's
standalone output tracer cannot reach `react-dom`'s client entry through
pnpm's `node_modules` symlink — `vendorBundle.ts`'s file comment has the full
story if that ever needs revisiting.

## Verification

```sh
pnpm --filter @visvine/web exec tsc --noEmit
pnpm lint
pnpm test                                    # apps/web/tests/tools-*.test.ts
pnpm --filter @visvine/web exec knip
pnpm db:migrate                              # applies the app_tool_* migration locally
```

Live, scripted checks, in the style of the connector and agent verifications —
they resolve a real principal and drive the services directly. **All three need
a dev server on `:3000`** (`pnpm dev`), because they also exercise the runtime
routes over real HTTP; the last two additionally drive Chromium through
Playwright. Each is a `pnpm --filter @visvine/web` script:

```sh
pnpm --filter @visvine/web verify:tools           # author over MCP → publish → review → install → frame + bridge write
pnpm --filter @visvine/web verify:tools:escape    # adversarial: undeclared reads, cookie theft, content-area escape, cross-space
pnpm --filter @visvine/web verify:wayfinder-tool  # the acceptance Tool: board renders, writes, agent dispatch
```

`verify:tools:escape`'s first step is a standalone guard against the
build-vs-runtime `TOOLS_ORIGIN` trap described in "Production setup": if
`apps/web/.next/routes-manifest.json` exists (this checkout ran `pnpm build`,
not just `pnpm dev`) and `TOOLS_ORIGIN` is set in the shell, it fails unless
the manifest's baked `frame-src` names that origin. No manifest on disk — the
common case, a plain `pnpm dev` checkout — is a SKIP, not a failure.

`verify:tools` and `verify:tools:escape` remove every row and note they create,
leaving the shared dev DB as they found it. `verify:wayfinder-tool` instead
leaves its seed in place and is idempotent — re-running it is the supported way
to get back to a known board.

> **Local gotcha.** If this box's `apps/web/.env` still carries a
> `CLOUD_SQL_CONNECTION_NAME` from a `dev:cloud` session,
> `scripts/guard-local-db.mjs` refuses on sight even when `DATABASE_URL` points
> at Docker. Prefix the run with `CLOUD_SQL_CONNECTION_NAME= ` to clear it for
> that command rather than editing `.env`.

## Code map

`lib/tools/{config,perimeter,protocol,compile,builds,hooks,service,target,bridge,
dataRun,limits,state,requirements,registry,installs,origin,csp,frameToken,
frameDocument,vendorBundle,sdkDocs}.ts`, runtime routes under
`app/api/tools/runtime/*` and `app/api/tools/{bridge,frame-token}/route.ts`, REST
routes under `app/api/tools/{registry,review}/*` and
`app/api/communities/[spaceId]/tools/*`, MCP tools in `lib/mcp/appTools.ts`,
scopes in `lib/mcp/scopes.ts#TOOL_SCOPES`, entity sync (`lib/notes/entities.ts`,
`context/entityNodes.ts`), feature key `tools` + rail keys
(`lib/featureAccess.ts`), UI in `features/tools/*` (host `ToolFrame`, the
in-frame kit and SDK, marketplace and review surfaces). Tests:
`tests/tools-*.test.ts`.
