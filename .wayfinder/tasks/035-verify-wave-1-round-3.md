---
id: 035
title: Verify wave 1 (round 3)
status: done
kind: verify
size: null
wave: 1
depends_on: []
touches: []
created_by: null
session: 162904a3-54b5-4e67-83ef-665896a9df3f
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 1.

## Outcome

FAIL: Wave 1 gates all pass: `tsc --noEmit` clean; `pnpm lint` (eslint --max-warnings=0) clean; `pnpm test` 724/724 pass, 0 fail; `knip` reports zero. `pnpm build` was NOT runnable in-place (another agent holds a dev server on :3000 and `next build` would clobber the shared `.next`), so I copied apps/web into scratch and ran a real `next build` there — it succeeds. `prisma migrate status` says up to date and `prisma migrate diff` against the live DB shows no drift from the four new Tool tables (only the pre-existing pgvector index diff that apply-sql-functions.mjs owns). I read the full wave diff against the plan; tasks 003-009 and the three round-1/2 fixes (030, 031, 033, 034) all did what their outcomes claim — no stubs, no dead code, entities.ts's duplicate helper pair is genuinely deleted and callers moved to lib/tools/config.ts.

Two real defects, both found by probing rather than reading:

1. next.config.ts's global `headers()` silently overrides everything lib/tools/csp.ts produces. I built a probe route at /api/tools/runtime/frame returning `frameHeaders(frameCsp(...))` and served it from the production build: the response carried the app-wide CSP (`frame-ancestors 'none'`, `connect-src 'self' https:`) plus `X-Frame-Options: DENY`, and the frame's own CSP and `Referrer-Policy: no-referrer` were gone. Config-level headers win on name collision. As it stands task 008's whole CSP module is inert and a Tool iframe could not render at all.

2. The perimeter matcher rejects `..` in the *pattern* but not in the *subject*. With `read: ["deals/**"]`, `refuseRead(p, "deals/../people/secret.md")` returns null — allowed. Same for write, and for `/deals/../secret.md`. Whether it becomes an escape depends entirely on wave 2 normalising before it calls the gate, which is the wrong place for the feature's central security control to be load-bearing.

Nits, not filed: (a) esbuild is not traced into `.next/standalone` yet — correct today, since nothing outside tests imports lib/tools/compile.ts, but task 004's standalone question stays open until wave 2 wires the compile hook (re-check in wave 6). (b) proxy.ts's PUBLIC_PATHS entry `"/api/tools/runtime"` is a `startsWith` prefix and so is looser than `isToolRuntimePath`'s `/api/tools/runtime/` — `/api/tools/runtimeX` would be public on the app host. (c) `.env.example` now ships `TOOLS_ORIGIN=http://127.0.0.1:3000` uncommented, so a developer who opens the app at 127.0.0.1:3000 instead of localhost:3000 gets a bare 404 for the entire site with nothing explaining why — worth a line in the docs task (021).
