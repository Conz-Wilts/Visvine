---
id: 008
title: Tools origin, proxy host split, frame token and CSP builder
status: done
kind: build
size: m
wave: 1
depends_on: []
touches: [apps/web/lib/tools/origin.ts, apps/web/lib/tools/frameToken.ts, apps/web/lib/tools/csp.ts, apps/web/proxy.ts, apps/web/.env.example, apps/web/tests/tools-origin.test.ts, apps/web/tests/tools-frame-token.test.ts]
created_by: 002
session: 817e7e38-1016-4fa6-b56b-a4012942e299
model: opus
effort: xhigh
---

## Task

Implement the separate cookie-less origin for Tool frames as decided: prod `https://tools.visvine.com` (same Cloud Run service; the human maps DNS), dev `http://127.0.0.1:3000` beside the app on `http://localhost:3000`.

**apps/web/lib/tools/origin.ts** (pure + env): `toolsOrigin(): string|null` from `TOOLS_ORIGIN` (trimmed, no trailing slash; null when unset), `appOrigin()` from `NEXT_PUBLIC_APP_URL` (fallback `http://localhost:3000`), `isToolsHost(hostHeader: string|null): boolean` (compares host[:port] to TOOLS_ORIGIN's host; false when unset), `TOOL_RUNTIME_PATH_PREFIX = '/api/tools/runtime/'`, `isToolRuntimePath(pathname)`, `toolsOriginConfigured(): boolean`, `frameUrl(params: { token: string }): string` = `${toolsOrigin() ?? appOrigin()}/api/tools/runtime/frame?token=…`.

**proxy.ts**: at the top of `proxy()`, if `isToolsHost(req.headers.get('host'))`: allow only `isToolRuntimePath(pathname)` (pass through, unauthenticated) and respond 404 to everything else — the tools host must never serve the app or read a session (do not touch cookies on that host). On the app host: runtime paths are still allowed (dev fallback when TOOLS_ORIGIN is unset, and the same paths work for both) — add `/api/tools/runtime` to `PUBLIC_PATHS` (they authenticate via the frame token, not the session). Everything else unchanged.

**apps/web/lib/tools/frameToken.ts** (jose HS256 with AUTH_SECRET, like lib/session.ts): `mintFrameToken(payload: FrameTokenPayload, ttlSec = 300)`, `verifyFrameToken(token): Promise<FrameTokenPayload|null>`; `FrameTokenPayload = { kind: 'install'; installId: string; spaceId: string } | { kind: 'preview'; spaceId: string; name: string }` plus `viewerId`. Tokens are single-purpose (`aud: 'visvine-tool-frame'`).

**apps/web/lib/tools/csp.ts**: `frameCsp(opts: { appOrigin: string; selfOrigin: string; mediaHosts?: string[] }): string` returning `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://storage.googleapis.com; font-src 'self' data:; connect-src 'none'; frame-ancestors <appOrigin>; base-uri 'none'; form-action 'none'` (plus any mediaHosts on img-src), and `frameHeaders(csp)` returning the full header set (`Content-Security-Policy`, `X-Frame-Options` omitted in favour of frame-ancestors, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: cross-origin`, `Cache-Control: no-store` for the document). Also `bundleHeaders()` for JS assets (`Content-Type: text/javascript; charset=utf-8`, CORP cross-origin, immutable cache for content-addressed URLs).

.env.example: document `TOOLS_ORIGIN` (dev value `http://127.0.0.1:3000`) with a comment on the prod subdomain.

Tests: origin parsing/host matching (with and without ports), proxy decisions are unit-testable only if you extract a pure `toolsHostDecision(host, pathname)` helper into origin.ts — do that and test it; frame token round-trip, expiry, wrong audience; CSP string contains/omits the right directives. Acceptance: tsc/lint/test clean; a manual `curl -H 'Host: 127.0.0.1:3000' http://localhost:3000/directory` with TOOLS_ORIGIN=http://127.0.0.1:3000 returns 404 (state in the outcome whether you ran it).

## Outcome

Built the cookie-less Tool frame origin and its host split. `lib/tools/origin.ts` reads `TOOLS_ORIGIN`/`NEXT_PUBLIC_APP_URL` at call time (never module load, so proxy and tests see env changes): `toolsOrigin()` (trimmed, trailing slashes dropped, and an unparseable/non-http value treated as unset rather than a hard failure), `appOrigin()` with the `http://localhost:3000` fallback, `toolsOriginConfigured()`, `isToolsHost()` (case-insensitive host[:port] compare with the protocol's default port folded in, IPv6-bracket safe, false when unset), `TOOL_RUNTIME_PATH_PREFIX`/`isToolRuntimePath()`, `frameUrl({token})`, and the pure `toolsHostDecision(host, pathname) -> 'app' | 'tool-runtime' | 'not-found'` that is the entirety of the proxy's tools-host branch.

`proxy.ts` calls that decision first: runtime paths on the tools host pass through unauthenticated, everything else on that host gets a plain 404 (`no-store`), and no cookie is read or written on that host either way. `/api/tools/runtime` was added to `PUBLIC_PATHS` so the identical URLs also work on the app host (the same-origin fallback while `TOOLS_ORIGIN` is unset) — they authenticate by frame token, not session. Nothing else in the proxy changed.

`lib/tools/frameToken.ts` mints/verifies HS256 tokens on `AUTH_SECRET` (same key-length guard as lib/session.ts, kept local because session.ts is edge-bundled), `aud: 'visvine-tool-frame'` so a session JWT can never be replayed as a frame token, default 300s TTL set as absolute epoch seconds so a non-positive TTL means "already expired"; verify checks signature/expiry/audience then the payload shape and returns null on anything else. `lib/tools/csp.ts` has `frameCsp` (the spec's directives verbatim; extra `mediaHosts` appended to img-src, and any source that isn't plain scheme://host[:port] is dropped rather than escaped so a caller can't write policy; `frame-ancestors 'self'` when appOrigin === selfOrigin, i.e. the same-origin fallback), `frameHeaders` (CSP + no-referrer + CORP cross-origin + nosniff + no-store + text/html, no X-Frame-Options) and `bundleHeaders({immutable = true})` (text/javascript, CORP cross-origin, one-year immutable or no-store for a working copy). `.env.example` documents `TOOLS_ORIGIN=http://127.0.0.1:3000` with the prod-subdomain/DNS note and the "leave unset" fallback.

Verification: 21 new tests across tests/tools-origin.test.ts (env parsing, host matching with and without ports plus the localhost-vs-127.0.0.1 case, runtime path matching, toolsHostDecision on both hosts and with TOOLS_ORIGIN unset, frameUrl, CSP directives/omissions/injection, both header sets) and tests/tools-frame-token.test.ts (install + preview round-trip, expiry, no-audience and wrong-audience, foreign signature, six malformed payloads). Full suite `node --import tsx --test tests/*.test.ts` = 615 pass / 0 fail. eslint on lib/tools + proxy.ts + both tests clean at --max-warnings=0. `tsc --noEmit` reports no errors in any file I touched (the run does fail on two pre-existing errors in lib/notes/entities.ts from another agent's in-flight `tool` entity-kind edit — not mine). knip flags only other agents' not-yet-imported wave-1 files, none of mine.

The literal `curl -H 'Host: 127.0.0.1:3000' http://localhost:3000/directory` was NOT run: port 3000 already has a dev server owned by someone else in this shared workspace, it has no TOOLS_ORIGIN in its env, and starting a second `next dev` would have shared/clobbered apps/web/.next. Instead I ran the real `proxy()` two ways from scratch space — in-process with fabricated NextRequests, and behind a bare HTTP server on :3111 (TOOLS_ORIGIN=http://127.0.0.1:3111) hit with real curl and spoofed Host headers. Results: `Host: 127.0.0.1:3111 /directory` → 404 text/plain no-store, `/api/auth/session` → 404, `/api/tools/runtime/frame?token=x` → pass-through, `Host: localhost:3111 /directory` → 307 to /signin, `/api/tools/runtime/frame` → pass-through; no set-cookie on any of them. Worth a real curl against a dev server with TOOLS_ORIGIN set once wave 2 lands the runtime routes (task 013's acceptance already does that).
