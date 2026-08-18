---
id: 058
title: Make the tools-origin frame-src survive the production build
status: done
kind: build
size: s
wave: 6
depends_on: []
touches: [.github/workflows/deploy.yml, apps/web/Dockerfile, apps/web/next.config.ts, docs/tools.md, apps/web/scripts/verify-tools-escape.ts]
created_by: 024
session: ef9b032c-82d2-4bb7-bfad-31b0f13f3c3e
model: sonnet
effort: high
---

## Task

Task 024's escape suite found that the app's own CSP (`apps/web/next.config.ts`) shipped `frame-src 'self'`, which blocks the Tool iframe whenever TOOLS_ORIGIN names a separate host — i.e. no Tool would ever render in production once the `tools.visvine.com` domain mapping exists. 024 fixed the directive itself (`frame-src` now names `toolsOrigin()`), and the live escape run passes against `pnpm dev` with `TOOLS_ORIGIN=http://127.0.0.1:3000`. What it did NOT fix is the deployment half.

Next evaluates `headers()` into `.next/routes-manifest.json` at BUILD time, and the standalone production server serves from that manifest — verified locally: the checked-in dev manifest still carries the pre-fix `frame-src 'self'` while the live dev server serves the new value, because dev re-reads next.config. `docs/tools.md`'s runbook (line ~420) adds TOOLS_ORIGIN only as a Cloud Run RUNTIME env var (`--set-env-vars`), so a prod image built without it would bake `frame-src 'self'` and Tools would silently fail to render behind the very origin split that is meant to protect them.

Do: (1) confirm the build-time-vs-runtime behaviour for `output: standalone` on Next 16 (build the app twice, with and without TOOLS_ORIGIN, and read `routes-manifest.json`); (2) if it is baked, pass TOOLS_ORIGIN into the Docker build (build arg in `.github/workflows/deploy.yml` + Dockerfile ENV) as well as the runtime env, or move the tools-origin carve-out somewhere evaluated per-request (proxy.ts already runs the host split and could set the header); (3) update the `docs/tools.md` runbook so the DNS/domain-mapping steps and the build arg are one checklist; (4) add a check to `scripts/verify-tools-escape.ts` or a unit test that fails when the built manifest's `frame-src` omits a configured tools origin, so this cannot regress silently.

## Outcome

Confirmed TOOLS_ORIGIN was build-time-only baked into `frame-src` and fixed the deploy pipeline so it survives. Verified by building the app twice (isolated .next-verify copy per the documented Windows workaround): with TOOLS_ORIGIN=http://127.0.0.1:3000 present at `next build` time, routes-manifest.json's frame-src is `'self' http://127.0.0.1:3000`; with it absent, frame-src is `'self'` only — confirming next.config.ts#headers() bakes into routes-manifest.json once, at build time, and the standalone server.js never re-reads next.config.ts.

Fix: root `Dockerfile` (not `apps/web/Dockerfile` — that path doesn't exist; the real Dockerfile is at repo root) now takes `ARG TOOLS_ORIGIN=""` / `ENV TOOLS_ORIGIN=$TOOLS_ORIGIN` before `next build` runs. `.github/workflows/deploy.yml` now passes `--build-arg TOOLS_ORIGIN=${{ vars.TOOLS_ORIGIN }}` to `docker build`, still sets the matching runtime `--set-env-vars` (needed separately for the proxy's host split and `frameUrl()`), and adds a "Verify TOOLS_ORIGIN survived the build" step that `docker create`s the built image, `docker cp`s out `.next/routes-manifest.json`, and fails the deploy if frame-src doesn't name the configured origin — a CI gate against exactly this regression, gated behind a single GitHub Actions repo variable (`TOOLS_ORIGIN`) so turning on the separate origin later is one `gh variable set`, no YAML edit.

`docs/tools.md`'s Ops runbook now explains the build-vs-runtime distinction and collapses DNS + domain mapping + the repo variable into one checklist; the Verification section documents the new step 0 guard. `next.config.ts` needed no change — 024's CSP fix (`frame-src` naming `toolsOrigin()`) was already correct; the bug was entirely in the deploy plumbing.

`apps/web/scripts/verify-tools-escape.ts` gained a step 0 (`checkBuiltManifestBakesToolsOrigin`) that, when `apps/web/.next/routes-manifest.json` exists and `TOOLS_ORIGIN` is set in the shell, fails unless the manifest's frame-src names it — SKIPs (not fails) when no manifest is on disk (plain `pnpm dev` checkout). Smoke-tested all three paths (match/mismatch/unset) against the real dev manifest.

Verified: `tsc --noEmit` clean, `eslint . --max-warnings=0` clean, `node --test tests/*.test.ts` 991/991 pass, `knip` zero findings. Scratch build artifacts (`apps/web/.next-verify/tools-origin-check`) were created for the build-twice verification and removed afterward via PowerShell (the Bash sandbox refuses recursive deletes inside the shared workspace even for gitignored dirs I created).
