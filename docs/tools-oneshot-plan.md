# Tools: one-shot to 9/10

Goal: a vague prompt ("crm for my team", "track stuff") produces a Tool that
looks designed, works on first open, and holds real-looking data — judged
≥ 9/10 by a fixed rubric across a fixed prompt set, measured before and after.

Today (2026-09-26): platform 9/10 (sandbox, gates, review, collections,
bindings); generation ~3/10. Causes: the author starts from primitives, three
packages (`zod`, `date-fns`, `clsx`), a render check that asks "did it mount"
not "is it good", no spec expansion, no seed data, no eval.

## Phase 0 — Measure first (the gate for everything after)

- `apps/web/scripts/eval-tools.ts` (`pnpm eval:tools`), beside `eval:retrieval`.
- `apps/web/scripts/eval/tool-prompts.ts`: ~20 deliberately bad prompts across
  archetypes (crm, "track stuff", poll, standup, inventory, reading list,
  hiring, budget, OKRs, bug list, content calendar, habit tracker…).
- Each prompt is built end to end through the local MCP (`/api/mcp`, dev
  identity, no token) by the same sequence a client model follows, the output
  screenshotted per section (`lib/tools/screenshot.ts`), and scored by a
  vision model over OpenRouter against `TOOL_RUBRIC` (below). Scores and
  screenshots land in `apps/web/.eval/tools/<run>/` with a summary table.
- Baseline recorded in this doc before Phase 1 starts.

`TOOL_RUBRIC` (each 0–10, the score is the mean, any category < 6 fails):
hierarchy, spacing & alignment, density (no giant empty regions), states
(empty / loading / error present and designed), data realism, main action
obvious and working, consistency with the app (tokens, components), no
runtime errors.

## Phase 1 — Page blocks (the author stops inventing layout)

New kit 2 components in `packages/tool-kit` (+ `lib/tools/catalog.ts`
entries, `tests/tools-catalog.test.ts` stays green):

| Block | Shape |
|---|---|
| `ListDetail` | list on the left, the selected item's page on the right; stacks under `md:` |
| `DashboardGrid` + `StatRow` / `Stat` | KPI row, then a responsive grid of panels |
| `BoardPage` | toolbar (search, filter, group) over `KanbanBoard` |
| `TablePage` | toolbar over `DataTable` with search, sort, filter chips, row open |
| `FormPage` | sectioned form, sticky submit, validation from a schema |
| `Toolbar` | search · filters · view switch · primary action, one row |
| `Section` | hairline section with header + optional action |
| `Icon` | lucide icons by name, token-coloured |

Each block ships designed empty/loading states, so a Tool gets them by default.

## Phase 2 — Golden templates (a bad prompt lands on a good base)

`lib/tools/templates/<id>/` — a complete, hand-polished Tool per archetype
(manifest, `ui.tsx`, `data.js`, seed rows), built from Phase 1 blocks:
`pipeline`, `tracker`, `dashboard`, `poll`, `directory`, `queue`, `calendar`,
`checkin`, `leaderboard`, `form-intake`, `wiki-lite`, `inventory`.

- Pure matcher `lib/tools/shared/templateMatch.ts` (keyword overlap, like
  `actions/shared/match.ts`; judge-routed when a key exists, keywords the
  fallback).
- `plan_tool` returns `template: { id, why, screens }`; `create_tool { plan,
  template }` writes the template's files as the working copy, renamed and
  rebound to the space, so the model EDITS a working Tool instead of writing
  one from nothing.
- Every template passes `check_tool { render: true }` and scores ≥ 9 in the
  eval on its own (`tests/tools-templates.test.ts` builds each through
  `buildFromSources` + `runStaticChecks`).

## Phase 3 — Spec expansion + seed data

- `planBrief.ts` grows a `spec`: who uses it, 2–4 screens, the one main
  action, fields with kinds, states, and 8–15 realistic seed rows — generated
  from the request + the chosen template's defaults (pure; the model may
  refine). The person agrees the spec, as the plan today.
- `create_tool` seeds the Tool's collection (or notes, for a note type) with
  the spec's rows, marked `seed: true`, so the first preview is never empty.
  A `clear_seed` path (setting or action) removes them.

## Phase 4 — Packages

