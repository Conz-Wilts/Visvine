---
id: 018
title: `/tools` marketplace (Browse / Installed / Mine) + navbar icon
status: todo
kind: build
size: l
wave: 3
depends_on: [015, 014]
touches: [apps/web/app/(auth)/tools/page.tsx, apps/web/features/tools/components/marketplace/**, apps/web/features/tools/lib/client.ts, apps/web/features/shared/components/layout/Navbar.tsx]
created_by: 002
session: null
model: null
effort: null
---

## Task

The one marketplace destination. **Navbar.tsx**: add a 'Tools' icon button next to the calendar icon (same size/hover language; a simple 'blocks/puzzle' SVG) linking to `/tools`; visible to every signed-in member (installing is admin-gated inside).

**app/(auth)/tools/page.tsx** → `<Marketplace/>` from features/tools/components/marketplace/. Tabs `Browse | Installed | Mine` in the URL (`?tab=`), using the pane-top tab bar if the shell allows outside /directory (look at how /admin's ConsoleShell mounts its top tabs and reuse that pattern) — otherwise a local tab bar in the page header. All fetches via **features/tools/lib/client.ts** (fetchJson helpers typed with lib/tools/api.ts DTOs).
- **Browse**: search box + cards (title, description, author, version, install count, perimeter chips via `PerimeterSummary`, 'Installed' badge). Card → detail drawer/modal: full description (index.md body rendered with the app's markdown renderer), perimeter, version history, **Install** (admins) → `InstallDialog`: slug field, requirements checklist (`computeRequirements`-based list from the POST result or a preview call — show ✓/✗ per connector/type/agent with 'will run degraded' copy), type-claim conflicts picker, confirm.
- **Installed** (admins see controls, members read-only): rows with enable toggle, degraded banner + 'Re-check', pending upgrade card showing `PerimeterSummary` with the diff + 'Approve upgrade', type claims editor (which type this tool pages/tabs), uninstall.
- **Mine**: the caller's authored tools in this space (from `/authoring`): build status (ok/errors count), version, last published status (pending/approved/rejected + reviewer note), buttons: Open (→ `/directory/tool:<name>`), Preview (→ `/tools/preview/<name>`), Publish (admins; shows a confirm with the perimeter summary), and a 'New Tool' explainer card pointing at the MCP flow (copyable `get_tool_sdk` hint) — no in-app builder.
States: loading skeletons, empty states, error toasts using existing primitives in apps/web/components/ui. Acceptance: tsc/lint/knip clean; walk each tab against `pnpm dev` (report screenshots or a description).
