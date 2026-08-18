---
id: 024
title: "Adversarial escape suite: hostile Tool fixtures, node + Playwright assertions"
status: done
kind: build
size: l
wave: 5
depends_on: [023, 022]
touches: [apps/web/package.json, pnpm-lock.yaml, apps/web/scripts/verify-tools-escape.ts, apps/web/scripts/fixtures/tools/hostile/**, apps/web/tests/tools-escape.test.ts]
created_by: 002
session: 99ee81ea-88d9-4a2f-969d-d5c2378d6b35
model: opus
effort: xhigh
---

## Task

Prove the limits hold. Add `playwright` as an apps/web devDependency (Chromium only; `pnpm --filter @visvine/web exec playwright install chromium` — document in the script header) and script `verify:tools:escape`.

**tests/tools-escape.test.ts** (unit, no server): using `handleBridgeCall` with a fake target whose perimeter reads `deals/**` only — assert refusals for: read outside globs, write when only read declared, `../` and `%2e%2e` traversal in paths, cross-space (target spaceId A but params referencing space B are meaningless by construction — assert the target resolution ignores any `spaceId` in params), undeclared connector, undeclared agent, `data.call` handler attempting `visvine.context.read` outside the perimeter (real isolate) → perimeter error, `fetch`/`sql`/`mcp`/`require`/`process` are undefined inside data.js, oversized write → `too_large`, rate limiter trips at `callsPerMinute+1`, `state.set` > 16KB refused. Also `compileToolUi` refuses `import x from 'https://evil'` and `import fs from 'fs'`.

**scripts/fixtures/tools/hostile/**: a Tool whose ui.tsx tries, on mount, each escape and reports results back through `visvine.state.set('probe', {...})` (allowed by design so the suite can read them): read `document.cookie`, `window.parent.document`, `top.location = …`, `window.open`, `fetch(appOrigin + '/api/auth/session', { credentials: 'include' })`, `fetch('https://example.com')`, `new Image().src = 'https://example.com/x'` (expect CSP block — detect via onerror), `localStorage`, `navigator.sendBeacon`, `<a target=_top>` click, `postMessage` to parent with a forged `visvine:call` of an undeclared read (expect `perimeter` error), and a request for a note in another space via a crafted `visvine:navigate` to `//evil` (expect host to ignore).

**scripts/verify-tools-escape.ts**: seeds the hostile Tool through the MCP handlers into the local dev space (as verify-tools-e2e does), approves + installs it, launches headless Chromium, logs in via `/dev/login` (dev auth: `NODE_ENV=development ENABLE_DEV_AUTH=true`), opens `/t/hostile`, waits for the probe state via the bridge (poll `state.get('probe')` in-process or through the page), and asserts every escape FAILED (cookie empty/undefined, parent access threw, top navigation blocked — page URL unchanged, no popup, cross-origin fetch blocked by CSP, image load errored, localStorage threw, beacon false, forged call got a `perimeter` error); asserts the iframe's bounding box is inside the `<main>` content area and never overlaps navbar/sidebar (compare rects), and that the frame's document origin !== app origin (`frame.evaluate(() => location.origin)`) when TOOLS_ORIGIN is set. Take a screenshot to the OS temp dir on failure. Cleanup + exit code. Acceptance: script passes locally against `pnpm dev` with `TOOLS_ORIGIN=http://127.0.0.1:3000` (paste results); tsc/lint/test/knip clean.

## Outcome

The adversarial escape suite lands in two halves — 20 node tests over every server-side gate, and a live Playwright run that drives a genuinely hostile fixture Tool through headless Chromium — and it **found a real, production-fatal defect on its first run**: the app's own CSP shipped `frame-src 'self'`, which blocks the Tool iframe the moment `TOOLS_ORIGIN` names a separate host. With the intended prod config (`tools.visvine.com`) **no Tool would ever have rendered**. One-line fix in `next.config.ts`; the live suite then passes **29/29 against `pnpm dev` with `TOOLS_ORIGIN=http://127.0.0.1:3000`**, twice consecutively. tsc, `eslint . --max-warnings=0`, knip and the full suite (984/984, +20) are clean.

**The live run** (`CLOUD_SQL_CONNECTION_NAME= pnpm --filter @visvine/web verify:tools:escape`, space `community:blackbird-ventures`, owner `admin@local.dev`, frame served from `http://127.0.0.1:3000`):

```
1  the hostile sources compile — 8373 bytes, no errors
2  the hostile Tool is approved and installed — v1 · rail {"label":"Hostile","icon":"grid"}
3  the dev server answers · the viewer is logged in on the app origin — cookies [auth_session]
4  the Tool frame is on the page — /t/hostile · frame served from http://127.0.0.1:3000 (separate tools origin)
   the Tool reported its probe through the bridge — marker verify-tools-escape:hostile, 18 entries
5  document.cookie carries no session
     threw SecurityError: … The document is sandboxed and lacks the 'allow-same-origin' flag.
   window.parent.document is unreachable
     threw SecurityError: Blocked a frame with origin "null" from accessing a cross-origin frame.
   top navigation is blocked — the app did not move (URL identical before/after)
     location.href threw SecurityError: … does not have permission to navigate the target frame
   the <a target="_top"> click went nowhere — returned "clicked" · url unchanged
   window.open opened nothing — returned {"opened":false} · 0 popup(s) reached the browser context
   a credentialed fetch of the app's own session endpoint is blocked — TypeError: Failed to fetch
   a cross-origin fetch is blocked by connect-src — TypeError: Failed to fetch
   an off-origin image never loads (img-src) — outcome error
   localStorage is unavailable — threw SecurityError
   navigator.sendBeacon reaches nothing — CSP blocked https://example.com/beacon (connect-src)
   a forged visvine:call for an undeclared note gets a `perimeter` error
     tool perimeter denied: people/index.md is not in this tool's read globs (hostile/**)
   a crafted visvine:navigate to //evil is ignored — url unchanged
   the same read through the SDK is refused too
6  data.js has no fetch, sql, mcp, require or process (all "undefined")
   data.js cannot read or write outside the perimeter · nothing it tried to write exists
7  the iframe is inside <main> — iframe 77,65 1354×819 · main 77,65 1354×826
   never overlaps the navbar (0,0 1440×64) · never overlaps the rail (0,64 77×836)
8  the frame's document origin is not the app's — http://127.0.0.1:3000 vs http://localhost:3000
   the frame reported 4 CSP violations: connect-src ×3, img-src ×1
9  uninstall drops the row and its rail key · cleanup leaves nothing behind

29 passed, 0 failed
```

**The defect, and why it needed fixing here.** `apps/web/next.config.ts` set `frame-src 'self'` app-wide. The first live run died with `Framing 'http://127.0.0.1:3000/' violates … "frame-src 'self'". The request has been blocked.` — the frame never loaded, so nothing could be asserted. The whole separate-origin design (the thing the sandbox rests on) was unreachable in any configuration where it actually applied. `frame-src` now reads `toolsOrigin()`, so it names the tools origin when one is configured and stays `'self'` otherwise; the comment spells out that this is the app's half of the split and the frame's own `frame-ancestors` is the other. That file is outside my scope — the edit is one directive plus one import, and I flagged the deployment half as a follow-up rather than reaching further.

**Follow-up proposed (058, wave 6).** Next bakes `headers()` into `.next/routes-manifest.json` at BUILD time and the standalone prod server serves from that manifest — verified locally: the on-disk manifest still carries the pre-fix `frame-src 'self'` while the live dev server serves the new value. `docs/tools.md`'s runbook adds `TOOLS_ORIGIN` only as a Cloud Run **runtime** env var, so a prod image built without it would bake `frame-src 'self'` and Tools would silently fail behind the very origin split meant to protect them. Task 058 covers confirming the behaviour, passing it as a build arg (or moving the carve-out to `proxy.ts`), updating the runbook and adding a regression check.

**tests/tools-escape.test.ts (20 tests, no server).** One target throughout, declaring `read: ["deals/**"]` and nothing else; every dependency is a trap, so a pass proves the gate refused *before* contextService/the connector runtime/the scheduler. Covers: read outside the globs; list/search cannot enumerate past it (a caller-supplied `**` widens nothing); write and append refused when only read is declared; five `..` shapes refused as `invalid`; **`%2e%2e` is never decoded** — asserted by capturing the exact string handed to `readVisible` (byte-identical, so it can only name a note that does not exist) and by showing `%2e%2e/…` outside `deals/` gets `perimeter`; a `spaceId` smuggled into params *and* into the target both ignored (the install row decides, `resolveContext` is asked for the install's space); a preview naming another space refused by the membership gate; undeclared connector and agent; a real-isolate `data.call` refused in the perimeter's own words; `fetch`/`sql`/`mcp`/`require`/`process` (plus `XMLHttpRequest`/`WebSocket`) all `undefined` inside `data.js`, with `visvine.context.read` present so the test cannot pass by the handler never running; frozen host globals that cannot be rewritten to disarm the gate; an infinite handler stopped by the isolate deadline; oversized write → `too_large`; the rate limiter tripping at `callsPerMinute + 1`, with per-viewer/per-install budgets and window recovery; `state.set` > 16KB refused and *nothing stored*; `compileToolUi` refusing `https://evil`, `fs`, `node:fs`, a relative import and two non-literal dynamic imports.

**The fixture** (`scripts/fixtures/tools/hostile/`) is three real files. `index.md` declares `read: ["hostile/**"]`, no writes/connectors/agents — one line every refusal is measured against. `ui.tsx` runs twelve escapes on mount and confesses through `visvine.state.set('probe', …)` (the one capability it is *meant* to have), which the script reads back **through the bridge**, not through the page — proving the write went the whole distance. Two rules keep it honest: nothing may throw or reject uncaught (the frame runtime turns that into a `visvine:error` and the host replaces the iframe with an error card, which would take the evidence away), and every probe *records* rather than judges. `data.js` makes the same attempt from inside the isolate.

**Three things the run taught me, all now baked in.** (1) `navigator.sendBeacon` returns **`true`** for a beacon Chrome merely queued and then refused on `connect-src` — the return value says the escape worked when nothing left the machine, so the fixture records `securitypolicyviolation` events and the assertion reads those. (2) `context.on('page')` fires for the page the script opens itself, so the popup listener is attached *after* `newPage()`. (3) `visvine:navigate` to an in-app path — including a `..` chain that still resolves same-origin — is a **documented capability** (`visvine.navigate` exists so a Tool can move the app inside itself); my first fixture asked for `/directory/note/../../../etc/passwd`, got it, and destroyed its own frame mid-run. The probe now only posts genuinely off-site shapes (`//evil`, `https://evil`, `javascript:`, `/\evil`), with a comment saying why.

**Also worth knowing.** `location.origin` inside the sandboxed frame reports the *URL's* origin (`http://127.0.0.1:3000`), not `"null"` — the origin the browser *secures* against is the opaque one, which is what made cookie/localStorage/`parent.document` throw and what makes `event.origin` arrive as `"null"` at the host. The origin check is adaptive: a hard assertion when the frame is served from a separate host, and when `TOOLS_ORIGIN` is unset it says so and falls back to asserting the sandbox still denies storage — a supported setup must not read as a failure.

**Scope notes.** `playwright ^1.62.1` added to `apps/web` devDependencies (pnpm-lock +22 lines); browser installed once with `pnpm --filter @visvine/web exec playwright install chromium`, documented in the script header. Script `verify:tools:escape`. I appended `TOOLS_ORIGIN=http://127.0.0.1:3000` to `apps/web/.env` (gitignored, not a repo change) so the shared dev server runs the documented dev configuration — Next picked it up without a manual restart, and `http://127.0.0.1:3000/` now correctly 404s for non-runtime paths. Cleanup is per-key, not a snapshot restore, because the space is shared: it names only the four paths it can write, purges exactly its own trash rows, drops folder rows only when empty, and edits `featureConfig` key by key — the run left task 025's `tool:wayfinder` install untouched. A failure writes a screenshot to the OS temp dir, documented as a debugging aid only: per task 022, a sandboxed frame's text does not appear in Playwright captures, so every assertion reads the DOM, the bridge or a bounding box.
