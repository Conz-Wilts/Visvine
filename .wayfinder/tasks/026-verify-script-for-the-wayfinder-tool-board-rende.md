---
id: 026
title: Verify script for the Wayfinder Tool (board renders, writes, agent dispatch)
status: todo
kind: build
size: m
wave: 6
depends_on: [025, 024]
touches: [apps/web/scripts/verify-wayfinder-tool.ts, apps/web/package.json]
created_by: 002
session: null
model: null
effort: null
---

## Task

Write apps/web/scripts/verify-wayfinder-tool.ts (add script `verify:wayfinder-tool`) — the final proof. Runs the seed (import and call it, or shell out) then: (1) in-process bridge checks under the space owner: `context.list harness/**` returns the seeded project + tasks, `data.call loadProject` returns waves + tasks grouped, `data.call moveTask` changes a task's `wave` in the note frontmatter (re-read note to assert), `data.call runTask` creates `agents/wayfinder-<project>-<id>.md` and returns a run id or a clear 'no model key configured' error (assert one of the two, print which); (2) Playwright (Chromium, dev login as `admin@local.dev`, `BASE_URL`, `TOOLS_ORIGIN`): open `/t/wayfinder`, wait for the frame's `visvine:ready` (poll a `[data-tool-ready]` attribute the ToolFrame sets, or the frame content), assert the board shows the project name and at least one task card, click a task's status action and assert the note changed via the API; open a `wayfinder-project` note URL under `/directory/note/harness/...` and assert the tab bar shows the 'Wayfinder-project'/type tab first with the frame beneath and Context/Raw available; assert the frame rect is inside `<main>` and the navbar/sidebar are unchanged (same rects before/after load); screenshot to the OS temp dir. Cleanup optional (seed is idempotent). Print a summary table and exit code. Acceptance: passes locally against `pnpm dev`; paste the summary in the outcome. tsc/lint/knip clean.