Tier 1, curated now (`packages/tool-protocol/src/dependencies.ts`,
`vendorBundle.ts#VENDOR_FILES`, `build-tool-vendor.ts`): `lucide-react`,
`motion`, `@dnd-kit/core` + `@dnd-kit/sortable`, `@tanstack/react-table`,
`react-hook-form`, `papaparse`, `fuse.js`, `react-day-picker`,
`@tiptap/react` + starter-kit, `nanoid`. Each: pinned, license recorded, runs
the escape battery.

Tier 2 (designed here, built after the eval proves Tier 1): arbitrary npm —
server resolves + esbuilds the package into a vendor file pinned by content
hash, the static scan + advisory feed read it, a space admin approves it once
per space; listed Tools may only use Tier 1 + globally approved packages.

## Phase 5 — The visual judge loop

- `lib/tools/visualReview.ts`: screenshot each section → vision model over
  OpenRouter with `TOOL_RUBRIC` → `{ score, fixes[] }`, fails open (no key → no
  review, like `lib/judge/`).
- `check_tool { review: true }` returns it; the `create_tool` / `write_tool`
  next-steps say: loop until score ≥ 8.5 or 3 rounds.
- `checks/design.ts` gains static rules the judge keeps catching (no empty
  state, a raw `<table>`, a button row with no primary, text-only list rows).

## Phase 6 — Server-side builder (`build_tool`)

One action: request in → plan → template → spec → write → render → review →
fix, looping on the SPACE's model (or the deployment key for the review), and
hands back the preview link + score. Output quality stops depending on the
client model. MCP clients that want control keep the step-by-step actions.

## Verification

- Every phase: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `knip`.
- Phase 1–2: `verify:tools:starter`, catalog + template tests.
- Phase 4: `verify:tools:escape` with each new dependency imported.
- End: `pnpm eval:tools` against the local dev server through the local MCP;
  target mean ≥ 9, no prompt < 8. Errors found in the run are fixed and the
  run repeated; results table appended below.

## Order and cut line

0 → 1 → 2 → 3 → 5 → 4(tier 1) → 6 → 4(tier 2). Phases 0–3 + 5 are expected to
carry most of the score; 6 is what makes it independent of the client.

## Status (2026-09-26)

Built and tested: phases 0–3, 5, 4 tier 1 and 6. Tier-2 npm (any package,
admin-approved) is designed above and not built.

| Phase | What landed |
|---|---|
| 0 | `pnpm eval:tools` (template / freeform modes, independent judge model, `.eval/tools/<run>/`) |
| 1 | Kit blocks: `Page`, `Toolbar`, `StatRow`/`Stat`, `Progress`, `ListDetail`, `MonthCalendar`, `Icon`; records by schema: `FieldValue`, `FieldInput`, `RecordForm`, `RecordDialog`, `RecordTable`, `RecordBoard`, `HueChip`; the kit stylesheet gains hover states and the app's hue / success / warning / info colours |
| 2 | Six templates (tracker, dashboard, poll, checkin, directory, leaderboard); `plan_tool` names one, `create_tool { template, spec }` builds it |
| 3 | Specs carry realistic sample rows; `useSampleRows` seeds once per install |
| 4 | Ten more curated packages, each pinned and vendored |
| 5 | `check_tool { review: true }`: every section and band action scored by a vision model, with fixes |
| 6 | `build_tool`: spec → create → review → polish rewrites kept only if better |

Platform fixes the review surfaced: a Tool's first band action is now a primary
button; the headless capture waits for the Tool to settle (it was shooting a
loading page); the vendor bundle no longer uses a dynamic `import()` Turbopack
refuses; the kit `.d.ts` was missing `Select`'s `onValueChange`/`placeholder`.

## Results — 2026-09-26, measured through the MCP

**How:** each of the 20 prompts in `scripts/eval/tool-prompts.ts` went, verbatim,
to a fresh headless Claude Code session (`claude -p`, Sonnet, local subscription)
whose only tools were the local `/api/mcp` — no repo, no hints. Every section and
band action of the Tool it made was screenshotted and scored by a separate
Claude session (Opus) on six criteria, 0–10. **Before** = the server at
`e8e2e50e` (before templates); **after** = `41f30a26`. Both sets were
re-captured and judged on the same (current) renderer, one Tool at a time, so
capture timing under load cannot move a score. `pnpm eval:tools`, then
`--rejudge <run>`.

