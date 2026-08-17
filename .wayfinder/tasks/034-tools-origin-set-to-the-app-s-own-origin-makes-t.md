---
id: 034
title: TOOLS_ORIGIN set to the app's own origin makes the proxy 404 the entire site
status: done
kind: fix
size: xs
wave: 1
depends_on: []
touches: [apps/web/lib/tools/origin.ts, apps/web/tests/tools-origin.test.ts]
created_by: 032
session: b11b4684-2dc7-4aea-a903-bfc7266ddaca
model: sonnet
effort: high
---

## Task

apps/web/lib/tools/origin.ts#toolsHostDecision returns 'not-found' for every path that is not under /api/tools/runtime/ once the request's Host matches TOOLS_ORIGIN. It never checks whether TOOLS_ORIGIN is the app's own origin, so setting the two equal takes the whole app down.

Reproduced (probe calling the real toolsHostDecision with NEXT_PUBLIC_APP_URL=https://visvine.com and TOOLS_ORIGIN=https://visvine.com, Host: visvine.com):
  /                        -> not-found
  /directory               -> not-found
  /api/auth/session        -> not-found
  /signin                  -> not-found
  /api/tools/runtime/frame -> tool-runtime

proxy.ts turns each 'not-found' into a plain 404, so every page and every session-bearing API on the production host answers 404 with no log and no warning. This is a realistic misconfiguration, not a contrived one: the docs correctly say the tools origin is "the SAME Cloud Run service", and .env.example ships TOOLS_ORIGIN uncommented, so an operator setting it before the DNS record and domain mapping exist — or copying the app URL — gets a total outage instead of the documented fallback.

It also contradicts the plan's own stated risk posture: "until [DNS] is done, TOOLS_ORIGIN unset falls back to same-origin + sandbox with a logged warning, never a hard failure." A TOOLS_ORIGIN that cannot possibly be a separate origin should degrade to exactly that fallback.

Fix: in readOrigin/toolsOrigin, treat a TOOLS_ORIGIN whose canonical host equals appOrigin()'s canonical host as unset — return null, so toolsOriginConfigured() is false, isToolsHost() is false, toolsHostDecision() is 'app' everywhere, and frameUrl() falls back to the app origin. Compare with the existing canonicalHost helper so default ports fold (https://visvine.com vs https://visvine.com:443). Emit a one-line console.warn naming the variable, matching how the plan describes the fallback, and make sure it cannot fire per-request in a hot path (the proxy calls this on every request) — warn at most once, or only where frameUrl/toolsOriginConfigured is called.

Note frameCsp already handles appOrigin === selfOrigin by emitting `frame-ancestors 'self'`, so the same-origin fallback path is already correct downstream; this only closes the gap in the host split.

Add tests to tests/tools-origin.test.ts: TOOLS_ORIGIN equal to NEXT_PUBLIC_APP_URL yields toolsOriginConfigured() === false and toolsHostDecision(appHost, '/directory') === 'app'; the port-folded variant (https://visvine.com vs https://visvine.com:443) is also treated as equal; and a genuinely different host (127.0.0.1:3000 vs localhost:3000) still splits as it does today.

## Outcome

Fixed toolsOrigin() to treat a TOOLS_ORIGIN whose canonical host equals the app's own origin as unset, closing the outage where a configured TOOLS_ORIGIN equal to NEXT_PUBLIC_APP_URL made toolsHostDecision() return 'not-found' for every non-runtime path on the whole site.

Detail: added sameCanonicalOrigin() to lib/tools/origin.ts, reusing the existing canonicalHost() helper (so default ports fold, e.g. https://visvine.com vs https://visvine.com:443). toolsOrigin() now compares the parsed TOOLS_ORIGIN against appOrigin() and returns null when they match — this flows through automatically to toolsOriginConfigured(), isToolsHost(), toolsHostDecision() (all 'app'), and frameUrl() (falls back to the app origin). Added a module-level warnedSameOriginAsApp flag so the console.warn naming TOOLS_ORIGIN fires at most once total, not per-request, since toolsHostDecision runs on every request via proxy.ts.

Added three test cases to tests/tools-origin.test.ts: equal TOOLS_ORIGIN/app origin → toolsOriginConfigured() false + toolsHostDecision(appHost, '/directory') === 'app'; the port-folded variant (both directions: :443 on either side) also treated as equal; and a genuinely different host (127.0.0.1:3000 vs localhost:3000) still splits as before.

Verified: `pnpm exec node --import tsx --test tests/tools-origin.test.ts` — 12/12 pass, warn line printed exactly once across the whole run. `pnpm exec tsc --noEmit` clean. `pnpm exec eslint lib/tools/origin.ts tests/tools-origin.test.ts --max-warnings=0` clean.
