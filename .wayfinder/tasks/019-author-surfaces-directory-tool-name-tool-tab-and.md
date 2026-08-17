---
id: 019
title: "Author surfaces: `/directory/tool:<name>` Tool tab and `/tools/preview/[name]`"
status: todo
kind: build
size: m
wave: 3
depends_on: [015, 014]
touches: [apps/web/features/profile/components/ToolPageContent.tsx, "apps/web/app/(auth)/directory/[nodeId]/page.tsx", "apps/web/app/(auth)/tools/preview/[name]/page.tsx", apps/web/features/tools/components/ToolPreview.tsx]
created_by: 002
session: null
model: null
effort: null
---

## Task

1. **NodeRoute** (app/(auth)/directory/[nodeId]/page.tsx): add a `tool:` branch → `ToolRoute` rendering `NodePage` with first tab `{ id: 'about', label: 'Tool' }` and body `ToolPageContent`, exactly like `AgentRoute` (every member sees the tab; Context/Raw remain, and the sub-notes `ui.md`/`data.md` open through the entity Context tab's notes strip). Keep the diff to that branch — the type-page task will touch this file next wave.
2. **features/profile/components/ToolPageContent.tsx** (mirror ConnectorPageContent/AgentPageContent structure): fetch `/api/communities/<spaceId>/tools/authoring/<name>`; show build status card (ok / diagnostics list with file:line:col), config summary (title, version, surfaces), `PerimeterSummary`, requirements in THIS space, files list (index.md, ui.tsx, data.js → links to the Context tab sub-notes: `entityContextHref(nodeId, 'ui.md')`), publish status/history, actions: 'Preview' (→ `/tools/preview/<name>`), 'Publish' (admins → POST authoring publish; confirm dialog with perimeter), 'Copy MCP hint'. Not-found and forbidden states.
3. **app/(auth)/tools/preview/[name]/page.tsx** + **ToolPreview.tsx**: renders `<ToolFrame target={{ kind: 'preview', spaceId: currentSpace.id, name }} mode="preview"/>` in the main content area with a slim header strip (tool title, build status, 'Reload', 'Open source'); on build errors the frame document already shows the diagnostics card. This is the target of the `visvine-desktop://open/tools/preview/<name>` deep link — nothing desktop-side to change (deepLinkToPath is generic); confirm by reading apps/desktop/src/urls.ts. Acceptance: tsc/lint/knip clean; visit both pages against `pnpm dev` with a scaffolded tool (report).
