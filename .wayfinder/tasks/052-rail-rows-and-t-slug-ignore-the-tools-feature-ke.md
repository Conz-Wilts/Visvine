---
id: 052
title: Rail rows and `/t/<slug>` ignore the `tools` feature key that the bridge enforces, so turning Tools off leaves rows that render a failing frame
status: done
kind: fix
size: s
wave: 3
depends_on: []
touches: [apps/web/lib/featureAccess.ts, apps/web/features/shared/lib/features.tsx, apps/web/features/tools/components/ToolPage.tsx, apps/web/tests/tools-rail.test.ts]
created_by: 050
session: 3e316fc4-18c6-4985-97a5-14c0d763265e
model: sonnet
effort: high
---

## Task

The `tools` feature key is enforced inconsistently across the surfaces an installed Tool occupies.

Enforced: `apps/web/lib/tools/target.ts#forbiddenForTools` refuses EVERY bridge call and frame-token mint when `featureAccessForbidden(..., 'tools', ...)` is true — its comment says so explicitly ("a disabled space never sees the shape of a Tool it may not run, install-scoped `enabled` included").

Not enforced:
- `apps/web/lib/featureAccess.ts#navFeatureKeys` filters candidates with `canAccessFeature(config, key, isAdmin)` per key, and for a Tool the key is `tool:<slug>` — never `tools`. So installed-Tool rail rows keep rendering after an admin switches Tools off.
- `apps/web/features/tools/components/ToolPage.tsx` line 39 checks only `canAccessFeature(config, toolRailKey(install.slug), isAdmin)`, so `/t/<slug>` still mounts `<ToolFrame>`.

Result with Tools off: the sidebar shows the Tool's row, clicking it renders the page, and the frame inside then fails with "The Tools feature is not available to you in this space." `defaultLandingHref` (`features/shared/lib/features.tsx`) can also return `/t/<slug>` when a Tool is the first placed row, landing a member on that broken page on entering the space.

Pick one rule and make the surfaces agree. The straightforward fix is to match the bridge: add a `toolsEnabled: boolean` (or equivalent) parameter to `navFeatureKeys` so tool keys are dropped wholesale when `canAccessFeature(config, 'tools', isAdmin)` is false, thread it from `features.tsx#navFeatures`, and add the same guard to `ToolPage`'s `allowed`. If instead the intended rule is "installed Tools keep running even where the vocabulary is off", then `forbiddenForTools` is the thing to narrow (it must still refuse the `preview` branch, which is authoring). Either way add a `tools-rail.test.ts` case pinning the chosen behaviour, and correct whichever comment ends up wrong.

## Outcome

Made the `tools` feature key enforced consistently with the bridge's `forbiddenForTools` rule across the rail and `/t/<slug>`.

- `apps/web/lib/featureAccess.ts#navFeatureKeys`: now computes `toolsOn = canAccessFeature(config, 'tools', isAdmin)` and drops all `toolKeys` wholesale when false, before the per-key `canAccessFeature` filter. This matches the bridge's rule ("a disabled space never sees the shape of a Tool it may not run, install-scoped `enabled` included") and fixes both the sidebar rail (via `railFeatures`/`moreFeatures`) and `defaultLandingHref` in one place, since both flow through this function with the same `config`/`isAdmin` already in hand — no threading through `features.tsx` was needed since it already forwards those two params unchanged.
- `apps/web/features/tools/components/ToolPage.tsx`: `allowed` now also requires `canAccessFeature(config, 'tools', isAdmin)` alongside the existing per-install `tool:<slug>` check, so `/t/<slug>` refuses to mount `<ToolFrame>` when Tools is off, matching the bridge instead of failing inside the frame.
- Updated the stale comments in both files to state the new rule and cross-reference `lib/tools/target.ts#forbiddenForTools`.
- `apps/web/features/shared/lib/features.tsx` needed no code change (read-only check) — it already threads `config`/`isAdmin` straight through to `navFeatureKeys`.
- Added a pinning test in `apps/web/tests/tools-rail.test.ts`: `enabled: { tools: false }` plus an explicit `order` placement for an installed tool's row must still drop the row for both members and admins.

Verified: `node --import tsx --test tests/tools-rail.test.ts` (17/17 pass), full `tests/tools-*.test.ts` + `tests/mcp.test.ts` suite (368/368 pass), `tsc --noEmit` clean, `eslint` on the four touched files clean (0 warnings).
