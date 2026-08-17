---
id: 017
title: "Installed Tools in the sidebar rail, `/t/[slug]` full-pane page, admin ordering"
status: todo
kind: build
size: m
wave: 3
depends_on: [012, 014, 006]
touches: [apps/web/lib/spaces/queries.ts, apps/web/lib/types/space.ts, apps/web/features/shared/lib/features.tsx, apps/web/features/shared/components/layout/Sidebar.tsx, apps/web/features/shared/contexts/SpaceContext.tsx, apps/web/features/admin/components/SpaceToolsPanel.tsx, "apps/web/app/(auth)/t/[slug]/page.tsx", apps/web/features/tools/components/ToolPage.tsx, apps/web/features/tools/components/toolIcons.tsx, apps/web/tests/tools-rail.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

Surface (a): each install becomes a sidebar rail row and a full-pane page.

1. **Space DTO**: in lib/spaces/queries.ts include `installedTools: InstalledToolDto[]` (from `installedToolsForClient` in lib/tools/installs.ts — enabled installs only, in a stable order) on the Space objects the client hydrates with (`/api/data/communities`, `/api/user/communities` use these queries — verify); add the field to the `Space` type in lib/types/space.ts. Keep it cheap (one query, joined).
2. **features.tsx**: `railFeatures(config, isAdmin, installedTools?)` / `moreFeatures(...)` / `defaultLandingHref(...)` merge tool rows: each installed tool with a `rail` surface becomes a `FeatureDef { key: toolRailKey(slug), label, href: '/t/<slug>', icon: <ToolIcon name/> }`, ordered by `featureConfig.order` (tool keys not yet in `order` append after built-ins), tucked into More when in `featureConfig.more`. Non-admins see them; admin-only-ness is not a tool concept. Tests in tests/tools-rail.test.ts (pure ordering with tool keys; the icon can be stubbed by testing a pure `railKeys(...)` helper you extract).
3. **Sidebar.tsx / SpaceContext.tsx**: pass `installedTools` from `useSpace()` into the rail/More builders; a degraded install shows a small dot on its rail row (title attribute explains).
4. **SpaceToolsPanel.tsx**: installed tools appear in the same order/More editor as built-in features (drag/reorder + More toggle) — same commit path (`mergeFeatureConfig` semantics; never wipe tool keys); no enable toggle here (that lives in /tools Installed).
5. **features/tools/components/toolIcons.tsx**: `ToolIcon({ name })` mapping the small named icon set from `parseToolConfig` (grid, kanban, table, chart, calendar, list, sparkles, box) to inline SVGs in the Sidebar's icon style.
6. **app/(auth)/t/[slug]/page.tsx** + **ToolPage.tsx**: resolve the install by slug from `useSpace().currentSpace.installedTools` (404 state when missing/disabled), set the page header via the shared header context like /channels or /agents does, and render `<ToolFrame target={{kind:'install', installId}} mode="page" title=…/>` filling the main content area (`AuthLayoutClient` full-bleed hatch if that's how /channels gets edge-to-edge — check `fullBleed` in app/(auth)/AuthLayoutClient.tsx and extend its path test to `/t/` — that file is NOT in your touches, so if a change there is unavoidable, keep it to the one path predicate and say so). The frame is the only thing in the pane; navbar and sidebar untouched. Acceptance: tsc/lint/test/knip clean; with an install row present (insert one manually or via the registry lib in a tsx script), the rail shows the item and `/t/<slug>` renders the frame (screenshot via Playwright/chrome-devtools MCP if available; report).
