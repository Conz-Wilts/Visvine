---
id: 057
title: Decide the `agents/` write seal vs. the Wayfinder Run flow
status: done
kind: build
size: m
wave: 6
depends_on: []
touches: [apps/web/lib/tools/bridge.ts, apps/web/tests/tools-bridge.test.ts, docs/tools.md, docs/wayfinder-tool.md, examples/tools/wayfinder/**]
created_by: 025
session: cb6b165b-c7c7-47b6-a0a9-e28fe271b2bc
model: opus
effort: xhigh
---

## Task

The Wayfinder Tool (025) hit the one wall the acceptance test found: `lib/tools/bridge.ts#SEALED_WRITE_DIRS` refuses every Tool write into `agents/`, `connectors/` and `tools/`, whatever the perimeter declares — because an agent brief runs unattended on the space's model key. But the plan's own Context says the harness rebuild's Run button 'writes/uses an agent brief and triggers a run via the existing agents feature'. Both cannot be true.

Today the Wayfinder Tool attempts the write, shows Visvine's real refusal, and hands the person the exact brief markdown to save at `agents/wayfinder-<project>-<id>.md` (see docs/wayfinder-tool.md, 'Limits'). That is honest and shippable, but it is a decision nobody has actually made.

Settle it, then implement whichever way it lands:

**(a) Narrow the seal.** Let a Tool write `agents/<name>.md` when its declared `perimeter.agents` matches that name — the brief is already member-writable (`contextService#writeDenial` only guards `agents/live/`), and ACTIVATION, which is what makes a brief run, stays admin-only. The seal on `agents/live/`, `connectors/` and `tools/` is unchanged. This needs: the narrowed rule in `checkWrite`, a note in the perimeter/bridge doc comments explaining why the brief is different from the activation, tests in `tests/tools-bridge.test.ts` (a declared name is allowed; an undeclared one, `agents/live/**` and a wildcard-only perimeter are all still refused), a line in the adversarial suite (024) proving a Tool cannot write a brief it did not declare, and the `examples/tools/wayfinder/` Run path simplified to the write-then-run flow.

**(b) Keep the seal.** Then say so in docs/tools.md's perimeter section (it currently does not mention `SEALED_WRITE_DIRS` at all), and consider whether `check_tool` should warn an author that a declared `agents/` write glob can never be exercised — a perimeter entry that is always refused is a trap for the next author.

Either way, docs/tools.md and docs/wayfinder-tool.md must end up agreeing with the code, and the plan's Context line about the Run button must be reconciled with what shipped. Ask the human if the trade-off is not obviously (a) or (b) from the code.

## Outcome

Settled it as (a) with one refinement the human chose: the `agents/` seal is narrowed so a Tool may **create** `agents/<name>.md` when its own `perimeter.agents` names that agent, and may never rewrite one. `agents/live/**`, `connectors/`, `tools/`, `context.append` under `agents/`, and any undeclared agent stay sealed. The plan's Context line ("Run writes/uses an agent brief and triggers a run via the existing agents feature") is now true of what shipped.

Why (a), and why create-only. The brief is member-writable by design (`contextService#writeDenial` guards `agents/live/` alone) because ACTIVATION is what puts an agent on the space's model key, and `claimManualRun` refuses an inactive agent — so a Tool-written brief starts nothing; a person still says yes. The hole in plain (a), which I put to the human: `lib/agents/hooks.ts` rule 2 auto-deactivates on a *member's* brief edit but deliberately exempts admins, so a Tool allowed to overwrite briefs could swap an approved agent's instructions while an admin was viewing and reach connectors it never declared. Create-only closes that, and a Tool has no delete and no move, so it cannot free a path either.

Code: `bridge.ts` gains `agentBriefName` / `declaresAgentByName` / `agentBriefExemption` (a bare `*` names nobody; a prefix like `wayfinder-*` counts, matched through the existing `refuseAgent` rather than a second copy of the matcher). `checkWrite` is now async, takes the mode and deps, and does the existence read (`readVisible`) last and only for an exempt brief path — the byte cap moved above it so an oversized body costs no round trip. Doc comments on `SEALED_WRITE_DIRS` and the new helpers explain brief vs. activation.

Verified: `pnpm --filter @visvine/web exec tsc --noEmit` clean, `pnpm lint` clean, `pnpm test` 991/991 pass (was 990 — 7 new bridge tests: create allowed + audited, undeclared name, wildcard-only perimeter, `agents/live/`, existing brief, append; plus 1 adversarial test), `knip` zero. Compiled the edited `examples/tools/wayfinder/` sources in-process via `compileToolUi`/`compileToolData` — ui 28,276 B, data 15,798 B, no diagnostics. I did NOT re-run the live seed against the local DB (026 is working the same space in this wave); the seed's step 7 now asserts the brief is written rather than accepting the seal.

Out-of-scope edits, all minimal and all landed: `tests/tools-escape.test.ts` + `scripts/verify-tools-escape.ts` got the adversarial line the task asked for (a hostile Tool with `write: ["**"], agents: ["*"]` cannot author a brief; the live one widens the write globs on purpose so the seal, not the glob, is what refuses, and the path joins OWN_NOTES for cleanup); `scripts/seed-wayfinder-tool.ts` narration + step 7 assertion; `lib/tools/sdkDocs.ts` TOOL_AUTHOR_GUIDE gained the rule (it never mentioned the seal at all, which was the author trap option (b) worried about).

Two things for whoever picks up next: `scripts/verify-wayfinder-tool.ts` (026, in flight) still has a `sealed` verdict branch that is now dead code — its check accepts `dispatched || refused || sealed` so it will not fail, but the narration needs updating. And `check_tool` could still warn that a declared `agents/` write glob with no named agents can never fire; that is now a much narrower trap, so I left it rather than widening scope.
