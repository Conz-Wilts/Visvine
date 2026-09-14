# Tools

User-built mini-apps that run inside a Visvine space: a member (or a vibe-coding
agent working on their behalf) authors a Tool as a note, it renders in the main
content area over the space's own context, and publishing it makes it
installable **in that space**. A Tool goes no further than the space that wrote
it unless one of its admins deliberately submits it to the marketplace, where a
Visvine super-admin reviews it before any other space can install it. This page is the author, operator and admin guide;
the design decisions it records were made in the Tools planning map (2026-08-18).

**The quotable security property.** A Tool's UI runs in a sandboxed iframe on a
**separate, cookie-less origin** and can reach Visvine **only** by posting a
message to a bridge that re-checks the viewer's own grants on every call. A
Tool's declared reach can only **narrow** what its viewer could already see —
never widen it. Two members with different grants running the same Tool see
different data, and that is correct.

Users say "Tool"; code says `AppTool` / `tools/` to disambiguate from built-in
tools (Channels, installed Tools, …) and from MCP tools.

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
tags: [crm, kanban]                          # marketplace facets, ≤8, ^[a-z0-9-]{1,24}$
preview: /api/media/abc123.png               # card image: same-origin /api/media/… only
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
- `tags` and `preview` are **marketplace metadata** (`parseToolTags` /
  `parseToolPreviewUrl`): tags are lower-cased, de-duplicated, at most 8 and each
  `^[a-z0-9-]{1,24}$`; `preview` must be a same-origin `/api/media/...` path
  (upload it through the media route) — **any absolute URL, `https:` included,
  is refused** at parse time (a third-party host would learn every marketplace
  visitor's IP the moment the card rendered), as are `data:` and bare
  filenames, so the card never renders a source a reviewer didn't see. Both are **snapshotted into the published
  version** (`AppToolVersion.tags` / `previewUrl`, migration
  `20260821130000_tool_marketplace_meta`) beside the author's `releaseNotes`.

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
names that agent — a bare `*` does not count, a prefix like `digest-*` does.
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
**MCP server** — there is no in-app AI Tool builder. The one in-app
door is the **Create panel's Tool tile** (`features/create`, offered through
`canCreateType` like every other tile — ungated and member-open, because there
is no `tools` feature key and `tools/` is member-writable): a name, title, description and optional
sidebar label go to `POST /api/spaces/[spaceId]/tools/authoring`, which
calls the same `createTool` scaffold `create_tool` uses (a `railLabel` becomes
`surfaces.rail` with the default icon), and the success screen shows the
preview link plus the MCP address from `mcpResourceUrl()` — "finish it with
your coding agent (Settings → MCP)".

The console's **Build** section can also delete a working copy:
`DELETE /api/spaces/[spaceId]/tools/authoring/[name]` →
`lib/tools/service.ts#deleteTool` trashes the Tool's notes, removes its folder,
`tool:<name>` node and build, and (admin) uninstalls it from the space. Held to
the note store's removal bar — admin, the author, or a full-access member.
Published `AppToolVersion` rows survive on purpose: they are immutable
snapshots this space — or, if it was ever listed, another one — may be running.

The other deletion door lands in the same place: trashing
`tools/<name>/index.md` from ANY note surface (trash menu, folder delete, MCP)
triggers `lib/tools/hooks.ts#teardownTool`, which removes the node, the rest of
the folder, the build, and this space's own install
(`lib/tools/installs.ts#removeInstallForTool` — no admin gate; the note
deletion was already held to `canRemove`). A Tool never lingers in the console
after its config note is gone.

Visvine runs ONE MCP server at `/api/mcp`, exposing the `visvine` router and a
named tool per action. The authoring loop is a set of actions like any other — there is no
separate creator endpoint (`/api/mcp/creator` 308s to the one server, and the
tokens it minted still verify). The address is shown in Settings → MCP
(`/api/mcp/connect-info`).

