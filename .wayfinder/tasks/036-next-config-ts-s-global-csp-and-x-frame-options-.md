---
id: 036
title: next.config.ts's global CSP and X-Frame-Options override the Tool frame headers, making lib/tools/csp.ts inert
status: done
kind: fix
size: s
wave: 1
depends_on: []
touches: [apps/web/next.config.ts, apps/web/tests/tools-origin.test.ts]
created_by: 035
session: c33b7157-fe1e-4947-ad21-a18bb080729a
model: sonnet
effort: high
---

## Task

apps/web/next.config.ts#headers() applies `Content-Security-Policy` (with `frame-ancestors 'none'` and `connect-src 'self' https:`) plus `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin` to every path via the source pattern `/:path((?!api/oauth/authorize).*)`. That pattern also matches `/api/tools/runtime/*`, and Next's config headers WIN over headers a route handler sets under the same name.

Proven empirically: a probe route handler at app/api/tools/runtime/frame/route.ts returning `frameHeaders(frameCsp({appOrigin:'https://visvine.com', selfOrigin:'https://tools.visvine.com'}))`, served from a real production build, responded with ONLY the app-wide CSP; the frame's `default-src 'none' … connect-src 'none' … frame-ancestors https://visvine.com` and its `Referrer-Policy: no-referrer` were both discarded, and `X-Frame-Options: DENY` was added. (Headers the config does NOT set — `Cross-Origin-Resource-Policy`, `Cache-Control` — did survive, so it is specifically name collisions.)

Consequences once task 013 lands the real routes: the Tool iframe cannot render at all (`frame-ancestors 'none'` + XFO DENY), and the exfiltration control the whole design rests on (`connect-src 'none'`) is replaced by `connect-src 'self' https:`.

Fix in next.config.ts, mirroring the existing `/api/oauth/authorize` carve-out: widen the negative lookahead to also exclude the Tool runtime prefix, e.g. `'/:path((?!api/oauth/authorize|api/tools/runtime/).*)'`, and add a third `source` entry for `/api/tools/runtime/:path*` carrying only the transport headers that do not collide with what lib/tools/csp.ts writes — `Strict-Transport-Security` and `Permissions-Policy` — and deliberately NOT `Content-Security-Policy`, `X-Frame-Options` or `Referrer-Policy`, which the runtime routes own. Leave the comment block explaining why (the frame needs a per-response CSP the config cannot express, and XFO has no origin-list form).

Add a test that pins this so it cannot regress: the cheapest honest one asserts the header config itself — import the config's `headers()` result and assert no entry whose `source` matches `/api/tools/runtime/frame` sets `Content-Security-Policy` or `X-Frame-Options`, while `/directory` still gets both.

## Outcome

Fixed the header collision: next.config.ts's app-wide CSP/X-Frame-Options/Referrer-Policy no longer match `/api/tools/runtime/*`, so route-set headers from lib/tools/csp.ts survive instead of being silently overridden.

Details: widened the negative lookahead on the catch-all `source` from `(?!api/oauth/authorize)` to `(?!api/oauth/authorize|api/tools/runtime/)`, and added a third header block scoped to `/api/tools/runtime/:path*` carrying only the non-colliding transport headers (Strict-Transport-Security, Permissions-Policy) — deliberately omitting Content-Security-Policy, X-Frame-Options, and Referrer-Policy, which lib/tools/csp.ts's frameHeaders() owns. Added a comment explaining why (the frame needs a per-response CSP naming its own appOrigin, which the static config can't express, and XFO has no origin-list form).

Added a pinning test in tests/tools-origin.test.ts that imports the actual next.config default export and Next's own vendored `path-to-regexp` matcher (next/dist/compiled/path-to-regexp — same matcher Next uses internally to compile `source` patterns), computes the merged header set for `/api/tools/runtime/frame`, `/directory`, and `/api/oauth/authorize`, and asserts: the runtime path gets no CSP/XFO/Referrer-Policy but does get STS + Permissions-Policy; `/directory` still gets the full CSP (frame-ancestors 'none') and XFO: DENY; `/api/oauth/authorize` still gets its widened form-action CSP and XFO: DENY.

Verified: `node --import tsx --test tests/tools-origin.test.ts` (13/13 pass) and the full `tests/tools-*.test.ts` suite (125/125 pass); `pnpm exec tsc --noEmit` clean; `pnpm exec eslint next.config.ts tests/tools-origin.test.ts --max-warnings=0` clean.
