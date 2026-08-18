---
id: 028
title: SpaceToolsPanel must offer the nav-hidden `tools` toggle
status: done
kind: build
size: s
wave: 3
depends_on: []
touches: [apps/web/features/admin/components/SpaceToolsPanel.tsx, apps/web/features/admin/components/people/ToolAccessTab.tsx]
created_by: 006
session: ee3a1f01-d83c-404b-8da7-43d309b136bf
model: sonnet
effort: high
---

## Task

Wave-1 task 006 added feature key `tools` to ALL_FEATURE_KEYS + NAV_HIDDEN_FEATURE_KEYS. NAV_HIDDEN is correct (Tools is reached from the navbar marketplace icon and per-install `tool:<slug>` rail rows, never a 'Tools' rail row), but it leaves a functional gap: features/admin/components/SpaceToolsPanel.tsx derives BOTH its rows and its 'Add a tool' picker from `order`, which it seeds as `FEATURES.filter(f => !NAV_HIDDEN_FEATURE_KEYS.includes(f.key))`. `tools` is therefore invisible in the console — and because app/api/communities/route.ts defaults every non-core key to `false` for a new space, `enabled.tools` starts off with no way for an admin to switch it on. `tools` is the first nav-hidden NON-core key, so this combination has never existed before (notes and events are core and can never be off).

Fix: give the panel a notion of "toggleable but not placeable" — a tool that appears in the enable/disable list and the picker (with its node types named, `featureNodeTypeNames('tools')` already returns ['Tool']) but never in the rail/More ordering sequence. Keep the existing invariant that NAV_HIDDEN keys never enter `order`/`more`. Verify an admin can turn Tools on and off, that doing so carries the Tool node type with it (isNodeTypeEnabled), and that the save still merges through mergeFeatureConfig without touching `order`/`more`. Fold this into the wave-3 rail-rows work if that task is already reshaping the same panel.

## Outcome

SpaceToolsPanel now gives nav-hidden, non-core feature keys (currently only `tools`) a way to be switched on and off even though they can never enter `order`/`more`. Detail: added a derived `unplaceableFeatures` list (`allFeatures.filter(f => !f.core && NAV_HIDDEN_FEATURE_KEYS.includes(f.key))`); when disabled these features are folded into `availableFeatures` so they show in the "Add a tool" picker (with `featureNodeTypeNames` naming what they carry, e.g. "Adds the Tool type"); clicking Add on one calls a new `toggleUnplaceable(key, true)` that patches only `enabled` via the existing `commit()` — `order`/`more` pass through untouched, preserving the invariant that NAV_HIDDEN keys never enter them. When enabled, the feature renders as a plain non-draggable row with a `Toggle` switch (new import `@/components/ui/Toggle`) in a new "No sidebar row" section below the More block, rather than as a draggable rail/More row. This closes the gap where `tools` was seeded into `enabled` state but never surfaced anywhere, leaving a new space with `enabled.tools === false` and no way for an admin to ever turn it on.

I also checked `ToolAccessTab.tsx` (in scope) for a matching gap — it excludes NAV_HIDDEN_FEATURE_KEYS (including `tools`) from its per-space admin-lock list. That exclusion is correct existing behavior, not a bug: `tools` is the tool-vocabulary switch, not a lockable nav row (installed Tools' own `tool:<slug>` rows remain individually lockable there, confirmed by tests). No change made to that file.

Verified with `pnpm --filter @visvine/web exec tsc --noEmit` (clean), `eslint` on both scoped files (clean, `--max-warnings=0`), and `node --import tsx --test tests/feature-access.test.ts tests/tools-feature-keys.test.ts` (64/64 pass, including the `mergeFeatureConfig`/`sanitizeFeatureConfig`/`adminOnlyFeatureKeys` invariants this fix depends on). Did not spin up the dev server for a manual click-through since no test harness/browser was requested and the underlying logic is fully covered by the node test suite plus tsc/lint.
