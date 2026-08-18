---
id: 049
title: "The other /directory/[nodeId] shells ignore a same-route ?tab= change"
status: todo
kind: build
size: xs
wave: 4
depends_on: []
touches: ["apps/web/app/(auth)/directory/[nodeId]/page.tsx"]
created_by: 019
session: null
model: null
effort: null
---

## Task

`NodePage` kept its active tab in local state seeded from the URL once, so an in-app `<Link>` to `?tab=context` from inside the first tab moved the address bar and nothing else — the Tool page's file links and the agent page's "edit the brief on the Context tab" link both silently did nothing. Task 019 fixed it in NodePage (a URL→state effect compared against the last URL value, not against the current tab, so a user's own tab click doesn't get dragged back while `router.replace` lands).

`ContextOnlyPage`, `ResourceNodePage` and `NoteOnlyPage` in the same file have the identical pattern and the identical latent bug; they were left alone because nothing links into them today and 019 was told to keep its diff to the tool branch. Give them the same treatment (or lift the sync into a shared hook beside `useProfileTabParam`), and add a test if the pane-shell chrome is testable by then.

Coordinate with the type-page task, which is rewriting the dispatch in this file.
