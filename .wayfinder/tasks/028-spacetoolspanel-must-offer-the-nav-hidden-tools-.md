---
id: 028
title: SpaceToolsPanel must offer the nav-hidden `tools` toggle
status: todo
kind: build
size: s
wave: 3
depends_on: []
touches: [apps/web/features/admin/components/SpaceToolsPanel.tsx, apps/web/features/admin/components/people/ToolAccessTab.tsx]
created_by: 006
session: null
model: null
effort: null
---

## Task

Wave-1 task 006 added feature key `tools` to ALL_FEATURE_KEYS + NAV_HIDDEN_FEATURE_KEYS. NAV_HIDDEN is correct (Tools is reached from the navbar marketplace icon and per-install `tool:<slug>` rail rows, never a 'Tools' rail row), but it leaves a functional gap: features/admin/components/SpaceToolsPanel.tsx derives BOTH its rows and its 'Add a tool' picker from `order`, which it seeds as `FEATURES.filter(f => !NAV_HIDDEN_FEATURE_KEYS.includes(f.key))`. `tools` is therefore invisible in the console — and because app/api/communities/route.ts defaults every non-core key to `false` for a new space, `enabled.tools` starts off with no way for an admin to switch it on. `tools` is the first nav-hidden NON-core key, so this combination has never existed before (notes and events are core and can never be off).

Fix: give the panel a notion of "toggleable but not placeable" — a tool that appears in the enable/disable list and the picker (with its node types named, `featureNodeTypeNames('tools')` already returns ['Tool']) but never in the rail/More ordering sequence. Keep the existing invariant that NAV_HIDDEN keys never enter `order`/`more`. Verify an admin can turn Tools on and off, that doing so carries the Tool node type with it (isNodeTypeEnabled), and that the save still merges through mergeFeatureConfig without touching `order`/`more`. Fold this into the wave-3 rail-rows work if that task is already reshaping the same panel.
