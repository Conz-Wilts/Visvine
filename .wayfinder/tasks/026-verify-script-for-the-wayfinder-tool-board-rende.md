---
id: 026
title: Verify script for the Wayfinder Tool (board renders, writes, agent dispatch)
status: done
kind: build
size: m
wave: 6
depends_on: [025, 024]
touches: [apps/web/scripts/verify-wayfinder-tool.ts, apps/web/package.json]
created_by: 002
session: e0c9d16b-2931-4f02-9e62-201d8f6f557c
model: opus
effort: xhigh
---

## Task

Write apps/web/scripts/verify-wayfinder-tool.ts (add script `verify:wayfinder-tool`) — the final proof. Runs the seed (import and call it, or shell out) then: (1) in-process bridge checks under the space owner: `context.list harness/**` returns the seeded project + tasks, `data.call loadProject` returns waves + tasks grouped, `data.call moveTask` changes a task's `wave` in the note frontmatter (re-read note to assert), `data.call runTask` creates `agents/wayfinder-<project>-<id>.md` and returns a run id or a clear 'no model key configured' error (assert one of the two, print which); (2) Playwright (Chromium, dev login as `admin@local.dev`, `BASE_URL`, `TOOLS_ORIGIN`): open `/t/wayfinder`, wait for the frame's `visvine:ready` (poll a `[data-tool-ready]` attribute the ToolFrame sets, or the frame content), assert the board shows the project name and at least one task card, click a task's status action and assert the note changed via the API; open a `wayfinder-project` note URL under `/directory/note/harness/...` and assert the tab bar shows the 'Wayfinder-project'/type tab first with the frame beneath and Context/Raw available; assert the frame rect is inside `<main>` and the navbar/sidebar are unchanged (same rects before/after load); screenshot to the OS temp dir. Cleanup optional (seed is idempotent). Print a summary table and exit code. Acceptance: passes locally against `pnpm dev`; paste the summary in the outcome. tsc/lint/knip clean.

## Outcome

`apps/web/scripts/verify-wayfinder-tool.ts` (script `verify:wayfinder-tool`) drives the Wayfinder Tool end to end — the seed, then four in-process bridge checks, then a real Chromium run over both surfaces — and **passes 21/21 twice consecutively against `pnpm dev`** with `TOOLS_ORIGIN=http://127.0.0.1:3000`. tsc, `eslint . --max-warnings=0`, knip and the full suite (984/984) are all clean.

Run: `CLOUD_SQL_CONNECTION_NAME= pnpm --filter @visvine/web verify:wayfinder-tool` (needs `playwright install chromium` once and `pnpm dev` up). Summary from the last run:

```
── summary ────────────────────────────────────────────────
  step          result  check
  seed          PASS    the seed authors, installs and fills the board with no failed checks
  context.list  PASS    the seeded project note and its tasks come back through the bridge
  loadProject   PASS    loadProject returns the waves with every task sitting in one of them
  moveTask      PASS    moveTask rewrites the task note's `wave`, and putting it back restores it
  runTask       PASS    runTask names agents/wayfinder-visvine-tools-025.md and gives back a run id or a reason a person can act on
  runTask       PASS    the attempt is recorded on the task note, so the board still says so after a reload
  browser       PASS    the dev server answers
  browser       PASS    the viewer is logged in on the app origin as admin@local.dev
  browser       PASS    the app shell, before any Tool is opened, has a navbar and a rail to compare against
  /t/wayfinder  PASS    the Tool frame is on the page, served from the tools origin
  /t/wayfinder  PASS    the navbar and the rail sit exactly where they do with no Tool, all through the load
  /t/wayfinder  PASS    the rail page lists the seeded project by name, path and task count
  /t/wayfinder  PASS    the board shows the project name, one column per wave and a card per task
  click         PASS    the note itself says `status: done` when read back through /api/notes/item
  click         PASS    and they had still not moved after the Tool opened a board and wrote a note
  click         PASS    the frame renders inside <main>, over neither the navbar nor the rail
  note page     PASS    the type tab is first and selected, with Context and Raw beside it
  note page     PASS    the board renders beneath the tab bar as the note’s page
  note page     PASS    that frame is inside <main>, under the tab bar, and clear of the navbar
  note page     PASS    and they are still exactly where the Tool-free shell put them on this route too
  note page     PASS    Raw takes the frame away and the type tab brings the board back

21 passed, 0 failed
```

