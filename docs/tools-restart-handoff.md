# Tool system — restart handoff, 27 September 2026

## Read this first

The user asked us to finish Claude's Tool-system improvements, score generated
Tools through their **ChatGPT subscription**, and work toward **9/10**. They then
asked to stop and continue later. This is an intentional pause, not completion.

**Implementation is substantially complete and checked. The improved system's
full retest is not complete. We have not reached or measured 9.**

- HEAD is still `ef7f5704` (`feat(tools): P1–P3 of the plan to 9…`).
- This session's changes are **uncommitted**. Nothing was pushed.
- There were already extensive uncommitted icon/Tool changes when this session
  began. Preserve them; do not reset the working tree or assume every diff is ours.
- Both subscription evaluation process trees and the dev server started for this
  task were stopped. No evaluation should still be spending subscription usage.
- Local Docker Postgres was left alone. Never connect these scripts to production.
- The machine's artifact timestamps use UTC on **26 September**, while the local
  user date is **27 September** in Auckland. Those are the same work session.

Read root `AGENTS.md`, the applicable app instructions, `docs/tools.md`, and
`docs/tools-oneshot-plan.md`. Read the local Next documentation before changing
framework code. Do not push unless the user asks. Do not broaden the primary
button colour change across the rest of the app without a separate request.

## What has actually been measured

| Measurement | Scope | Mean | Minimum | Status |
|---|---|---:|---:|---|
| Historical Claude series | Earlier 20-prompt run | 6.0 | See old plan | Historical, different builder/judge |
| Initial ChatGPT series, `screens-v1` | All 20 prompts | **5.61** | **4.0** | Complete; 0 missing judgments; 0 passing |
| Initial screenshots rejudged with `screens-v2` | Only 3 completed before pause | — | — | Incomplete; do not aggregate |
| Updated system, `screens-v2` | First 3 builders were active | — | — | Interrupted before any complete scored output |

The initial ChatGPT run had 15 template-based outputs. Its weakest mean criteria
were realistic content **2.7** and density **4.5**. Common failures: deleting
sample rows and handing over empty screens; leaving temporary test records;
repeated “Sample”/“Example” prefixes; missing owners; clipped boards/calendar
labels; and forms with weak required-field and interaction cues.

The 5.61 is **not** a measured regression from Claude's 6.0: the model series and
judge instructions differ. It also is not a pristine evaluation of `ef7f5704`:
API completion fixes had already landed, while the cached kit and generated
templates still preceded this session's polish.

### Evidence to preserve

All paths below are relative to the repository. `.eval` is ignored by git, but
persists locally across an ordinary app restart. Back it up if changing machines.
Do not delete the evaluation spaces or artifacts before comparing results.

- Complete normalized initial report:
  `apps/web/.eval/tools/2026-09-26T16-38-23-codex-initial-measured/`
  (`summary.json`, `results.json`, `report.md`, screenshots, raw judge answers).
- Original initial run:
  `apps/web/.eval/tools/2026-09-26T15-46-59-codex-fresh/`.
  Its original report incorrectly shows zeroes because the old parser rejected
  valid shortened screen names. The normalized report above reparsed the same
  saved answers, with **no new model calls and no changed numeric judgments**.
- Initial local evaluation space: `tool-eval-muikbwmn`.
- Interrupted updated run:
  `apps/web/.eval/tools/2026-09-26T16-41-11-codex-polished/`.
  Space: `tool-eval-muim9lth`. Contains three builder prompts and partial Tools
  in the database, but no complete builder/judge results or run summary.
- Interrupted original-image rejudge:
  `apps/web/.eval/tools/2026-09-26T16-41-33-codex-initial-v2/`.
  Completed new scores: CRM **4.7**, team tracker **6.9**, sales pipeline **6.9**.
  **Its `results.json` mixes those updates with copied old scores for the other
  requests. It is not a complete v2 report.** An in-progress judge file may also
  just be the copied old answer. See `INTERRUPTED.json` in both interrupted runs.
- Preserved verification and progress logs:
  `apps/web/.eval/handoff-2026-09-27/`.
- Browser regression harness:
  `apps/web/.eval/verify-record-dialog.mjs`.
- The one-poll scorer smoke test was ultimately validated at
  `apps/web/.eval/tools/2026-09-26T16-30-09-codex-schema-verified/` (6.7).
  Earlier `schema-smoke` folders are failed runner experiments, not benchmarks.
- Ignore earlier loading-screen/approval experiments as quality measurements.

## Completed implementation

### Creation and MCP behaviour

`apps/web/lib/actions/defs/apps.ts` and `apps/web/lib/tools/service.ts`:

- A template failure during configuration, plan/source write or compilation
  cleans up the scaffold created by that call. Existing-name conflicts never
  enter cleanup. Failures inside scaffold creation remove its node, folder and
  structured facts too.
- This is **compensating cleanup, not a crash-safe transaction**. A denied or
  failed cleanup is reported; do not promise stronger atomicity.
