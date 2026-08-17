---
id: 020
title: Super-admin Tool review queue in /admin (perimeter + code diff, approve/reject)
status: todo
kind: build
size: m
wave: 3
depends_on: [015, 014]
touches: [apps/web/app/(auth)/admin/page.tsx, apps/web/features/admin/components/ToolReviewPanel.tsx]
created_by: 002
session: null
model: null
effort: null
---

## Task

Add a `review` section (label 'Tool review', width 'wide', badge = pending count) to the sections array in app/(auth)/admin/page.tsx, shown ONLY when `session.user.isSuperAdmin` (regular admins never see it; the routes are super-admin gated anyway). **ToolReviewPanel.tsx**: list pending versions (`GET /api/tools/review`) with key, version, author, source space, submitted time; selecting one loads detail: title/description, `PerimeterSummary` with diff vs previous approved version (added/removed highlighted), `CodeDiff` for `ui.tsx`, `data.js` and `index.md` (before = previous approved version's source or empty), a compact 'what changed' summary line, then Approve / Reject with an optional note (POST). After a decision, refresh the queue and show a toast. Also a 'History' sub-list of recently reviewed versions. Use ConsoleShell conventions (auto-save not needed here — explicit buttons). Acceptance: tsc/lint/knip clean; as `admin@local.dev` (super admin) publish a scaffold tool via the authoring route and approve it in the panel against `pnpm dev` (report).
