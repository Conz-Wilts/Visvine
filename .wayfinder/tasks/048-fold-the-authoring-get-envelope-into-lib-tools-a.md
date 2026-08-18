---
id: 048
title: Fold the authoring GET envelope into lib/tools/api.ts and the three spaceFacts readings into one
status: done
kind: build
size: s
wave: 4
depends_on: []
touches: [apps/web/lib/tools/api.ts, apps/web/lib/tools/service.ts, apps/web/lib/tools/installs.ts, apps/web/lib/mcp/appTools.ts, apps/web/features/tools/lib/client.ts, apps/web/features/profile/components/ToolPageContent.tsx, "apps/web/app/api/communities/[spaceId]/tools/authoring/[name]/route.ts"]
created_by: 019
session: eaaa5556-fb63-43ab-95a1-efe8d56e5ba7
model: sonnet
effort: high
---

## Task

Two pieces of task 019 landed in the wrong file because the right ones were held by other wave-3 agents.

1. **The envelope.** `GET /api/communities/[spaceId]/tools/authoring/[name]` now answers `{ tool, requirements, versions }` (it gained the space's requirements check and the publication trail, both of which the author page needs and neither of which any other route provides). Its type is declared as `AuthoredToolView` in **lib/tools/service.ts** with a TODO, because lib/tools/api.ts — where every other Tools envelope lives, per task 015 — was leased by task 020 at the time. Move it into api.ts keeping the name, re-point the route and features/profile/components/ToolPageContent.tsx, and re-type **features/tools/lib/client.ts#fetchAuthoredTool** (currently typed to the narrower `AuthoredToolResponse`, which is why ToolPageContent does its own fetchJson instead of going through the client — collapse that too). If `AuthoredToolResponse` then has no consumer, delete it rather than leaving it for knip.

2. **spaceFacts.** "What does this space have" is now read three times: `lib/tools/installs.ts#spaceFacts` (under the acting admin's principal, for install/upgrade/recheck), `lib/mcp/appTools.ts#liveSpaceFacts` (under the caller's principal, for check_tool) and `lib/tools/service.ts#toolRequirementsInSpace` (under the author's principal, added by 019 because installs.ts was leased by task 017). They must never disagree — a checklist that says "satisfied" while the bridge refuses is worse than no checklist. Fold onto one helper that takes an explicit principal + context and returns `{ available, customTypes }`; keep the two different principals as the CALLER's choice, not the helper's.

Also pre-existing and worth clearing while in the file: `ToolServiceError` in lib/tools/service.ts is exported but used only inside its own module (knip flags it).

## Outcome

Moved AuthoredToolView into lib/tools/api.ts and folded the three spaceFacts readings into one.

1. Envelope: `AuthoredToolView` moved from lib/tools/service.ts to lib/tools/api.ts (kept the name), importing `ToolRequirements` from ./requirements. The GET route now imports it from `@/lib/tools/api` instead of `@/lib/tools/service`, with the stale TODO comment removed. `features/tools/lib/client.ts#fetchAuthoredTool` is retyped to `AuthoredToolView`. `ToolPageContent.tsx` now calls that client helper instead of its own inline `fetchJson` call, and imports `AuthoredToolView` from `lib/tools/api`. `AuthoredToolResponse` had no remaining consumer after the retype, so it was deleted from api.ts.

2. spaceFacts: the three readings (lib/tools/installs.ts, lib/mcp/appTools.ts#liveSpaceFacts, lib/tools/service.ts#toolRequirementsInSpace) are folded onto one exported `spaceFacts(p: ContextPrincipal, context: Context): Promise<SpaceFacts>` in lib/tools/installs.ts (returns `{ available, customTypes }`). installs.ts's old `spaceFacts(spaceId, userId)` is now a private wrapper `spaceFactsForActor` that builds the acting-admin principal via `principalForUser` then calls the shared helper — so install/upgrade/recheck still read under the admin's principal. `lib/tools/service.ts#toolRequirementsInSpace` and `lib/mcp/appTools.ts`'s `AppToolDeps.spaceFacts` now both call the shared `spaceFacts` under their own (author/caller) principal, with all the duplicated connector/type/agent-walking code and now-unused imports removed. One behavioral note: installs.ts previously computed agent names by hand-walking the vault for agent-brief paths; it now goes through `listAgents` (as the other two readings already did) for consistency — same underlying vault walk, so no behavior change, just one fewer parallel implementation.

3. `ToolServiceError` in service.ts was already not exported (checked the source and confirmed via `pnpm exec knip`, which doesn't flag it) — no change needed there; the task's premise on that point didn't hold against current state.

Verified: `pnpm exec tsc --noEmit` clean (only pre-existing unrelated errors in an intentionally-broken test fixture outside my scope, scripts/fixtures/tools/hello/ui.broken.tsx); `pnpm exec eslint` clean on all touched files; `pnpm exec knip` clean (no more unused-export flags on spaceFacts/SpaceFacts); full `node --test tests/*.test.ts` suite passes (964/964).
