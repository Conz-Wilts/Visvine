---
id: 062
title: Verify wave 6 (round 2)
status: done
kind: verify
size: null
wave: 6
depends_on: []
touches: []
created_by: null
session: 835c445f-05ce-4874-9692-694b0b6924e7
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 6.

## Outcome

PASS: PASS — all five gates zero on the final tree, both live suites pass, and the production build succeeds.

GATES (whole tree, run by me)
- `tsc --noEmit` exit 0 · `pnpm lint` (eslint --max-warnings=0) exit 0 · `pnpm test` 991/991 pass, 33 suites, 0 fail · `knip` 0 findings.
- BUILD (not run in round 1): `next build` exit 0, 195 routes including all Tools routes (/t/[slug], /tools, /tools/preview/[name]). Built in an isolated gitignored copy with a node_modules junction so the running dev server's `.next` survived; the copy was removed afterwards and `git status` is byte-identical to the start of this task.

LIVE (dev server on :3000, TOOLS_ORIGIN=http://127.0.0.1:3000)
- `verify:wayfinder-tool` — 21 passed, 0 failed, re-run after 061's edit. runTask now reports DISPATCHED/REFUSED only.
- `verify:tools:escape` — 31 passed, 0 failed, including 057's "a tool cannot author an agent brief it did not declare" and 058's step 0 manifest guard.

THE ROUND-1 ISSUE (061) IS ACTUALLY FIXED
`scripts/verify-wayfinder-tool.ts:482-490` — the `sealed` branch is gone. `briefOk` requires `written|present`, and the check demands `dispatched || refused`; anything else falls to an `UNREADABLE` verdict that fails the check. A regression of the brief-write path (bridge refusing a declared brief) would now surface as `brief refused` → UNREADABLE → FAIL, not a silent pass. The stale narration above it was rewritten to describe only the two live verdicts. Confirmed stable on a re-run where the brief already existed (status `present`, not `refused` — create-only doesn't re-attempt).

CROSS-CHECKS I RAN RATHER THAN TOOK ON TRUST
- Built manifest bakes the origin: my isolated build with `TOOLS_ORIGIN=http://127.0.0.1:3000` produced `frame-src 'self' http://127.0.0.1:3000` in `.next/routes-manifest.json` under the catch-all `/:path*` header entry — 058's premise reproduced independently.
- 058's CI `docker cp` path resolves: `.next/standalone/apps/web/.next/routes-manifest.json` exists in the real standalone tree, and the Dockerfile's runner does `COPY --from=builder /app/apps/web/.next/standalone ./`, so `/app/apps/web/.next/routes-manifest.json` is the right path in the final image (the step `docker create`s the final image, not the builder stage).
- Re-read 057's `agentBriefExemption` for holes: `agents/live/**` is 3 segments so `agentBriefName` returns null; bare `*` is filtered before `refuseAgent`; append is refused unconditionally; the existence read is last so an oversized body costs no round trip; `normalizeNotePath` kills traversal upstream. Comments in `bridge.ts`, `sdkDocs.ts`, `examples/tools/wayfinder/{index.md,data.js,ui.tsx}` and `seed-wayfinder-tool.ts` all now describe create-only rather than the old blanket seal — no stale "no Tool may author a brief" text left in the wave's diff.

NITS, NOT WORTH A TASK
- Two stray gitignored files survive in `apps/web/.next-verify/` (`trace`, `_events.json`) from 058's build-twice check.
- Root `CLAUDE.md` is gitignored (.gitignore:34), so tasks 021/027's Tools subsection lives only in this working copy and the checkpoint will not commit it. Whether that file should be tracked is the human's call.
- deploy.yml's `--set-env-vars=…,TOOLS_ORIGIN=${{ vars.TOOLS_ORIGIN }}` expands to a trailing `TOOLS_ORIGIN=` when the repo variable is unset. Current gcloud accepts an empty value there and `toolsOrigin()` treats it as null (documented same-origin fallback), but it is the one line in 058 that can't be exercised locally.
- Uninstall still leaves a dead `featureConfig.enabled['tool:<slug>']` key (027 flagged; harmless).
- `check_tool` doesn't warn when a Tool declares an `agents/` write glob with no named agents (057 left it deliberately; the trap is much narrower now).
- Writing a brief also creates/updates `agents/index.md` (a children listing) — a benign side-effect write inside a sealed namespace the seal's comments don't mention.
- `CLOUD_SQL_CONNECTION_NAME=` in docs/tools.md is bash syntax; in PowerShell `$env:X=''` deletes the variable and the local-DB guard refuses. Worth a word for anyone running these from PowerShell.