**Rating: 4.2 → 6.0 out of 10.** Templates were chosen for 20/20 prompts and won
18 of 20; none reached the 8.5 bar. The judge is strict (5 = "competent but plain
prototype"); the target is 9.

| Criterion | Before | After |
|---|---|---|
| Hierarchy | 4.3 | 5.9 |
| Spacing | 5.3 | 6.4 |
| Density | 3.3 | 5.4 |
| Realistic data | 2.6 | 5.7 |
| Main action | 4.4 | 5.9 |
| Polish | 4.2 | 5.3 |
| **Mean** | **4.2** | **6.0** |

| Prompt | Before | After | Built |
|---|---|---|---|
| crm | 4.1 | **5.9** | CRM |
| track stuff for my team | 4.5 | **6.4** | Team Tracker |
| make me a sales pipeline thing | 4.1 | **6.1** | Sales Pipeline |
| hiring | 3.2 | **6.2** | Hiring |
| bug tracker | 4.6 | **6.2** | Bug Tracker |
| expenses | 4.5 | **6.5** | Expenses |
| where should we go for lunch poll | 4.3 | **4.6** | Lunch Poll |
| daily standup | 2.9 | **5.5** | Daily Standup |
| vendor list | 4.7 | **6.3** | Vendor List |
| kudos | 4.4 | **6.4** | Kudos |
| content calendar for our blog | 4.2 | **6.5** | Content Calendar |
| inventory | 4.3 | **6.1** | Inventory |
| okrs | 4.9 | **5.8** | OKRs |
| reading list | 4.7 | **6.1** | Reading List |
| team budget dashboard | 4.5 | **6.4** | Team Budget Dashboard |
| customer feedback | 3.1 | **5.9** | Customer Feedback |
| habit tracker | 4.4 | **4.2** | Habit Tracker |
| recipes we like | 4.5 | **5.8** | Recipes We Like |
| fundraising investors | 3.6 | **6.3** | Fundraising Investors |
| event planning | 4.5 | **6** | Event Planning |

Build: about 2 minutes and 14 MCP calls per Tool after; the baseline spent much
of its time fighting `get_tool_sdk`.

## Errors found

**Product bugs (fixed already)**
- `preview_tool` screenshots went to MCP clients as base64 text — no model could
  see its own Tool. Now an image block (`lib/mcp/auth.ts#toContent`).
- The headless capture shot the page before the Tool loaded; the vendor bundle
  used a dynamic `import()` Turbopack rejects (500 on the frame); the kit `.d.ts`
  lacked `Select`'s `onValueChange` / `placeholder`.

**Product bugs (open)**
1. The board clips its right-hand columns with no scroll cue — 14 of 20 Tools.
2. The dialog scrim leaves a white notch at the content frame's top-left — every Tool with a dialog.
3. Date fields are the raw browser control (`dd/mm/yyyy`) — every Tool with a date.
4. The band's primary button, white on pale brand green, reads as disabled — flagged in 8 Tools (an app-wide colour).
5. Dates render red whenever past — in tables, on Done cards, on logs — not only when overdue and open.
6. Money mixes `$18,000` and `$120K` in one view.
7. The first dialog field is autofocused, so it alone is white and outlined.
8. The tracker template sums a percent field as a total (OKRs showed "292").
9. `create_tool` with a template can leave a half-made Tool; the retry gets "already exists" (okrs, event planning).
10. `try_tool` cannot press a band button, so no builder could test its main act.
11. `get_tool_sdk` is 30–48k tokens — clients spill it to a file and grep it (every baseline build).
12. `set_tool_icon` knows ten names; builders guessed star, book, heart, target, message-square.
13. `configure_tool` refuses `description` / `tags` without saying where they go.
14. Smaller: chart y-axis labels clipped (`$6,000` → `6,000`); the poll textarea pre-filled with "Yes/No" as values; "1 kudos"; the amount asked twice in the kudos dialog; Activity not sorted.

**Harness notes:** one judge answer per run came back empty (the first judging
was kept); screens caught mid-load under three builds at once were retried and
re-judged one at a time.

## Fix plan — to 9/10

Ordered by points per hour.

**P1 — kit and host; every Tool gains (est. +1.0)**
1. Board: columns share the width up to six (`min-w-52`); beyond that a right-edge
   fade, scroll snap and an "n more →" chip. Columns run to the viewport with an
   "+ Add" row at the foot — fixes the clipping and the empty lower half.
2. Cards: title and the primary number on line one, one muted meta line joined by
   `·` with an owner avatar; a date is red only when overdue AND open
   (`FieldValue` takes `done`).
3. `DatePicker`: the app's own popover calendar, not the native control.
4. Scrim: cover the pane's rounded corner.
5. Band button: brand fill with strong text — contrast at least 4.5:1.
6. `formatMoney`: one notation per view (standard under $1M, compact above, for the whole set).
7. No autofocus in `RecordForm`; charts size their left gutter to the widest tick.

**P2 — templates (est. +0.7)**
8. Tracker: a lead stat, Overdue in danger and clickable to filter; average, not
   sum, for percent and rating; percent fields as progress bars; owners as avatars.
9. Poll: polls with results first, a radio affordance, "Voted 1 of 3", Closed
   hidden while empty, placeholders not values, "Create poll".
10. Check-in: a band action "Post update", your post inline, blockers first, a
    "not posted yet" row, a realistic sample for the viewer too.
11. Dashboard: a progress bar under Target, legend swatches beside amounts, period labels.
12. Directory: a filled detail pane, avatars tinted per category, an urgency chip for near dates.
13. Leaderboard: one bar colour, singular units, one amount control, Activity sorted.

**P3 — the MCP loop: builders see and test what they make (est. +0.5)**
14. `try_tool` step `{ do: 'band', action }`, with a screenshot after.
15. `get_tool_sdk { section }` — an index under 3k tokens, sections on demand.
16. `set_tool_icon` takes every kit `Icon` name and lucide names.
17. `configure_tool` routes `title` / `description` / `tags` into index.md.
18. A template create is atomic: a later failure removes the scaffold.
19. `create_tool`'s `next` asks for one look-and-fix round per section before hand-over
    — builders currently stop at "it compiles".

**P4 — measure, repeat**
20. `pnpm eval:tools` after P1 and after P2; keep a change only if the mean rises.
    Then a polish pass per template on its judge fixes until every prompt is ≥ 8.

Expected: 6.0 → about 7 (P1) → 7.7 (P2) → 8.2 (P3) → 9 with per-template polish.

## Subscription evaluation and completion — 2026-09-27

The Claude handoff at `ef7f5704` left the measured score at **6.0**. That number
belongs to the earlier Claude builder/judge series; it is not a ChatGPT score.
The new runner supports `--provider codex`, using the Codex CLI's ChatGPT login
for both a fresh builder and a separate screenshot judge. It forces ChatGPT
authentication and strips API credentials from child processes. For these local
runs the dev server has `TOOL_REVIEW=off`, so `check_tool` does not silently call
the deployment's paid reviewer.

Completed after the handoff:

- Failed template configuration, writes or compilation remove that call's
  scaffold. Failures during the scaffold itself remove its node, folder and
  facts. Existing-name conflicts never enter cleanup. This is compensating
  cleanup, not a crash-safe database transaction; a cleanup refusal is reported.
- `create_tool` asks for a look, fix, recapture and interaction pass before
  handover. `configure_tool` validates prose and unknown keys before writing,
  routes prose into the index, and reports all changed keys. Icon resolution
  and prose routing have regression coverage.
- Evaluation captures every section and band action, serializes browser
  captures, requires complete numeric judgments, retains the weakest category,
  and rejects a pass on console errors or broken controls. Rejudging writes a
  new report instead of overwriting the earlier evidence. `--rescore-saved`
  recovers valid saved answers whose screen names used an unambiguous shorthand;
  it does not make new model calls or alter the scores.
- Shared UI fixes include explicit board scroll controls, correct initials
  colours, percentage averages that ignore missing values, readable calendar
  entries with expandable overflow, required-field cues, reset-on-reopen forms,
  and visible save/delete failures that preserve entered values.
- Templates retain labelled, clearable fictional sample rows. Planning
  distinguishes an available record type from actual records, and warns against
  putting fictional people into the real directory. Polls use separate answer
  inputs; filtered directories keep detail selection inside the filtered list;
  calendars expose unscheduled items; date calculations use local calendar days.

The score target stays **mean ≥ 9, every prompt ≥ 8, no failed captures or
broken controls**. A passing aggregate must also keep every screen's weakest
category at 6 or above. No score is inferred from code changes or passing tests.
The `screens-v2` judge instructions clarify that an intentionally blank creation
form is evaluated on its fields and controls, that labelled realistic examples
are valid, and that the Next.js development badge is outside the shipped Tool.
Runs with different judge contracts must not be presented as a controlled
before/after comparison.

### Initial ChatGPT measurement

Run: `apps/web/.eval/tools/2026-09-26T16-38-23-codex-initial-measured/`.
The saved judgments and screenshots came from
`2026-09-26T15-46-59-codex-fresh`; only response parsing was repaired. All 20
judgments were recovered without another model call. Mean **5.61**, minimum
**4.0**, **0** passing, **0** missing judgments; 15 outputs retained a template.
The lowest criterion was realistic content (**2.7**), followed by density
(**4.5**). The run used the handoff kit cached before the template polish,
with the API completion fixes already applied; it is not a pristine checkout
of `ef7f5704`.

| Request | Initial ChatGPT score |
|---|---:|
| crm | 4.4 |
| track stuff for my team | 6.2 |
| make me a sales pipeline thing | 7.2 |
| hiring | 4.9 |
| bug tracker | 5.3 |
| expenses | 4.4 |
| where should we go for lunch poll | 6.5 |
| daily standup | 4.8 |
| vendor list | 6.6 |
| kudos | 5.1 |
| content calendar for our blog | 6.2 |
| inventory | 5.6 |
| okrs | 5.4 |
| reading list | 7.1 |
| team budget dashboard | 5.6 |
| customer feedback | 6.4 |
| habit tracker | 5.2 |
| recipes we like | 4.0 |
| fundraising investors | 5.4 |
| event planning | 5.8 |

### Claude subscription rounds — 2026-09-27

Builder Sonnet, judge Opus, both on the Claude subscription (`pnpm eval:tools`,
default provider), `screens-v2`, a fresh space per run, every section and band
action judged. Runs in `apps/web/.eval/tools/`.

| Run | Mean | Min | What changed before it |
|---|---:|---:|---|
| `claude-smoke` (4 prompts) | 6.4 | 6.1 | starting point |
| `claude-r1` | 6.96 | 6.3 | board fits its stages, card footer, person picker, "e.g." placeholders, check-in and poll rework, icon aliases |
| `claude-r3` | 7.32 | 6.7 | `try_tool` rehearses (no test records ship), sample seeding in one round trip behind a claim (fixed 4-of-12 and tripled rows), views as band tabs, scrim corner |
| `claude-r4` | 7.32 | 6.7 | rolling calendar, inline yes/no rows, poll and leaderboard polish |
| `claude-r5` | 7.38* | 6.9 | Schedule tab replaces the month grid, rating input, header alignment |

\* 18 of 20: two rows failed in the harness (the subscription session ended
mid-build and mid-judge), not in the Tool. `claude-r2` was stopped and marked
`INTERRUPTED.json` (seeding race, templates changed mid-run).

Per-prompt noise between identical runs is about ±0.4. Dialogs now score ~8,
tables ~7.7, boards ~7.5; the weakest screens are Schedule (~6.9), check-in
History and the poll page (~7). Every remaining judge note is a per-domain
refinement (inventory quantities, OKR key results, nudges, reactions) rather
than a shared defect, and the judge's 10 is "indistinguishable from Linear".
**Target 9 not reached; measured 7.4.** Further gains need per-archetype
templates (inventory, OKRs, content calendar) rather than kit fixes.

### Beyond the benchmark — any Tool, edited over time

The 20 prompts are a regression gate, not the goal: people build every kind of
Tool and keep changing it. Changes since measure what generalises, on requests
outside the set (`pnpm eval:tools --prompts "a|b|c"`, never a benchmark row):

- Editing: `write_tool { edits }`; a template's SPEC edit carries collections,
  sections and band buttons; untouched sample rows follow a changed spec.
  Checked live: a follow-up "add a priority and filter by it" session made the
  change with two small edits, and the new field saved.
- Freeform builds: the design rules come with `get_tool_sdk`'s index (they were
  only inside `catalog`); every section must open showing the Tool in use,
  including what it records (attempts, votes). A security quiz's Results went
  from an empty state (1.3) to 6.8.
- Kit: `ChoiceList` (pick one or many, right/wrong marks). Host: the band's
  plus only on adding verbs; `configure_tool` accepts sections as a list and
  app icon names. Tracker: finished stages inferred from option names when a
  spec names none.