- Missing plan indexes and refused writes no longer silently succeed.
- `create_tool` asks for inspecting every section and band action, fixing and
  recapturing problems, exercising the main action, preserving labelled demo
  rows, and removing only temporary test records.
- `configure_tool` validates prose and unknown keys before writes, writes
  title/description/tags to the index, and reports prose plus fact changes.
- Review completeness checks reject missing captures, unmounted screens and
  missing actions. Console errors prevent a pass.
- Prior handoff work for band actions in `try_tool`, sectioned SDK reads and icon
  naming remains. Icon aliases and metadata routing have test coverage.

### Shared kit and templates

`apps/web/features/tools/kit/components/{records,Kanban,blocks}.tsx` and the six
sources in `apps/web/lib/tools/templates/sources/`:

- Explicit board scroll controls show hidden columns and allow going back.
- Name-derived avatar colours now apply to initials, not just silhouettes.
- Percent/rating board aggregates average rather than sum; missing values do
  not count as zero. Percent values retain their units.
- Calendar entries wrap, extra entries expand, and today's marker uses readable
  contrast. Tracker calendars expose unscheduled records and overdue items.
- Record forms mark required fields, give URLs a full row, use clearer select
  prompts, and reject whitespace-only required values while accepting 0/false.
- Dialogs reset on reopening, including rapid reopen before animation ends.
  Save/delete failures show an error and preserve entered values.
- `useSampleRows` now reports `hasSamples`; `SampleData` supplies one provenance
  label and a Clear action. Clear failures retain tracking instead of silently
  forgetting the remaining rows.
- All six templates use `SampleData`. Polls use separate answer inputs and Add
  answer; directories keep selection inside the filtered list and default select
  fields; check-ins distinguish false from actual flags; local-calendar date
  calculations avoid UTC day/week shifts.
- Template sample validation now validates field types and required values.
- Planning/SDK guidance distinguishes actual relevant records from a merely
  available type or admin profile, encourages appropriate collection templates,
  and forbids putting fictional demo people into the real directory.

Generated templates, kit declarations, starter docs and local runtime/CLI bundles
were regenerated successfully. Edit sources, then regenerate; do not hand-edit
`sources.generated.ts`, the starter docs or the kit declaration output.

### Subscription evaluation and score integrity

`apps/web/scripts/eval-tools-claude.ts` retains Claude support and adds Codex.
Despite its filename it now supports `--provider codex`.

- Codex CLI login was confirmed as **Logged in using ChatGPT**.
- Builder and judge default to `gpt-6-astra`; separate sessions, with screenshots
  attached to the judge. Builders run in fresh temporary directories, without
  repo context, and use the local Visvine MCP gateway.
- CLI calls force ChatGPT login and allowlist inherited environment variables,
  excluding API credentials. The local dev server was run with `TOOL_REVIEW=off`
  so server-side visual review could not bill its configured OpenRouter key.
- All sections/actions are captured; final captures are serialized even when
  builders run concurrently. Rejudging can run concurrent workers too.
- `--new-space` creates an isolated local space and does not delete old Tools.
- `--rejudge RUN` captures existing Tools again and writes a new output directory.
- `--rejudge RUN --saved-images` judges the original saved images without
  recapturing the changed system. Use this to calibrate the baseline fairly.
- `--rescore-saved RUN` reparses existing judge answers without model calls.
- Prompts, screenshots, raw answers, generated source, judge contract and run
  provenance are retained for new runs.
- `scripts/eval/tool-verdict.ts` validates full screen coverage and six numeric
  criteria, accepting unambiguous shortened names, known screenshot filenames,
  omitted articles and escaped quoted action labels. Wrong order/missing screens
  remain errors.
- Structured output schema works after removing an unsupported quoted-string
  enum constraint. Do not re-add that enum without a smoke test.
- A weak category cannot be averaged away. The target is mean ≥9, every prompt
  ≥8, every screen's minimum category ≥6, and no capture errors/broken controls.
  The ordinary per-Tool pass threshold remains 8.5.
- `screens-v2` clarifies that a creation form is intentionally blank, labelled
  realistic samples are legitimate, and the Next dev badge is not shipped UI.
  Do not compare v1 and v2 as if the judge contract were unchanged.

## Verification completed

After the template/kit regeneration:

- `pnpm typecheck` — passed across the workspace packages.
- `pnpm lint` — passed with `--max-warnings=0`.
- `pnpm test` — **2,480 tests passed; 0 failed; 0 skipped**.
- `pnpm --filter @visvine/web knip` — passed.
- `git diff --check` — passed at the last check before this handoff.
- Chromium checks passed for reset-on-reopen, preserving failed-save input,
  board scroll navigation and calendar overflow expansion.

The final `--saved-images` evaluator addition and documentation edits happened
**after** the full check run. That path successfully completed three judgments
before the pause, but still needs the final typecheck/lint pass. Do not claim the
last complete checks cover every subsequent script edit.

## Restart plan, in order

### 1. Preserve and inspect the current state

1. Read this handoff and the current working tree diff. Preserve all pre-existing
   icon changes and this session's uncommitted implementation.
