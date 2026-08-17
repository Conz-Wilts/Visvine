---
id: 014
title: "Host ToolFrame component: iframe sandbox, postMessage bridge relay, theme injection, error card"
status: todo
kind: build
size: l
wave: 2
depends_on: [009, 008]
touches: [apps/web/features/tools/components/ToolFrame.tsx, apps/web/features/tools/components/ToolErrorCard.tsx, apps/web/features/tools/components/DegradedBanner.tsx, apps/web/features/tools/components/PerimeterSummary.tsx, apps/web/features/tools/components/CodeDiff.tsx, apps/web/features/tools/lib/theme.ts, apps/web/features/tools/lib/hostBridge.ts, apps/web/features/tools/lib/diff.ts, apps/web/app/api/tools/frame-token/route.ts, apps/web/tests/tools-host-bridge.test.ts, apps/web/tests/tools-diff.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

The Visvine-side host for a Tool. Nothing here runs inside the iframe.

**app/api/tools/frame-token/route.ts**: POST `{ target: BridgeRequest['target'] }` → `requireSession()` → membership/readability check identical to the bridge's target resolution (import a shared helper if tools-bridge-server has landed `lib/tools/target.ts`; if not yet present at your start, do the check inline with prisma + `isAdmin`/membership and leave a TODO comment naming `resolveBridgeTarget` — the wave-3 audit will unify) → returns `{ token, frameUrl }` using `mintFrameToken` + `frameUrl` from lib/tools/origin.

**features/tools/lib/theme.ts**: `collectThemeTokens(doc: Document): Record<string,string>` — reads computed CSS custom properties from `:root`/body that Tools may use: `--color-brand-green` (the accent from ThemeContext) plus the app's colour/font tokens (grep apps/web/app/globals.css and features/shared/contexts/ThemeContext.tsx for the variable names) and maps them to `--vv-*` names documented in the kit; pure over a `getComputedStyle` result so it's testable with a fake.

**features/tools/lib/hostBridge.ts**: `createHostBridge({ iframe, frameOrigin, target, onError, navigate })` — listens for `message` events, verifies `event.source === iframe.contentWindow` and `event.origin === frameOrigin`, validates with `isFrameMessage`, on `visvine:ready` posts `visvine:init` (theme, subject, install/preview, degraded, viewer), relays `visvine:call` → `POST /api/tools/bridge` (fetchJson, same-origin, credentials) → posts `visvine:result` (errors mapped, never thrown), handles `visvine:resize` (min 320px, max the pane height; report height to React), `visvine:error` (surface the error card), `visvine:navigate` (only relative in-app paths — reject `//`, schemes, and anything outside `/`), pushes `visvine:theme` when the accent changes and `visvine:subject` when the subject prop changes; `dispose()`. Unit-test with fake iframe/window objects.

**ToolFrame.tsx** (client): props `{ target, subject?, title, mode: 'page'|'tab'|'preview', className? }`; mints a token on mount (and re-mints on 403/expiry), renders `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" src={frameUrl}>` (NO allow-same-origin, no allow-top-navigation, no allow-popups, no allow-forms), fills the main content area (`w-full`, height = available pane height with internal scrolling inside the frame; the frame may only ever be inside the page body — never portal it), shows a skeleton until `visvine:ready`, a `DegradedBanner` when `degraded` (lists missing requirements, links admins to `/tools?tab=installed`), a `ToolErrorCard` on crash/timeout (message, 'Report' link `mailto:`-free — link to the tool's `/directory/tool:<name>` page or the marketplace entry, and a 'Reload' button); a 15s ready timeout → error card. `ToolErrorCard`/`DegradedBanner` are simple presentational components using existing UI primitives from apps/web/components/ui.

**PerimeterSummary.tsx** (`{ perimeter, diff? }` → grouped chips: reads/writes/types/connectors/agents, added in green/removed in red when a diff is passed) and **CodeDiff.tsx** (`{ before, after, filename }`) over **features/tools/lib/diff.ts** (a small pure LCS line diff → hunks; tested). Acceptance: tsc/lint/test/knip clean.
