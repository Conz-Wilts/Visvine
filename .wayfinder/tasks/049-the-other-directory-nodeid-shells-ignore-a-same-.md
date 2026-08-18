---
id: 049
title: "The other /directory/[nodeId] shells ignore a same-route ?tab= change"
status: done
kind: build
size: xs
wave: 4
depends_on: []
touches: ["apps/web/app/(auth)/directory/[nodeId]/page.tsx"]
created_by: 019
session: ed650b23-68b1-41eb-8e47-0b764328e36e
model: sonnet
effort: high
---

## Task

`NodePage` kept its active tab in local state seeded from the URL once, so an in-app `<Link>` to `?tab=context` from inside the first tab moved the address bar and nothing else — the Tool page's file links and the agent page's "edit the brief on the Context tab" link both silently did nothing. Task 019 fixed it in NodePage (a URL→state effect compared against the last URL value, not against the current tab, so a user's own tab click doesn't get dragged back while `router.replace` lands).

`ContextOnlyPage`, `ResourceNodePage` and `NoteOnlyPage` in the same file have the identical pattern and the identical latent bug; they were left alone because nothing links into them today and 019 was told to keep its diff to the tool branch. Give them the same treatment (or lift the sync into a shared hook beside `useProfileTabParam`), and add a test if the pane-shell chrome is testable by then.

Coordinate with the type-page task, which is rewriting the dispatch in this file.

## Outcome

Applied task 019's URL→state sync fix to the three other shells in the same file that had the identical latent bug. In ContextOnlyPage, NoteOnlyPage, and ResourceNodePage, `activeTab` was local state seeded once from `?tab=`, so an in-app same-route Link to `?tab=context`/`?tab=raw` fired from inside their bodies (e.g. a Tool tab's content, a resource preview) moved the address bar but never updated the rendered tab, since the component doesn't remount on a same-route navigation.

Added the same effect NodePage already had: a `lastWantedTab` ref compared against the current `wantedTab` (not against `activeTab`, since those two legitimately disagree for a tick after a user's own tab click, before `router.replace` lands) — when the URL's tab value actually changes, local state follows it.

Verified with `tsc --noEmit` (clean) and `eslint ... --max-warnings=0` (clean) on the file. No test added: the repo has no React-component test harness (tests run via Node's built-in test runner against pure/server logic only, no jsdom/testing-library), so the pane-shell chrome in this client-only page isn't testable within the existing suite — consistent with why task 019 didn't add one either.