2. Confirm local Docker Postgres is running and run:
   `node scripts/guard-local-db.mjs`.
3. Confirm `codex login status` still says ChatGPT. Read the `openai-docs` skill
   before changing Codex configuration or relying on product-specific behaviour.
4. Confirm no previous evaluator process remains. The last known task processes
   were stopped; do not reuse the recorded PIDs to kill anything after restart.

### 2. Finish two small evaluator correctness improvements before launching

These were identified but **not implemented** before the pause:

1. In `judge()`, pass the captured filenames as the third argument to
   `parseScreenJudgment`, just as saved-answer recovery already does. Otherwise
   a fresh judge that names a screenshot filename can still fail parsing despite
   a valid complete answer. Keep the strict coverage/order tests.
2. Fix `first_score` reporting. Saved-parser recovery inherited the invalid old
   zero; later rejudges print “was 0” even when the source's actual recovered score
   is 5.61 overall. Compare against the immediate source row's `score`, and omit
   the comparison for parser-only recovery. Do not change any numeric judgment.

Also review interruption behaviour and run provenance. There is **no automatic
resume** for interrupted builders. A partially copied rejudge `results.json`
needs an explicit incomplete marker and must never be treated as a complete run.
The two paused runs already have `INTERRUPTED.json` markers. A future improvement
could persist per-row completion/status, but do not let that delay the retest.

Run the evaluator parser/regression tests and typecheck/lint after those changes.
If the full suite finds a new failure, fix it before spending another full run.

### 3. Rebuild only if sources changed, then start the local server

From the repository root:

```sh
pnpm --filter @visvine/web exec node --import tsx scripts/build-tool-templates.ts
pnpm --filter @visvine/web exec node --import tsx scripts/build-tool-packages.ts
TOOL_REVIEW=off PRISMA_QUERY_LOG=off pnpm --filter @visvine/web dev
```

The rebuilds already succeeded in this session; rerun them after relevant source
changes. Restart the server after kit changes: the development vendor bundle is
cached for the life of the process. Do not evaluate against a stale bundle.
Do not run the full DB-heavy test suite concurrently with screenshot evaluations;
that caused loading-screen capture failures in an earlier attempt.

### 4. Complete a comparable baseline and a fresh full retest

Rejudge the complete original screenshots using the current v2 contract, not the
interrupted mixed-results folder:

```sh
pnpm --filter @visvine/web eval:tools --provider codex \
  --rejudge 2026-09-26T16-38-23-codex-initial-measured \
  --saved-images --label codex-initial-v2-complete --concurrency 3
```

Then run all twenty prompts from scratch with the updated system:

```sh
pnpm --filter @visvine/web eval:tools --provider codex \
  --new-space --label codex-polished-complete --concurrency 3
```

Use a **new space**, not the interrupted `tool-eval-muim9lth`: its partial Tools
would influence planning and the runner deliberately refuses nonempty fresh-run
spaces. Preserve that space for inspection; do not delete it to get past the gate.

The first complete build+judge run took about **52 minutes** at concurrency 3;
allow comparable time. Keep the user informed. Do not keep prompting for approval
where existing authorization covers local evaluation. If usage limits stop it,
record exactly which rows are complete and retain the artifacts.

For parser-only failures with intact raw answers, use `--rescore-saved RUN` after
fixing the parser rather than paying for another judgment. Do not rescore the
interrupted updated run: it lacks finished answers and a run summary.

### 5. Inspect results and improve shared causes

1. Verify all twenty have complete captures, meaningful data, main-action checks,
   and independent judgments. Review screenshots personally, not just the mean.
2. Compare v2 baseline against v2 updated results per prompt and criterion. Record
   model, contract, run directories, mean/minimum, failures and passing count in
   `docs/tools-oneshot-plan.md`.
3. First verify the fixes that motivated this iteration: sample rows survive;
   examples are labelled once; owners/numbers/dates are populated; no temporary
   test rows remain; generic CRM/hiring/expenses do not start as empty directory
   screens; board/calendar contents and dialogs are usable.
4. Cluster remaining fixes by template/kit/guidance and improve those shared
   sources. Avoid hand-curating benchmark Tools and calling that a one-shot
   generation improvement.
5. After each meaningful iteration, regenerate, restart the server and retest
   affected prompts. Finish with a complete fresh twenty-prompt run on one stable
   implementation. Keep previous evidence; never overwrite it or tune the rubric
   merely to reach 9.
6. If the score remains below target, state the measured result and remaining
   failures honestly. Tests passing is not visual quality reaching 9.

### 6. Final verification and handover

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm --filter @visvine/web knip`, and `git diff --check` for the final code.
Repeat the browser regression harness if kit interaction code changes.

Update the plan with the final measured results, verification counts and artifact
paths. Review the diff without dropping the user's earlier icon work. Commit only
with a clear scope if appropriate; **do not push unless asked**. Report explicitly
whether the target was reached and what is still outstanding. Stop evaluation
processes when the user pauses so usage does not continue in the background.
