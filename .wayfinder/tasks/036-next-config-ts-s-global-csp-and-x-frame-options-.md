---
id: 036
title: next.config.ts's global CSP and X-Frame-Options override the Tool frame headers, making lib/tools/csp.ts inert
status: todo
kind: fix
size: s
wave: 1
depends_on: []
touches: [apps/web/next.config.ts, apps/web/tests/tools-origin.test.ts]
created_by: 035
session: null
model: null
effort: null
---

## Task

apps/web/next.config.ts#headers() applies `Content-Security-Policy` (with `frame-ancestors 'none'` and `connect-src 'self' https:`) plus `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin` to every path via the source pattern `/:path((?!api/oauth/authorize).*)`. That pattern also matches `/api/tools/runtime/*`, and Next's config headers WIN over headers a route handler sets under the same name.

Proven empirically: a probe route handler at app/api/tools/runtime/frame/route.ts returning `frameHeaders(frameCsp({appOrigin:'https://visvine.com', selfOrigin:'https://tools.visvine.com'}))`, served from a real production build, responded with ONLY the app-wide CSP; the frame's `default-src 'none' … connect-src 'none' … frame-ancestors https://visvine.com` and its `Referrer-Policy: no-referrer` were both discarded, and `X-Frame-Options: DENY` was added. (Headers the config does NOT set — `Cross-Origin-Resource-Policy`, `Cache-Control` — did survive, so it is specifically name collisions.)

Consequences once task 013 lands the real routes: the Tool iframe cannot render at all (`frame-ancestors 'none'` + XFO DENY), and the exfiltration control the whole design rests on (`connect-src 'none'`) is replaced by `connect-src 'self' https:`.

Fix in next.config.ts, mirroring the existing `/api/oauth/authorize` carve-out: widen the negative lookahead to also exclude the Tool runtime prefix, e.g. `'/:path((?!api/oauth/authorize|api/tools/runtime/).*)'`, and add a third `source` entry for `/api/tools/runtime/:path*` carrying only the transport headers that do not collide with what lib/tools/csp.ts writes — `Strict-Transport-Security` and `Permissions-Policy` — and deliberately NOT `Content-Security-Policy`, `X-Frame-Options` or `Referrer-Policy`, which the runtime routes own. Leave the comment block explaining why (the frame needs a per-response CSP the config cannot express, and XFO has no origin-list form).

Add a test that pins this so it cannot regress: the cheapest honest one asserts the header config itself — import the config's `headers()` result and assert no entry whose `source` matches `/api/tools/runtime/frame` sets `Content-Security-Policy` or `X-Frame-Options`, while `/directory` still gets both.
