---
id: 006
title: "`tool` entity kind, `tools` feature key, dynamic `tool:<slug>` rail keys"
status: done
kind: build
size: m
wave: 1
depends_on: []
touches: [apps/web/lib/notes/entities.ts, apps/web/lib/types/context.ts, apps/web/lib/types/nodeTypeRegistry.ts, apps/web/lib/featureAccess.ts, apps/web/features/shared/lib/features.tsx, apps/web/lib/notes/contextService.ts, apps/web/tests/tools-feature-keys.test.ts, apps/web/tests/notes-entities.test.ts]
created_by: 002
session: ad61f818-bfbc-4452-a4d3-8f8a19b7772a
model: opus
effort: xhigh
---

## Task

Make Tools the third note-first entity kind, following exactly how `connector` and `agent` were added (read the header comments in apps/web/lib/notes/entities.ts and grep for 'agent' across lib/notes, lib/types, lib/featureAccess.ts, features/shared/lib/features.tsx).

1. **entities.ts**: add `EntityKind` 'tool' with dir `tools` (`ENTITY_DIRS`), `entityKindOf('tool'|'tools')`, node id prefix `tool:` — the entity note is the FOLDER INDEX `tools/<name>/index.md` (tools are always entity folders; `tools/<name>/ui.md` and `data.md` are sub-notes owned by the tool node, exactly like any entity sub-note). Ensure `parseEntityHref`, `entityNotePaths`, `resolveEntityOwner`, `entityKindOfPath` treat `tools/<name>/index.md` as the entity note and `tools/<name>/*.md` as its sub-notes; the flat form `tools/<name>.md` must NOT be an entity path (a tool is folder-only). Add `isToolIndexPath(path)` / `toolNameOfEntityPath` helpers only if the existing generic helpers can't express it. Extend apps/web/tests/notes-entities.test.ts.
2. **lib/types/context.ts + nodeTypeRegistry.ts**: add built-in node type `Tool` (name 'Tool', a colour from the palette, shape square, icon) to `DEFAULT_NODE_TYPES` and to any TYPE_SYNONYMS / reserved-name list so a member can't invent a custom type called 'tool'.
3. **lib/featureAccess.ts**: add feature key `tools` to `ALL_FEATURE_KEYS` and `NAV_HIDDEN_FEATURE_KEYS` (Tools are reached from the navbar marketplace icon and per-install rail rows, never a 'Tools' rail row), `NODE_TYPE_FEATURE_KEYS.tool = 'tools'`. Introduce dynamic rail keys: export `TOOL_RAIL_KEY_PREFIX = 'tool:'`, `toolRailKey(slug)`, `isToolRailKey(key)`; make `sortFeatureKeys`, `moreFeatureKeys`, `mergeFeatureConfig` and any validator that filters `order`/`more`/`adminOnly` against ALL_FEATURE_KEYS also accept keys matching `tool:<slug>` (they are persisted like the others; unknown non-tool keys are still dropped). Keep everything pure. New test file tests/tools-feature-keys.test.ts covers ordering with tool keys, More membership, merge not wiping tool keys.
4. **features/shared/lib/features.tsx**: add a `FeatureDef` for key `tools` (label 'Tools', href '/tools', description 'Tools built by members and installed from the marketplace.', simple SVG icon) so the admin Tools toggle panel lists it; because it is NAV_HIDDEN it produces no rail row.
5. **contextService.ts**: in `lockedDenial` add `tools/` beside `agents/` as frozen for AI origins (agent/ai-enrich/maintenance) — humans and MCP clients write freely; do NOT add an admin-only writeDenial for tools/ (members author).

Acceptance: tsc/lint/test/knip clean; `pnpm test` includes the two test files.

## Outcome

Tool is now the third note-first entity kind, following connector/agent: `tool` EntityKind → `tools/` dir → node id `tool:<slug>`, feature key `tools` (nav-hidden), and dynamic `tool:<slug>` rail keys that survive every featureConfig validator. tsc/lint/test/knip clean for my files; `pnpm test` runs 681 tests, 0 fail, and includes both required test files.

