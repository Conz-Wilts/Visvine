---
id: 055
title: Verify wave 3 (round 2)
status: done
kind: verify
size: null
wave: 3
depends_on: []
touches: []
created_by: null
session: 7e57ac98-5aeb-4b17-808f-7b263a93ee84
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 3.

## Outcome

PASS: PASS (round 2). Every gate from the plan's verification section is green, and all four issues filed by round 1 (051/052/053/054) are genuinely fixed in the code, not just claimed.

**Gates, from the repo root:**
- `pnpm --filter @visvine/web exec tsc --noEmit` — exit 0, no output.
- `pnpm lint` (`eslint . --max-warnings=0`) — exit 0, clean.
- `pnpm test` — **945/945 pass**, 33 suites, 0 fail (up from 943: task 051 added the 8-handler feature-gate test, task 052 added the `enabled: {tools:false}` rail-drop test).
- `pnpm build` — exit 0; `/t/[slug]`, `/tools`, `/tools/preview/[name]` and the eight new API routes all appear in the route manifest.
- `pnpm --filter @visvine/web exec knip` — **exit 0, zero output** (was 2 items in round 1). This is the plan's "must stay zero".

**Round-1 issues re-checked against the source, not the task write-ups:**
- **051** — `lib/mcp/appTools.ts` now has `featureAccessForbidden` on the `AppToolDeps` seam (live impl → `lib/auth.ts#featureAccessForbidden(..., 'tools', ...)`) and `requireToolsFeature(ctx, target, deps)` fires immediately after `deps.resolveTarget` in create/list/write/publish/install, and once inside the shared `requireTool` helper that read/check/preview go through — all 8 space-scoped handlers covered. `get_tool_sdk` is correctly ungated (no `space_id`, never resolves a target). Refusal is a 403 with the same sentence the REST guard uses.
- **052** — `navFeatureKeys` computes `toolsOn = canAccessFeature(config, 'tools', isAdmin)` and drops `toolKeys` wholesale before the per-key filter, so the rail, the More popup and `defaultLandingHref` all go quiet together; `ToolPage.tsx`'s `allowed` now requires `canAccessFeature(config, 'tools', isAdmin)` alongside the per-install `tool:<slug>` check, so `/t/<slug>` refuses instead of mounting a frame the bridge would reject. Matches `lib/tools/target.ts#forbiddenForTools`.
- **053** — `isGlobPatternSafe` and `ToolServiceError` are no longer exported; knip is 0.
- **054** — `installedToolsForClient` is gone from `lib/tools/installs.ts`; the only remaining mentions anywhere are task-file prose. `toClientDto`/`installedToolsForSpaces` comments now state the enabled-only policy once, and `railRows.ts` names the right function.

**Re-read of the wave for regressions from those fixes:** the `tools` key is now enforced consistently at all four doors — REST (`lib/tools/route.ts#requireToolsAccess`), MCP (`requireToolsFeature`), the bridge (`forbiddenForTools`), and the nav/page (`navFeatureKeys` + `ToolPage`). `/tools` and `/tools/preview/*` are additionally covered by `useFeatureRouteGuard`, which matches them via the `tools` entry in `FEATURES` (href `/tools`, prefix match) — the marketplace page's own comment is accurate. `toolRailRows`' `label !== null` filter is sound: `parseRail` falls the label back to the Tool's title, so a null label really does mean "no rail surface declared". `orderWithRail` still materialises the registry order before appending, so installing can't move a space's front door. Audit calls use the established fire-and-forget `void logAudit(...)` (logAudit swallows internally) and the `applyUpgrade` select now carries `version: true`. No `@ts-ignore`, `eslint-disable` or `as any` added by this wave; the only two TODOs are the ones task 048 already tracks.

**No issues filed.** Nits not worth an agent:
- `apps/web/tests/tools-rail.test.ts:68` still has a comment naming the deleted `installedToolsForClient` (task 054 flagged this — the file was leased at the time). One-word comment fix, zero behavioural weight.
- `installs.ts#featureConfigWithoutRail` still leaves a dead `enabled['tool:<slug>']` key behind on uninstall. Harmless: the key can only ever be stored `true` from `SpaceToolsPanel` (tool rows have no trash button), and `isFeatureEnabled` defaults an absent key to enabled anyway.
- `defaultLandingHref` can now return `/t/<slug>`, which is intended but has no test.
- Follow-ups 046/047/048/049 remain filed for later waves; none blocks wave 3.
