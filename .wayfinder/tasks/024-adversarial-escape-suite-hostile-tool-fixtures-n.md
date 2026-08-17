---
id: 024
title: "Adversarial escape suite: hostile Tool fixtures, node + Playwright assertions"
status: todo
kind: build
size: l
wave: 5
depends_on: [023, 022]
touches: [apps/web/package.json, pnpm-lock.yaml, apps/web/scripts/verify-tools-escape.ts, apps/web/scripts/fixtures/tools/hostile/**, apps/web/tests/tools-escape.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

Prove the limits hold. Add `playwright` as an apps/web devDependency (Chromium only; `pnpm --filter @visvine/web exec playwright install chromium` — document in the script header) and script `verify:tools:escape`.

**tests/tools-escape.test.ts** (unit, no server): using `handleBridgeCall` with a fake target whose perimeter reads `deals/**` only — assert refusals for: read outside globs, write when only read declared, `../` and `%2e%2e` traversal in paths, cross-space (target spaceId A but params referencing space B are meaningless by construction — assert the target resolution ignores any `spaceId` in params), undeclared connector, undeclared agent, `data.call` handler attempting `visvine.context.read` outside the perimeter (real isolate) → perimeter error, `fetch`/`sql`/`mcp`/`require`/`process` are undefined inside data.js, oversized write → `too_large`, rate limiter trips at `callsPerMinute+1`, `state.set` > 16KB refused. Also `compileToolUi` refuses `import x from 'https://evil'` and `import fs from 'fs'`.

**scripts/fixtures/tools/hostile/**: a Tool whose ui.tsx tries, on mount, each escape and reports results back through `visvine.state.set('probe', {...})` (allowed by design so the suite can read them): read `document.cookie`, `window.parent.document`, `top.location = …`, `window.open`, `fetch(appOrigin + '/api/auth/session', { credentials: 'include' })`, `fetch('https://example.com')`, `new Image().src = 'https://example.com/x'` (expect CSP block — detect via onerror), `localStorage`, `navigator.sendBeacon`, `<a target=_top>` click, `postMessage` to parent with a forged `visvine:call` of an undeclared read (expect `perimeter` error), and a request for a note in another space via a crafted `visvine:navigate` to `//evil` (expect host to ignore).

**scripts/verify-tools-escape.ts**: seeds the hostile Tool through the MCP handlers into the local dev space (as verify-tools-e2e does), approves + installs it, launches headless Chromium, logs in via `/dev/login` (dev auth: `NODE_ENV=development ENABLE_DEV_AUTH=true`), opens `/t/hostile`, waits for the probe state via the bridge (poll `state.get('probe')` in-process or through the page), and asserts every escape FAILED (cookie empty/undefined, parent access threw, top navigation blocked — page URL unchanged, no popup, cross-origin fetch blocked by CSP, image load errored, localStorage threw, beacon false, forged call got a `perimeter` error); asserts the iframe's bounding box is inside the `<main>` content area and never overlaps navbar/sidebar (compare rects), and that the frame's document origin !== app origin (`frame.evaluate(() => location.origin)`) when TOOLS_ORIGIN is set. Take a screenshot to the OS temp dir on failure. Cleanup + exit code. Acceptance: script passes locally against `pnpm dev` with `TOOLS_ORIGIN=http://127.0.0.1:3000` (paste results); tsc/lint/test/knip clean.
