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

## Results

| Run | Builder | Mean | Notes |
|---|---|---|---|
| 3 prompts, first kit | sonnet-5 via build_tool, no polish | 6.8 | crm 6.8 · expenses 6.9 · kudos 6.6; fixes were mostly platform-level (band button, control heights, board overflow) — fixed since |
| 20 prompts | — | not measured | the local OpenRouter key hit its $5 limit after the first build |

A hand-built check through the local MCP (`plan_tool` → `create_tool
{ template: tracker, spec }` for "something to track our hiring") produced a
finished board with stages, roles as coloured chips, ratings, overdue dates and
nine candidates on first open.

To finish the measurement: raise the key's limit (or set
`EVAL_BUILDER_MODEL` / `EVAL_JUDGE_MODEL` to cheaper models), then
`pnpm --filter @visvine/web eval:tools` and `--mode freeform` for the baseline.
