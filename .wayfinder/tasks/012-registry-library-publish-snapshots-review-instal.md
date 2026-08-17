---
id: 012
title: "Registry library: publish snapshots, review, install/upgrade, requirements"
status: todo
kind: build
size: l
wave: 2
depends_on: [003, 005, 006]
touches: [apps/web/lib/tools/registry.ts, apps/web/lib/tools/requirements.ts, apps/web/lib/tools/installs.ts, apps/web/tests/tools-registry.test.ts, apps/web/tests/tools-requirements.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

Server library for the marketplace lifecycle over the Prisma models from tools-schema. Keep pure decision logic separate and tested; DB code thin.

**lib/tools/requirements.ts** (pure): `computeRequirements(perimeter: ToolPerimeter, available: { connectors: string[]; types: string[]; agents: string[] }): { connectors: string[]; types: string[]; agents: string[] }` = declared items with NO match in the space (globs like `deal-*` count as satisfied when at least one match exists; `*` alone is never a requirement); `isDegraded(req)`. `describeRequirements(req): string[]`.

**lib/tools/registry.ts**: `publishTool(p, context, spaceId, name, { note? }): Promise<{ version: AppToolVersion } | { error }>` — loads the working copy build (must be ok), the three sources, computes next `version` = max(existing for key)+1, snapshots EVERYTHING into `AppToolVersion` with status 'pending', `authorUserId` = the caller, `key` = `${spaceId}/${name}`; also bumps `version:` in the index note frontmatter via `writeGated` (origin 'system' or the caller). Only space admins (`isAdmin`) may publish; refuse if a pending version already exists for the key. `withdrawVersion(versionId, callerId)`. `listReviewQueue()`, `reviewVersion(versionId, decision: 'approved'|'rejected', reviewer: { userId, email }, note)` — super-admin only (`isSuperAdmin(email)`); on approve, mark every install of the same key whose version < this one with `pendingVersionId` = this id (an admin-approved upgrade). `browseVersions({ q?, cursor? })` — latest APPROVED version per key with author display name and install count; `getVersion(id)`; `versionHistory(key)`; `previousApprovedVersion(key, before)` for diffs. `perimeterDiffForVersion(versionId)` uses `diffPerimeter` against the previous approved version (or EMPTY).

**lib/tools/installs.ts**: `listInstalls(spaceId): InstallSummary[]` (`{ id, key, slug, title, description, version, enabled, requirements, degraded, typeClaims, rail: config.surfaces.rail, types: config.surfaces.types, pendingVersion: {id, version, perimeterDiff} | null }`), `installVersion(spaceId, versionId, actor: { userId; email }, opts: { slug?; typeClaims? })` — admin only; version must be approved; slug defaults to the tool name, de-duplicated within the space; compute requirements against the space (connectors = `runnableConnectorNames`/listConnectors names, types = Space.nodeTypes names lower-cased, agents = agent brief names); resolve `typeClaims`: for each `surfaces.types` entry, `page` on a built-in type is downgraded to `tab`; a `page` claim on a custom type already claimed by another install is NOT auto-granted (left out of typeClaims and reported in the result as `conflicts` for the admin to pick); also **auto-add the rail item**: if `config.surfaces.rail` exists, append `tool:<slug>` to `featureConfig.order` via `mergeFeatureConfig` + `updateSpaceConfig` (never a whole-value PUT). `uninstall(spaceId, installId, actor)` removes the row and the rail key from order/more. `setInstallEnabled`, `setTypeClaims(spaceId, installId, claims)` (validates one-page-per-type), `applyUpgrade(spaceId, installId, actor)` (moves to pendingVersionId, recomputes requirements, clears pending), `refreshRequirements(spaceId)` (call after connectors/types/agents change is optional; expose for the UI's 'Re-check'). Export `installedToolsForClient(spaceId): InstalledToolDto[]` = `{ key, slug, title, icon, label, href: '/t/<slug>', enabled, degraded, types: typeClaims }` — the shape the space DTO will carry.

Tests: requirements logic; typeClaims resolution (built-in downgrade, conflict); slug de-dup; version numbering — write these against pure helpers extracted from registry/installs (`nextVersionNumber`, `resolveTypeClaims`, `uniqueSlug`). Acceptance: tsc/lint/test/knip clean.
