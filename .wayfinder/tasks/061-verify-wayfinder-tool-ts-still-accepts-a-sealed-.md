---
id: 061
title: verify-wayfinder-tool.ts still accepts a SEALED runTask, so a regression of the brief-write path would pass silently
status: done
kind: fix
size: s
wave: 6
depends_on: []
touches: [apps/web/scripts/verify-wayfinder-tool.ts]
created_by: 060
session: 19ba7f76-bf34-459c-bbc2-d4e6dbd4aba7
model: sonnet
effort: high
---

## Task

`apps/web/scripts/verify-wayfinder-tool.ts` step 5 (`runTask`, around lines 455-510) was written when `agents/` was sealed against every Tool write. Task 057 narrowed the seal so a Tool may CREATE the brief of an agent its perimeter names, and the Wayfinder board now does exactly that — I confirmed `agents/wayfinder-visvine-tools-025.md` is written live. The script has not caught up:

1. The `sealed` verdict is dead code: it requires `outcome.brief.status === 'refused'` AND `/no tool may write there/i` in the reason, and bridge.ts no longer emits that phrasing for a declared brief path.
2. The check still accepts `dispatched || refused || sealed`. That is the problem worth fixing: if the exemption in `lib/tools/bridge.ts#agentBriefExemption` ever regressed and Run stopped writing briefs, the project's acceptance test would still report PASS. The plan's Context line — "Run writes/uses an agent brief and triggers a run" — would break with no signal.
3. The comment block above it ("sealed: `agents/` is sealed against Tool writes whatever a perimeter declares … The seal is what this space answers today") now describes behaviour that no longer exists, and the `if (verdict === 'SEALED')` note prints "A Tool may not author an agent brief".

Fix: drop the `sealed` branch and its note entirely, and require the brief to be present or written — i.e. assert `outcome.brief.status === 'written' || outcome.brief.status === 'present'` (the shape `scripts/seed-wayfinder-tool.ts` step 7 already asserts after 057 changed it), with the run then being either `queued` (DISPATCHED) or `refused` with a non-empty detail (REFUSED, which is what a local run gives — no model key, agent not activated). Rewrite the comment block to describe the two remaining verdicts and why ACTIVATION is where it stops. Task 057's outcome explicitly handed this over as a known loose end.

Verify with `CLOUD_SQL_CONNECTION_NAME= TOOLS_ORIGIN=http://127.0.0.1:3000 pnpm --filter @visvine/web verify:wayfinder-tool` (bash, not PowerShell — PowerShell drops an empty env var and the local-DB guard then refuses) against `pnpm dev`; it must still be 21/21, and the runTask detail line must name DISPATCHED or REFUSED, never SEALED. Note the brief now already exists in the local DB, so a re-run exercises the `present` path; delete `agents/wayfinder-visvine-tools-025.md` first if you want to see the `written` path too.

## Outcome

Fixed apps/web/scripts/verify-wayfinder-tool.ts step 5 (runTask) to match the narrowed seal from task 057: dropped the dead `sealed` verdict branch (bridge.ts no longer emits "no tool may write there" for a declared brief path) and the `if (verdict === 'SEALED')` note. The check now requires `outcome.brief.status === 'written' || 'present'` (matching the assertion already in scripts/seed-wayfinder-tool.ts step 7) with the run being either `queued` (DISPATCHED, non-empty run id) or `refused` (REFUSED, non-empty detail) — no third silently-accepted verdict. Rewrote the comment block above it to describe just these two remaining verdicts and note that ACTIVATION (agents/live/) stays admin-only and untouched by the brief-write exemption.

Verified: `tsc --noEmit` clean. Ran `CLOUD_SQL_CONNECTION_NAME= TOOLS_ORIGIN=http://127.0.0.1:3000 pnpm --filter @visvine/web verify:wayfinder-tool` (bash) against the already-running `pnpm dev` on :3000 — 21/21 passed, with the runTask detail line reading `REFUSED · brief present · run refused — The agent must be active before it can be run — ask a space admin to activate it.` (brief was `present` since a prior run's seed had already written it; never SEALED).
