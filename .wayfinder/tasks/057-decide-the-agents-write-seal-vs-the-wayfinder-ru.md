---
id: 057
title: Decide the `agents/` write seal vs. the Wayfinder Run flow
status: todo
kind: build
size: m
wave: 6
depends_on: []
touches: [apps/web/lib/tools/bridge.ts, apps/web/tests/tools-bridge.test.ts, docs/tools.md, docs/wayfinder-tool.md, examples/tools/wayfinder/**]
created_by: 025
session: null
model: null
effort: null
---

## Task

The Wayfinder Tool (025) hit the one wall the acceptance test found: `lib/tools/bridge.ts#SEALED_WRITE_DIRS` refuses every Tool write into `agents/`, `connectors/` and `tools/`, whatever the perimeter declares — because an agent brief runs unattended on the space's model key. But the plan's own Context says the harness rebuild's Run button 'writes/uses an agent brief and triggers a run via the existing agents feature'. Both cannot be true.

Today the Wayfinder Tool attempts the write, shows Visvine's real refusal, and hands the person the exact brief markdown to save at `agents/wayfinder-<project>-<id>.md` (see docs/wayfinder-tool.md, 'Limits'). That is honest and shippable, but it is a decision nobody has actually made.

Settle it, then implement whichever way it lands:

**(a) Narrow the seal.** Let a Tool write `agents/<name>.md` when its declared `perimeter.agents` matches that name — the brief is already member-writable (`contextService#writeDenial` only guards `agents/live/`), and ACTIVATION, which is what makes a brief run, stays admin-only. The seal on `agents/live/`, `connectors/` and `tools/` is unchanged. This needs: the narrowed rule in `checkWrite`, a note in the perimeter/bridge doc comments explaining why the brief is different from the activation, tests in `tests/tools-bridge.test.ts` (a declared name is allowed; an undeclared one, `agents/live/**` and a wildcard-only perimeter are all still refused), a line in the adversarial suite (024) proving a Tool cannot write a brief it did not declare, and the `examples/tools/wayfinder/` Run path simplified to the write-then-run flow.

**(b) Keep the seal.** Then say so in docs/tools.md's perimeter section (it currently does not mention `SEALED_WRITE_DIRS` at all), and consider whether `check_tool` should warn an author that a declared `agents/` write glob can never be exercised — a perimeter entry that is always refused is a trap for the next author.

Either way, docs/tools.md and docs/wayfinder-tool.md must end up agreeing with the code, and the plan's Context line about the Run button must be reconciled with what shipped. Ask the human if the trade-off is not obviously (a) or (b) from the code.
