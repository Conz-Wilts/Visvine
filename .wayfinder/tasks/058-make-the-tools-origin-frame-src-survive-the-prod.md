---
id: 058
title: Make the tools-origin frame-src survive the production build
status: todo
kind: build
size: s
wave: 6
depends_on: []
touches: [.github/workflows/deploy.yml, apps/web/Dockerfile, apps/web/next.config.ts, docs/tools.md, apps/web/scripts/verify-tools-escape.ts]
created_by: 024
session: null
model: null
effort: null
---

## Task

Task 024's escape suite found that the app's own CSP (`apps/web/next.config.ts`) shipped `frame-src 'self'`, which blocks the Tool iframe whenever TOOLS_ORIGIN names a separate host — i.e. no Tool would ever render in production once the `tools.visvine.com` domain mapping exists. 024 fixed the directive itself (`frame-src` now names `toolsOrigin()`), and the live escape run passes against `pnpm dev` with `TOOLS_ORIGIN=http://127.0.0.1:3000`. What it did NOT fix is the deployment half.

Next evaluates `headers()` into `.next/routes-manifest.json` at BUILD time, and the standalone production server serves from that manifest — verified locally: the checked-in dev manifest still carries the pre-fix `frame-src 'self'` while the live dev server serves the new value, because dev re-reads next.config. `docs/tools.md`'s runbook (line ~420) adds TOOLS_ORIGIN only as a Cloud Run RUNTIME env var (`--set-env-vars`), so a prod image built without it would bake `frame-src 'self'` and Tools would silently fail to render behind the very origin split that is meant to protect them.

Do: (1) confirm the build-time-vs-runtime behaviour for `output: standalone` on Next 16 (build the app twice, with and without TOOLS_ORIGIN, and read `routes-manifest.json`); (2) if it is baked, pass TOOLS_ORIGIN into the Docker build (build arg in `.github/workflows/deploy.yml` + Dockerfile ENV) as well as the runtime env, or move the tools-origin carve-out somewhere evaluated per-request (proxy.ts already runs the host split and could set the header); (3) update the `docs/tools.md` runbook so the DNS/domain-mapping steps and the build arg are one checklist; (4) add a check to `scripts/verify-tools-escape.ts` or a unit test that fails when the built manifest's `frame-src` omits a configured tools origin, so this cannot regress silently.