Evidence lines worth reading: `16 entr(ies) under harness/ · project harness/visvine-tools/project.md (wayfinder-project) · 12 task note(s)` · `User-created Tools · 6 waves · 12 tasks · w1×3 w2×2 w3×2 w4×1 w5×2 w6×2` · `026 wave 6 → note says 1 → back to 6` · `frame from http://127.0.0.1:3000 (separate tools origin)` · `h1 "User-created Tools" · 12 card(s) for 12 task(s) · 6 column(s) for 6 wave(s)` · `024 …024-adversarial-escape-suite-hostile-tool-fixtures.md · was doing · API 200 says done` · `tabs [Wayfinder-project | Context | Raw] · first aria-selected=true` · `frame 101,166 1322×718 · main 77,65 1354×826 · tab bar 78,65 1341×48 · navbar 0,0 1440×64`.

**Two deviations from the spec, both because the spec described a world wave 5 disproved, and both reported rather than papered over.**

(1) **`runTask` cannot create the brief, so the check asserts the answer is *legible* and prints which of three it got.** The spec said "creates `agents/wayfinder-<project>-<id>.md` and returns a run id or a clear 'no model key configured' error (assert one of the two)". Task 025 established that `lib/tools/bridge.ts#SEALED_WRITE_DIRS` refuses every Tool write into `agents/`, so neither branch can happen here. The check accepts exactly one of **DISPATCHED** (brief present, run id back), **REFUSED** (brief present, run refused for a reason a person can act on — no model key, agent not activated) or **SEALED**, and names the verdict in its detail. Today it is SEALED: `brief refused (agents/ holds configuration that runs — no tool may write there, whatever its perimeter declares.) · run blocked`, and the sealed branch additionally checks the brief markdown handed back really is an agent note naming the task, so the "save this yourself" path is proven rather than assumed. The follow-up already exists as task 057. A second assertion re-reads the task note and confirms `agent: "wayfinder-visvine-tools-025"` + `run: {status:"blocked",…}` landed on its frontmatter.

(2) **No `[data-tool-ready]` to poll — ToolFrame sets none, and it is outside this task's scope.** The spec offered "or the frame content", which is what this uses: the frame's `h1.vv-page-header__title`, which only renders after `loadProject` has come back through the bridge. Playwright reaches into the sandboxed cross-origin frame fine (the escape suite established this), so every in-frame assertion is a real DOM read.

**Three things I changed after seeing them fail, each a real weakness in the check rather than in the product.** (a) The note route mounts with a plain `[Context | Raw]` bar and swaps the type tab in once it has resolved which Tool owns the type — reading the labels on first paint got the wrong moment's answer, so it waits for `#tab-tool`. (b) **The whole `<aside>` is the wrong thing to measure**: it is one persistent card that also hosts the docked context tree, so it legitimately goes 77px → 324px on a note route. The *rail column* is what must hold still, and it does — 0,64 76×836 on every route, including the sample taken mid-tree-animation. (c) A before/after pair around the frame load is near-vacuous on a warm server (one sample). The chrome is now sampled every 150ms across the whole load *and* anchored to a measurement taken on `/home` with no Tool anywhere, so the claim is "the navbar and the rail are exactly where they are when no Tool is involved", not "they didn't move during a window that turned out to be 200ms".

**How it is built.** The seed is shelled out (`node --import tsx scripts/seed-wayfinder-tool.ts`), not imported: it is a top-level script that `$disconnect()`s the Prisma singleton on exit, which would close the pool the rest of the run needs. `CLOUD_SQL_CONNECTION_NAME` is passed as an **empty string** — verified on Windows that an empty value survives `spawnSync` as a defined empty string, which matters because deleting the key would just let the guard's own dotenv loader read it back out of `.env`. The seed's own PASS/ok lines are folded into the output and its `N check(s) failed` line is the assertion. The Done click is verified through **`GET /api/notes/item` with the viewer's cookie** (`page.request`), deliberately not the bridge the rest of the script uses, so the claim is "the note changed" and not "the Tool says it did"; it polls for up to 60s because the write travels frame → host → bridge → isolate → store. `data-tool-ready`'s absence aside, everything reads the DOM, the bridge, the API or a bounding box — never a pixel, per task 022's finding that a sandboxed frame's text does not appear in a capture.

**No cleanup step, by design** (the task said it was optional): the seed is idempotent and the script puts back what it moved — card 026 goes 6 → 1 → 6, and task 024's status is restored from the Done click in a `finally`. The one durable mark is `run:` on task 025's frontmatter, which the seed leaves too and which is the honest record of a dispatch attempt. Screenshots of both surfaces go to the OS temp dir every run, plus a failure capture; `BASE_URL`, `TOOLS_ORIGIN`, `HEADED=1` and `SKIP_SEED=1` are honoured.

**One thing left for task 027:** `docs/wayfinder-tool.md` does not yet mention `verify:wayfinder-tool`. I did not touch it — it is outside my scope and another agent has it open right now (`docs/tools.md` and `apps/web/knip.json` were both modified in the tree while I worked). One line in the doc's runbook is all it needs.