An agent finds the loop by asking: `visvine({ request: "build a dashboard tool
for our pipeline" })` returns the `build_tool` recipe with the ordered steps.
Reading one action is `visvine({ action: "create_tool" })`; running it is
`visvine({ action: "create_tool", input: { … } })`.

The actions live in `lib/actions/defs/apps.ts` (handlers unchanged, and still
exported as `appToolHandlers` for scripts and tests), and every one goes through
`resolveTarget(ctx, space_id, scope)` — the same space-selection seam every
other action uses — so a Tool's notes obey the caller's real grants.

| Action | Scope | Does |
|---|---|---|
| `get_tool_sdk` | `context:read` | Returns `TOOL_AUTHOR_GUIDE` + `TOOL_KIT_DTS` (`lib/tools/sdkDocs.ts`) and the bridge method list — read this once before writing anything. |
| `list_tools` | `context:read` | Authored Tools in the space (with build status) plus installed Tools. |
| `read_tool` | `context:read` | One Tool's `index.md`/`ui.tsx`/`data.js` (unwrapped) + parsed config + build diagnostics. |
| `create_tool` | `tools:author` | Creates the entity folder + scaffolds (`lib/tools/service.ts#createTool`); returns the file list, the preview deep link and web URL, and a pointer to `get_tool_sdk`. |
| `write_tool` | `tools:author` | Writes one of the three files (`writeToolFile`); the response **always** carries the fresh build result, and the preview links. |
| `check_tool` | `tools:author` | Rebuilds and returns a lint report: config errors, compile diagnostics, `describePerimeter`, `computeRequirements` against this space, and warnings (empty perimeter, a downgraded page claim, a missing description). `render: true` also mounts the working copy headlessly and folds its console errors into the warnings (`runtime` block, no image). |
| `preview_tool` | `tools:author` | The two preview URLs plus current build status. `screenshot: true` renders the preview headlessly as the caller and returns the image + console errors — see [Preview](#preview). |
| `publish_tool` | `tools:author` | `publishTool` — publishes into the tool's OWN space and never the marketplace; an admin's is approved as it lands, a member's queues for one. Accepts `release_notes` (≤2KB); the response carries the preview links and says where the version went. |
| `install_tool` | `tools:install` | `installVersion` — admin-only; returns the install plus any type-claim conflicts and unmet requirements. |

**The scope is the boundary**, and with one server it is the only one. Each is
declared on the action's own definition and read through `scopeForAction` — the
single source both the transport's `insufficient_scope` challenge and
`runAction` check. Authoring rides `tools:author` and deliberately not
`context:write`: a token granted to tidy notes must not be able to add a running
app to a space's sidebar. Installing runs code nobody in the space wrote, so it
gets `tools:install` of its own. A client that never requests those scopes can
never author or install, whatever it connects to, and the consent screen names
each one it did request (`SCOPE_DESCRIPTIONS`). `tests/actions-registry.test.ts`
pins that a read-only grant reaches no action that writes.

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

There **is** a headless render, opt-in per call, for the agent that cannot open
a browser: `preview_tool { screenshot: true }` and `check_tool { render: true }`
(`lib/tools/screenshot.ts#captureToolPreview`). It drives Playwright's Chromium
at the **real preview page** — `${appOrigin}/tools/preview/<name>` — **as the
calling principal**: it mints an ordinary session for the caller (the same JWT
the login flow sets), drops it into a throwaway browser context as the
`auth_session` cookie, points the space switcher at the target space, and reads
back exactly what that person would see — same grants, same perimeter, same
refusals. It is deliberately not a screenshot of the bare frame URL: the frame
renders nothing until the host's `visvine:init` handshake lands, and every read
goes back through the host to the bridge, so a fake host would be a second
bridge to keep honest.

Two limits keep that session from being worth more than the one capture.
The minted JWT is **short-lived** — `createSession(payload, { maxAgeSeconds:
PREVIEW_SESSION_TTL_S })`, 120 s, not the 30-day web default — and the page is
**pinned to the preview URL**: a Tool's `ui.tsx` can call `visvine.navigate` and
the host will honour any in-app path, and `preview_tool` needs only
`tools:author`, so without the pin a narrow-scope token could screenshot any
page the caller's cookie can see. `page.route('**/*')` aborts every
*main-frame navigation request* whose URL is not the preview URL
(`previewNavigationAllowed`: same origin and path; query/hash/trailing slash are
fine; sub-resources, `/api/*` and child frames — the Tool's frame on the tools
origin included — are never judged), and a `framenavigated` listener catches
anything that slips past. If the main frame still ends up elsewhere the capture
answers `{ navigated_away: true, url }` instead of an image (`preview_tool`
reports it as `screenshot.navigated_away` + `reason`; `check_tool { render }`
adds a runtime line and `rendered: false`).

What comes back: `screenshot.png_base64` (or `jpeg_base64` when the PNG was
over ~300 KB — `mime` says which) at 1024×768, `rendered` (did the frame mount
anything into its root within the ~10 s budget), and `console_errors` — every
`console.error` and uncaught error from the page **and** the Tool's frame, in
order. `check_tool { render }` returns the console half only, as `runtime`, and
prefixes each line into `warnings` (so `ready_to_publish` goes false on a
runtime error); a build that doesn't compile never launches a browser — an error
card has no runtime errors worth reading.

Availability is the contract, not success. `playwright` is a devDependency and
Chromium is a separate download (`pnpm --filter @visvine/web exec playwright
install chromium`), so the capture answers `{ available: false, reason }` — and
the links still stand — whenever it cannot run: module missing, browser not
installed, or **production without `TOOLS_SCREENSHOT=on`** (a browser per call
is a cost an operator opts into; dev is always allowed). The import is dynamic
through a variable so a production image built without the package still boots.

### Publish → approve → (list → review) → install → upgrade

**A Tool belongs to the space that wrote it.** Publishing ships it to the people
there and to nobody else; putting it on the marketplace is a second, deliberate
act with a second reviewer. That split is carried by two independent columns on
`AppToolVersion` (migration
`20260903120000_tool_version_space_and_marketplace_verdicts`):

| column | whose verdict | what `approved` grants |
| --- | --- | --- |
| `status` | the **source space**'s admin | installable in that space and everything nested under it |
| `marketplaceStatus` | **Visvine**'s super-admin, and **NULL until someone asks** | installable by any space (over `install_tool`) |

1. **Publish** (`publish_tool` / `lib/tools/registry.ts#publishTool`) snapshots
   the working copy — config, perimeter, all three sources, both compiled
   bundles, plus the marketplace metadata: `tags`/`preview` from the config and
   the author's **release notes** (`release_notes` over MCP, the "Release notes"
   box in the publish dialog; ≤2 KB, clipped not refused) — into an immutable
   `AppToolVersion` row, **into its own space**. It is a MEMBER act, gated on
   being able to write the Tool's note:
   - an **admin**'s publish lands `status: approved` (an admin publishing *is*
     the approval) and flags this space's older installs with the upgrade;
   - a **member**'s lands `status: pending`, waiting on an admin at
     `/admin?section=approvals`. **That is the update queue**: edit an installed
     Tool, publish, an admin decides whether the installs move.

   Nothing here writes `marketplaceStatus`, so a Tool written in a private space
   is invisible outside it. Re-publishing **supersedes** an earlier submission
   still waiting on an admin (marked `withdrawn`, note `Superseded by vN`) rather
   than being refused — the newer snapshot is what the author means. Refuses a
   working copy that doesn't compile. Version numbers count from 1 and never
   repeat, even across a rejection.
2. **Approve** (`reviewSpaceVersion`, `POST …/tools/versions/<id>` with
   `action: 'review'`) is the space admin's verdict, on the **Approvals** tab of
   `/tools` (admins only, badged with the count). They read the declared
   perimeter diffed against the last version *this space* approved, then approve
   or reject with a note the author reads. Approving flags every install **in
   this space's subtree** pinned to an older version with an offered upgrade; it
   never changes what is running anywhere.
3. **List** (`submitToMarketplace`, `action: 'list'`; Build → "Submit to
   marketplace…") is the only thing that offers a Tool to other spaces, and it
   is a space admin acting on a version their space has **already approved**.
   It sets `marketplaceStatus: 'pending'`. `withdrawFromMarketplace`
   (`action: 'unlist'`) takes it back out of the queue.
4. **Review** is a **Visvine super-admin** act (`isSuperAdmin`, env-driven —
   the one queue in the app that is not space-scoped), over `marketplaceStatus`
   only. They see the declared perimeter, the release notes, and a code diff
   against the last **listed** version (`perimeterDiffForVersion(id,
   'marketplace')`). Approving flags every install of an older version anywhere.

   **The one exception — trusted publishers.** `TOOLS_TRUSTED_PUBLISHERS` (env,
   comma-separated space ids) names spaces whose *re*-listings may skip the
   queue: `submitToMarketplace` runs the pure `shouldAutoApprove` right after the
   submission lands and, when the space is trusted **and** an earlier listed
   version exists **and** the perimeter diff against it is empty, marks the
   listing `approved` with `marketplaceReviewedBy: 'auto'`. The `surfaces` block
   (rail label/icon, type page/tab claims — `surfacesUnchanged`, compared after
   normalising, claim order aside) must match too: a new rail entry or a claim on
   a node type's page is new real estate in every installing space even when the
   reach is the same. A first listing, any perimeter or surfaces change, or any
   untrusted space stays super-admin. Code changes are not inspected — what an
   install can do is bounded by the perimeter and the viewer's grants, and that
   bound is what the check proves has not moved.
5. **Install** (`install_tool` / `lib/tools/installs.ts#installVersion`, space
   admin only) pins the version, picks a free slug (`deals` → `deals-2` on a
   clash), and resolves the declared type surfaces against the space (see
   [Type pages](#type-pages)). The gate is the pure
   `registry.ts#installability`: the source space's verdict must be `approved`,
   and then either the installing space's **lineage includes the source space**
   or the version is **listed**. `install_tool { key }` resolves to the newest
   **listed** version only — a key is a marketplace identity. **Unmet
   requirements never block an install** — the Tool installs degraded behind a
   checklist; see [Degraded mode](#degraded-mode).
6. **Upgrade** (`applyUpgrade`, space admin only) moves an install onto the
   offered version, after the admin reads the perimeter diff, and **re-asks
   `installability`** rather than trusting the offer — a listing can be rejected
   between the flag and the click. This is the *only* way a space's Tool code
   ever changes — publishing a new version never touches an install by itself.

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
| `context.list` | List note metadata under an optional glob, perimeter- and grant-filtered, path order. With `cursor` or `page: true`, answers `{ items, nextCursor }` instead of a plain array (see [Paging](#paging)). |
| `context.read` | One note's body + parsed frontmatter. |
| `context.search` | Ranked search over what the viewer can read, perimeter-filtered after ranking. Pages the same way (`k` is the page size, the cursor is a rank offset, 1,000 hits deep at most). |
| `context.write` / `context.append` | Write/append a `.md` note — refused for `tools/`, `agents/`, `connectors/`, except that `write` may CREATE the brief of an agent the perimeter names (see [Frontmatter reference](#frontmatter-reference)). |
| `connectors.call` | Run a declared connector, exactly the path `run_connector` uses. |
| `agents.run` | Trigger a declared, active agent (author-or-admin, dispatched not awaited). |
| `data.call` | Call a `data.js` handler in the isolate. |
| `state.get` / `state.set` | Per-install key/value store (there is no `localStorage` in the sandbox). |
| `subject.get` | What the Tool is being shown about (set by the host on a type page; null otherwise). |

`data.call` and `subject.get` are the two methods **not** re-exposed as isolate
capabilities (`bridgeCapabilities`) — a handler calling `data.call` would nest
isolates, and `data.js` gets `subject` as a plain global instead.

#### Paging

`context.list`/`context.search` cap at `BRIDGE_LIMITS.maxRows` (200) per call.
Passing `cursor` (or `page: true` for the first page) switches the answer to
`{ items, nextCursor }`; the plain-array shape is kept for calls without either,
so a Tool written before paging existed is unchanged. A cursor is opaque to the
Tool but plain on the server — base64url of the last path handed out (list is
path-ordered) or of the rank offset (search) — carries no authority, and is
re-checked against the perimeter and the viewer's grants on every page; a forged
one can only skip rows, and a malformed one is `invalid`. The kit exposes it as
`visvine.context.listPage(glob, cursor)` / `searchPage(query, { k, cursor })` and
`usePagedList(glob, { pageSize })` (accumulating `items`, `hasMore`, `loadMore`).

### Live data — the changes stream

`GET /api/tools/changes?target=<BridgeTarget JSON>` (`app/api/tools/changes/route.ts`)
is an SSE stream of **paths** — never content — that changed inside a Tool's read
perimeter. The host `ToolFrame` opens it once the handshake lands (same-origin,
viewer's cookie, like the bridge) and relays each batch to the frame as
`visvine:changed { paths }`; the kit's `useLiveQuery(fn, deps, { paths?, pollMs? })`
is `useQuery` that re-runs when a changed path matches its globs (or on any
change when `paths` is omitted), and re-runs anyway every 30s.

The pipeline: the store's write/rename/delete hooks already call
`lib/tools/hooks.ts`, which now also publishes to `lib/notes/changes.ts` — a
per-process bus on `globalThis` keyed by space, carrying `{ spaceId, ownerKey,
path, kind, from? }` (personal contexts included, with their `ownerKey`). The route
resolves the target with `resolveBridgeTarget` (exactly as the bridge does),
subscribes to the space, and forwards a path only when `lib/tools/changes.ts#changedPathsFor`
says so: shared context, inside the perimeter (`refuseRead`), and readable by the
viewer (`canReadPath` — deletes and the old half of a rename included: a path is a
name, and the name of a note the viewer could never read is not theirs to hear;
a frame may therefore miss the delete of a note it could not read, which it had
nothing showing to refresh). Streams close themselves after 5 min so
`EventSource`'s reconnect re-resolves the target — a disabled install or a lost
membership stops hearing changes at the next reconnect at the latest. One user
holds at most **8 open streams per process** (`lib/tools/streamLimit.ts`,
`MAX_STREAMS_PER_USER`); the next `GET` is refused with `429 too_many_streams`
rather than cutting the oldest, and the slot is released on close or abort.

**Best-effort, per-process — by design.** Like `lib/messages/realtime.ts`, the bus
does not cross Cloud Run instances: a note saved on instance A is not announced to
a frame streaming from instance B. That is why `useLiveQuery` polls, and why the
author guide calls the stream a hint and the poll the guarantee. Cross-instance
realtime needs an external pub/sub (an explicit non-goal for now); when it
arrives, `publishChange` is the one seam to fan out through.

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

`state.set` has two caps of its own (`lib/tools/state.ts`): **64 KB** per
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
registry order *first*, with the new Tool appended after it. `tools` itself is
**core and nav-hidden** (`lib/featureAccess.ts#CORE_FEATURE_KEYS`): it has no
rail row of its own and no on/off switch. What a space runs is decided by the
pipeline itself — a version is approved, then installed. There is no `/tools`
destination: the Space Console owns every one of those decisions (Tools =
placement + the installed versions, Build = the working copies written here,
Approvals = what a member published), and cross-space install is the
`install_tool` action rather than a browsable catalogue.

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
| Publish into the space (`publish_tool`) | Any member who can write the Tool's note. An admin's publish is approved as it lands; a member's queues for one |
| Approve a member's version (Approvals tab) | Space admins (`isAdmin`) of the space that wrote it |
| Submit to / withdraw from the marketplace | Space admins (`isAdmin`) of the space that wrote it, on a version that space already approved |
| Install / upgrade / enable / uninstall / type claims | Space admins (`isAdmin`) |
| Review a marketplace listing | Visvine **super-admins** only (`isSuperAdmin`, env-driven `SUPER_ADMIN_EMAILS`) — the one queue in the app that is not space-scoped. Exception: an unchanged-perimeter re-listing from a `TOOLS_TRUSTED_PUBLISHERS` space is auto-approved (`shouldAutoApprove`) |

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

**`TOOLS_ORIGIN` is a pure RUNTIME value.** The Content-Security-Policy is built
per request in `proxy.ts` (`lib/security/csp.ts`) — it has to be, because it
carries a per-request nonce — so `frame-src` reads the environment on every
response. Setting the origin on Cloud Run takes effect on the next revision,
with no rebuild, and nothing about it is baked into the image.

To turn on the separate origin:

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

# 4. Make a new revision so Cloud Run picks the value up. A push to main does
#    it, or trigger the pipeline by hand without one:
gh workflow run "Deploy to Cloud Run"
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
alone — the latter means the serving revision does not have the env var, which
a redeploy fixes.

### `TOOLS_SCREENSHOT` and `TOOLS_TRUSTED_PUBLISHERS`

Both documented in `apps/web/.env.example`. `TOOLS_SCREENSHOT=on` lets a
production deployment answer `preview_tool { screenshot }` / `check_tool
{ render }` with a real headless render (the image must carry `playwright`
and a Chromium — it is a devDependency and is **not** in the standalone image
today, so the flag alone is not enough there); unset, production is link-only
and dev is always on. `TOOLS_TRUSTED_PUBLISHERS=space_a,space_b` names the
spaces whose unchanged-perimeter re-publishes are auto-approved (see the
review step above); unset means every version is read by a person.

### Local dev

```
TOOLS_ORIGIN=http://127.0.0.1:3000
```

Vendor ESM (`react.js`, `react-jsx-runtime.js`, `react-dom-client.js`,
`tool-kit.js`) is built on demand by esbuild in dev
(`lib/tools/vendorBundle.ts`) and memoised per process. `tool-kit.js` bundles
the kit **and its batteries** — recharts (charts), react-markdown + remark-gfm +
rehype-sanitize (`Markdown`) — so a Tool imports `LineChart` from
`@visvine/tool-kit` and never names a library; the compiler's `EXTERNALS` and
the frame's import map stay at four entries (`react`, `react/jsx-runtime`,
`react-dom/client`, `@visvine/tool-kit`), and `tests/tools-frame-document.test.ts`
pins the two lists to each other (bare `react-dom` is refused at compile time for
exactly that reason). The kit bundle is ~775 KB minified with a 1.5 MB budget
enforced by `tests/tools-kit-batteries.test.ts`, which also checks that
`TOOL_KIT_DTS` declares every export the bundle has. In production the same
four files are prebuilt by `scripts/build-tool-vendor.ts` (wired into
`apps/web`'s `build` script) into `public/tool-runtime/`, because Next's
standalone output tracer cannot reach `react-dom`'s client entry through
pnpm's `node_modules` symlink — `vendorBundle.ts`'s file comment has the full
story if that ever needs revisiting.

## Known rough edges

Judged not worth a wide fix; none is a regression and each has a narrow fix.

- **`context.list` reads the whole visible vault** (`lib/tools/bridge.ts`,
  `deps.visibleVault`) and filters in JS, so a glob matching three notes costs
  O(vault) on a path a Tool can hit 120×/min. Fix: push the glob's literal
  prefix (`compileGlob` already computes it) into the vault query, keeping the
  `refuseRead` filter in JS so the perimeter stays the last word.
- **Uninstall leaves `featureConfig.enabled['tool:<slug>']` behind**
  (`lib/tools/installs.ts#featureConfigWithoutRail`). Harmless — reinstall
  defaults to enabled — but `mergeFeatureConfig` cannot express a deletion, so
  fixing it touches every feature, not just Tools.
- **`deploy.yml` expands to a trailing `TOOLS_ORIGIN=` when the repo variable is
  unset.** gcloud accepts the empty value and `toolsOrigin()` treats it as null
  (the same-origin fallback), so it is safe today; a stricter gcloud would want
  the pair omitted in a build step.

Deliberate, not defects: a Tool note's own page is `<dir>/project.md`, not
`index.md` (`enforceIndexFrontmatter`); a Tool may create an agent brief but
never edit one; `hostBridge` posts to `'*'` because an opaque origin matches
nothing else (reasoned at the call site, covered by the escape suite).

## Verification

```sh
pnpm --filter @visvine/web exec tsc --noEmit
pnpm lint
pnpm test                                    # apps/web/tests/tools-*.test.ts
pnpm --filter @visvine/web exec knip
pnpm db:migrate                              # applies the app_tool_* migration locally
```

Live, scripted checks, in the style of the connector and agent verifications —
they resolve a real principal and drive the services directly. **Both need
a dev server on `:3000`** (`pnpm dev`), because they also exercise the runtime
routes over real HTTP; the second additionally drives Chromium through
Playwright. Each is a `pnpm --filter @visvine/web` script:

```sh
pnpm --filter @visvine/web verify:tools           # author over MCP → publish → review → install → frame + bridge write
pnpm --filter @visvine/web verify:tools:escape    # adversarial: undeclared reads, cookie theft, content-area escape, cross-space
```

`verify:tools:escape`'s first step asks the running app for its
`Content-Security-Policy` and fails unless `frame-src` names `TOOLS_ORIGIN` —
`frame-src 'self'` alone blocks the very frame the app renders, and the symptom
is a Tool that never appears rather than an error. `TOOLS_ORIGIN` unset in the
shell — the common case — is a SKIP, not a failure.

`verify:tools` and `verify:tools:escape` remove every row and note they create,
leaving the shared dev DB as they found it. The demo seed ships no Tools.

> **Local gotcha.** If this box's `apps/web/.env` still carries a
> `CLOUD_SQL_CONNECTION_NAME` from a `dev:cloud` session,
> `scripts/guard-local-db.mjs` refuses on sight even when `DATABASE_URL` points
> at Docker. Clear it for the one command rather than editing `.env`:
>
> ```bash
> CLOUD_SQL_CONNECTION_NAME= pnpm --filter @visvine/web verify:tools   # bash
> ```
>
> That prefix form is **bash only**. In PowerShell `$env:X = ''` sets the
> variable to an empty string but leaves it defined, which the guard still
> refuses; remove it from the environment instead:
>
> ```powershell
> Remove-Item Env:\CLOUD_SQL_CONNECTION_NAME -ErrorAction SilentlyContinue
> pnpm --filter @visvine/web verify:tools
> ```

## Code map

`lib/tools/{config,perimeter,protocol,compile,builds,hooks,service,target,bridge,
dataRun,limits,state,requirements,registry,installs,origin,csp,frameToken,
frameDocument,vendorBundle,sdkDocs,screenshot,changes}.ts`, the change bus
`lib/notes/changes.ts`, runtime routes under `app/api/tools/runtime/*` and
`app/api/tools/{bridge,frame-token,changes}/route.ts`, REST
routes under `app/api/tools/{registry,review}/*` and
`app/api/spaces/[spaceId]/tools/*`, actions in `lib/actions/defs/apps.ts`
(their scopes declared there and read through `scopeForAction`), entity sync (`lib/notes/entities.ts`,
`context/entityNodes.ts`), the `directory` gate + per-install rail keys
(`lib/featureAccess.ts`), UI in `features/tools/*` (host `ToolFrame`, the
in-frame kit and SDK, marketplace and review surfaces). Tests:
`tests/tools-*.test.ts`.
