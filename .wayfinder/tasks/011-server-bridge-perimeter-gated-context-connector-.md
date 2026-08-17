---
id: 011
title: "Server bridge: perimeter-gated context/connector/agent/data/state handlers + /api/tools/bridge"
status: todo
kind: build
size: l
wave: 2
depends_on: [003, 005, 007, 009]
touches: [apps/web/lib/tools/bridge.ts, apps/web/lib/tools/dataRun.ts, apps/web/lib/tools/limits.ts, apps/web/lib/tools/state.ts, apps/web/lib/tools/target.ts, apps/web/app/api/tools/bridge/route.ts, apps/web/tests/tools-bridge.test.ts, apps/web/tests/tools-limits.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

The only door from a running Tool to Visvine data. Read the protocol in apps/web/lib/tools/protocol.ts (BridgeMethod, BridgeRequest/Response, BRIDGE_LIMITS) and the perimeter helpers in lib/tools/perimeter.ts.

**lib/tools/target.ts**: `resolveBridgeTarget(session, target): Promise<ResolvedTarget|BridgeError>` — for `install`: load `AppToolInstall` + its `AppToolVersion` (perimeter/config/dataBundle from the VERSION, never the working copy), require the viewer to be a member of `install.spaceId` (reuse the membership/space resolution the MCP layer uses in lib/mcp/context.ts / lib/notes principal helpers), refuse when `enabled=false`; for `preview`: require the viewer can read `tools/<name>/index.md` in that space and load `AppToolBuild` (working copy). Result: `{ spaceId, principal (ContextPrincipal), context (shared), perimeter, config, dataBundle, installId|null, degraded }`.

**lib/tools/bridge.ts**: `handleBridgeCall(t: ResolvedTarget, method, params): Promise<BridgeResponse>` implementing every method: `context.list` (glob within `perimeter.read`, list from `visibleVault`, cap `maxRows`), `context.read` (refuseRead → readVisible → cap `maxReadBytes` with `too_large`), `context.search` (searchContext, filter hits to perimeter.read), `context.write` / `context.append` (refuseWrite → `writeGated`/`appendLogGated` with origin 'tool' — check what origins the store accepts and add one if needed only in the audit string, not the store; cap `maxWriteBytes`; content must be markdown notes — `.md` only), `connectors.call` (refuseConnector → `executeConnectorScript` from lib/connectors/service.ts under the viewer principal; admin/`connectors:use`-equivalent checks as run_connector MCP applies), `agents.run` (refuseAgent → trigger a manual run the way MCP `run_agent` does — find and reuse that code path in lib/agents; return runId), `data.call` (see dataRun), `state.get/set` (AppToolState per install; preview targets use an in-memory map; value ≤ 16KB), `subject.get`. Every handler: validate params with zod, never throw — map to BridgeError codes; auth is ALWAYS the viewer's own principal (contextService does the grant checks; the perimeter only narrows).

**lib/tools/dataRun.ts**: `runDataHandler(t, fn, args)`: builds the isolate code `${dataBundle}\n; return await handlers[${JSON.stringify(fn)}](args, visvine)` (data.js defines `handlers.<name>`; prelude declares `const handlers = {}` and `const args = <marshalled>`), runs `runInIsolate` with `omitDefaults: ['fetch','sql','mcp']`, `capabilities` = the same handlers as above (`context.*`, `connectors.call`, `agents.run`, `state.*`) closed over the target, `globals: { subject, install }`, timeout `BRIDGE_LIMITS.dataCallTimeoutMs`; map `denials`/timeouts to BridgeError.

**lib/tools/limits.ts**: in-process sliding-window rate limiter keyed by `${viewerId}:${installId|preview}` (`callsPerMinute`) and a per-install concurrency cap for `data.call` (2) — pure and tested.

**app/api/tools/bridge/route.ts**: POST, `requireSession()`, JSON body `BridgeRequest` (size-capped by `maxParamsBytes`), also require `Sec-Fetch-Site` ∈ {same-origin, none} or an `Origin` equal to the app origin (defence in depth: the sandboxed frame must never be able to hit this route directly), resolve target → rate limit → handle → JSON `BridgeResponse`. 200 always for handled errors; 401 unauth; 413 oversized.

Tests: perimeter refusals per method using a fake target with stubbed contextService functions (structure bridge.ts so the data functions are injectable via a `deps` object defaulting to real ones), row/byte caps, rate limiter behaviour, dataRun happy path (real isolate) with a fake `context.read` capability, undeclared read from data.js refused. Acceptance: tsc/lint/test/knip clean.