**entities.ts** — added `'tool'` to `EntityKind`, `ENTITY_DIRS`/`ENTITY_TYPE_LABEL` (lowercase `tool`, machine config like connector/agent)/`ENTITY_TAG`, and `entityKindOf('tool'|'tools')`. Tools are folder-only, which is new, so I introduced `FOLDER_ONLY_ENTITY_KINDS` and split the namespace regex into `FLAT_ENTITY_NS_RE` (either form) / `FOLDER_ENTITY_NS_RE` (`tools`, index only) / `ENTITY_NS_RE` (both, for sub-note ownership). Result: `tools/<n>/index.md` is the entity note (`parseEntityHref`, `entityKindOfPath`, `isEntityFolderIndex`, `entityNotePath` — which ignores any `metadata.notePath`), `entityNotePaths` registers the index ALONE so the flat path can never resolve to the tool, `tools/<n>/ui.md`/`data.md` are ordinary sub-notes (`entityOwnerPathOf` → `tools/<n>`, `resolveEntityOwner` → `{id, subPath}`), and `tools/<n>.md` is not an entity path at all. `entityFlatPath` still yields `tools/<n>.md` as the derivation base — that's deliberate and documented, because it's what lets store.ts's existing `nodeForEntityPath`/`ensureEntityFolder`/`isEntityFolder` machinery work for tools untouched. Added `isToolIndexPath` and `toolNameOfEntityPath`: the first is a thin, well-named wrapper over the generic helper, the second has no generic equivalent (nothing extracts an entity slug from a path) and mirrors `agentNameOfPath`.

**context.ts / nodeTypeRegistry.ts** — `{ name: 'Tool', color: '#8b5cf6', shape: 'square' }` in `DEFAULT_NODE_TYPES` (violet is the one PALETTES hue no other type had taken); `'tool'` added to `STRUCTURAL_NODE_TYPES` beside connector/agent so tools don't surface as directory-grid cards; `tool`/`tools` added to `TYPE_SYNONYMS` so the plural folds onto the built-in; `'tool'`/`'tools'` added to `RESERVED`. I did NOT set `NodeTypeConfig.icon` — no built-in does and nothing reads that field.

**featureAccess.ts** — `tools` in `ALL_FEATURE_KEYS` + `NAV_HIDDEN_FEATURE_KEYS`, NOT in `ADMIN_ONLY_FEATURE_KEYS`, `NODE_TYPE_FEATURE_KEYS.tool = 'tools'`. Exported `TOOL_RAIL_KEY_PREFIX`, `toolRailKey(slug)`, `isToolRailKey(key)` (`/^tool:[^\s/:]+$/` — one note-folder segment, permissive about the rest). A new private `isPersistableFeatureKey` type guard replaces the four `ALL_FEATURE_KEYS.includes` filters in `adminOnlyFeatureKeys`, `moreFeatureKeys`, and `sanitizeFeatureConfig`'s `order`/`more`, so tool keys persist while unknown non-tool keys are still dropped. `sortFeatureKeys` needed no change — it qualifies ordered keys by membership in the caller's list, never against the registry; I documented that and covered it with tests. `mergeFeatureConfig` inherits tool keys automatically via the arrays it doesn't overwrite. Everything stays pure.

**features.tsx** — `FeatureDef` for `tools` (label Tools, `/tools`, marketplace description, wrench SVG). Because it's NAV_HIDDEN it produces no rail row, as intended. I did not add the rail-key helpers to the re-export block — nothing imports them from there yet and knip must stay at zero.

**contextService.ts** — `tools/` frozen for AI origins in `lockedDenial`, beside `agents/`; no admin-only `writeDenial` clause (members author).

**Verification:** `pnpm test` 681/681 pass. `pnpm --filter @visvine/web exec tsc --noEmit` reports errors only in `features/tools/kit/runtime.ts` and `lib/tools/compile.ts` — other wave-1 agents' in-flight files, none of mine. `pnpm lint` reports one warning, in another agent's `tests/tools-compile.test.ts`; eslint over my eleven files with `--max-warnings=0` is clean. `knip` lists 22 unused files / 17 unused types, all under `features/tools/kit/*` and `lib/tools/*` (other agents' wave-1 code not yet consumed) — none of my files or new exports appear.

**Out-of-scope edits, kept minimal.** (1) `lib/mcp/typeCatalog.ts` + `tests/mcp.test.ts`: `buildTypeCatalog` auto-derives from `DEFAULT_NODE_TYPES`, so adding Tool broke the closed-vocabulary test and would have shipped an empty `guidance` for a real type — added one `GUIDANCE.tool` line and updated/extended the expectation. (2) `tests/feature-access.test.ts`: one assertion pinned `NAV_HIDDEN_FEATURE_KEYS` to `['notes','events']`.

**Two things the next waves must handle.** (a) Proposed task 028 (wave 3): `SpaceToolsPanel` derives its rows AND its picker from `order`, which excludes NAV_HIDDEN keys, so `tools` has no console toggle — and since `app/api/communities/route.ts` defaults every non-core key to `false`, a new space's `enabled.tools` starts off with no way to switch it on. `tools` is the first nav-hidden non-core key, so this combination is new. (b) The `tools/` AI freeze bites the generic MCP context writes, which pass origin `'agent'` (`lib/mcp/tools.ts`): the dedicated Tool handlers in wave 2/3 must write with a human origin (`'edit'`) — the same distinction that keeps `'ai-refactor'` out of `AI_ORIGINS`. I left a NOTE comment at the freeze saying exactly that.
