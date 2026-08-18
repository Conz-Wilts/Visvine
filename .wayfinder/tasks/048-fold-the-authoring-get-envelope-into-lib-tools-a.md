---
id: 048
title: Fold the authoring GET envelope into lib/tools/api.ts and the three spaceFacts readings into one
status: todo
kind: build
size: s
wave: 4
depends_on: []
touches: [apps/web/lib/tools/api.ts, apps/web/lib/tools/service.ts, apps/web/lib/tools/installs.ts, apps/web/lib/mcp/appTools.ts, apps/web/features/tools/lib/client.ts, apps/web/features/profile/components/ToolPageContent.tsx, "apps/web/app/api/communities/[spaceId]/tools/authoring/[name]/route.ts"]
created_by: 019
session: null
model: null
effort: null
---

## Task

Two pieces of task 019 landed in the wrong file because the right ones were held by other wave-3 agents.

1. **The envelope.** `GET /api/communities/[spaceId]/tools/authoring/[name]` now answers `{ tool, requirements, versions }` (it gained the space's requirements check and the publication trail, both of which the author page needs and neither of which any other route provides). Its type is declared as `AuthoredToolView` in **lib/tools/service.ts** with a TODO, because lib/tools/api.ts — where every other Tools envelope lives, per task 015 — was leased by task 020 at the time. Move it into api.ts keeping the name, re-point the route and features/profile/components/ToolPageContent.tsx, and re-type **features/tools/lib/client.ts#fetchAuthoredTool** (currently typed to the narrower `AuthoredToolResponse`, which is why ToolPageContent does its own fetchJson instead of going through the client — collapse that too). If `AuthoredToolResponse` then has no consumer, delete it rather than leaving it for knip.

2. **spaceFacts.** "What does this space have" is now read three times: `lib/tools/installs.ts#spaceFacts` (under the acting admin's principal, for install/upgrade/recheck), `lib/mcp/appTools.ts#liveSpaceFacts` (under the caller's principal, for check_tool) and `lib/tools/service.ts#toolRequirementsInSpace` (under the author's principal, added by 019 because installs.ts was leased by task 017). They must never disagree — a checklist that says "satisfied" while the bridge refuses is worse than no checklist. Fold onto one helper that takes an explicit principal + context and returns `{ available, customTypes }`; keep the two different principals as the CALLER's choice, not the helper's.

Also pre-existing and worth clearing while in the file: `ToolServiceError` in lib/tools/service.ts is exported but used only inside its own module (knip flags it).
