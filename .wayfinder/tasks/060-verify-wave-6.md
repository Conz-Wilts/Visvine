---
id: 060
title: Verify wave 6
status: done
kind: verify
size: null
wave: 6
depends_on: []
touches: []
created_by: null
session: 1a66ca9f-3fb6-4a04-b45b-7b7468f424ba
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 6.

## Outcome

PASS: All four gates are zero on the final tree and both live suites pass against `pnpm dev`.

GATES (run by me, whole tree)
- `tsc --noEmit` clean · `pnpm lint` (eslint --max-warnings=0) clean · `pnpm test` 991/991 pass, 33 suites, 0 fail · `knip` 0 findings.

LIVE (dev server on :3000, TOOLS_ORIGIN=http://127.0.0.1:3000)
- `verify:wayfinder-tool` — 21 passed, 0 failed. The acceptance test still holds after 057 changed the bridge underneath it (057 had not re-run it).
- `verify:tools:escape` — 31 passed, 0 failed, including 057's new "a tool cannot author an agent brief it did not declare" and 058's step 0 manifest guard. I confirmed step 0 genuinely fires rather than skipping: the on-disk `apps/web/.next/routes-manifest.json` bakes `frame-src 'self' http://127.0.0.1:3000`.

CROSS-CHECKS I RAN RATHER THAN TOOK ON TRUST
- 057's seal narrowing works end to end, not just in unit tests: `agents/wayfinder-visvine-tools-025.md` now exists in the local DB, written by the Tool through the bridge. Previously the Run flow could only report a refusal, so the plan's "Run writes/uses an agent brief" line is now true of shipped code.
- Reviewed `agentBriefExemption` for holes. `agents/live/**` (3 segments) can't reach it; `nameMatch` treats `**` as a literal prefix so it matches no real name, and bare `*` is filtered before matching, so neither is a bypass; append is refused unconditionally; the create-only read is last so an oversized body costs no round trip. `normalizeNotePath` still kills traversal before any of it.
- 058's CI gate is wired to real shapes: the catch-all header entry's `source` in routes-manifest.json really is `/:path((?!api/oauth/authorize|api/tools/runtime/).*)`, so `startsWith('/:path')` picks exactly it; and `.next/standalone/apps/web/.next/routes-manifest.json` really exists in the standalone tree, so the step's `docker cp` path resolves. `toolsOrigin()` returns null for an empty string, so `--build-arg TOOLS_ORIGIN=` / `--set-env-vars=...,TOOLS_ORIGIN=` with the repo variable unset degrades to the documented same-origin fallback rather than breaking.
- 027's knip.json claim checked: `CodeDiff.tsx` is genuinely imported by ToolReviewPanel and knip is still 0 with the exemption gone.

NITS, NOT WORTH A TASK
- Root `CLAUDE.md` is gitignored (.gitignore:34) and untracked, so tasks 021/027's Tools subsection lives only in this working copy and the checkpoint will not commit it. Nothing in it is wrong today; whether that file should be tracked is the human's call, not an agent's.
- Writing a brief also causes the note store to create/update `agents/index.md` (a `type: Index` children listing). Benign — it can only list briefs the Tool was allowed to create — but it is a side-effect write inside a sealed namespace that the seal's comments don't mention.
- Uninstall still leaves a dead `featureConfig.enabled['tool:<slug>']` key (027 flagged, behaviourally harmless).
- `check_tool` still doesn't warn when a Tool declares an `agents/` write glob with no named agents (057 left it deliberately; the trap is much narrower now).
- Two stray files survive in the gitignored `apps/web/.next-verify/` (`trace`, `_events.json`) from 058's build-twice check; 058 removed the subdirectory but not these.
- `CLOUD_SQL_CONNECTION_NAME=` as documented is bash syntax; in PowerShell `$env:X=""` deletes the variable and the guard refuses. docs/tools.md's gotcha box is right for bash — worth a word if anyone runs these from PowerShell.
