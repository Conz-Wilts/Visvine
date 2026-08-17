---
id: 005
title: Prisma models + migration for Tool builds, versions, installs, state
status: done
kind: build
size: s
wave: 1
depends_on: []
touches: [apps/web/prisma/schema.prisma, apps/web/prisma/migrations/20260818120000_app_tools/migration.sql]
created_by: 002
session: 855de8f6-b282-4b4f-901c-6939a8e31b31
model: sonnet
effort: high
---

## Task

Add four Prisma models and one hand-written, commented migration (style of apps/web/prisma/migrations/20260817120000_agents/migration.sql; tables snake_case with @@map, columns @map). Then `pnpm prisma:generate` and `pnpm db:migrate` against the local Docker DB (start it with `pnpm db:up` if needed) and confirm `prisma migrate status` is clean.

1. `AppToolBuild` @@map("app_tool_builds"): id (cuid), spaceId, name, sourceHash, ok Boolean, uiBundle String? (text), dataBundle String? (text), errors Json (CompileDiagnostic[]), warnings Json, sizeBytes Int, config Json? (parsed ToolConfig or null), configError String?, createdAt, updatedAt; @@unique([spaceId, name]); relation to Space (onDelete Cascade).
2. `AppToolVersion` @@map("app_tool_versions") — the immutable global registry snapshot: id, key String (`<sourceSpaceId>/<name>`), name, version Int, title, description, authorUserId (relation to User, onDelete SetNull → nullable), sourceSpaceId (String, no FK: survives source space deletion), config Json, perimeter Json, indexSource, uiSource, dataSource (String), uiBundle, dataBundle (String), sizeBytes Int, status String ('pending'|'approved'|'rejected'|'withdrawn'), submittedAt, reviewedBy String?, reviewedAt DateTime?, reviewNote String?, createdAt; @@unique([key, version]); @@index([status, submittedAt]).
3. `AppToolInstall` @@map("app_tool_installs"): id, spaceId (FK Space cascade), versionId (FK AppToolVersion, onDelete Restrict), key (same key as version), slug (rail slug, unique per space), enabled Boolean default true, installedBy String, requirements Json (`{ connectors: string[]; types: string[]; agents: string[] }` = MISSING items at last check), typeClaims Json (`{ [typeName]: 'page'|'tab' }` the admin-confirmed claims), pendingVersionId String? (an approved newer version awaiting admin upgrade), createdAt, updatedAt; @@unique([spaceId, key]); @@unique([spaceId, slug]).
4. `AppToolState` @@map("app_tool_state"): id, installId (FK cascade), key String, value Json, updatedAt; @@unique([installId, key]).

Also add back-relations on Space and User. Migration must create indexes and FKs explicitly and carry a header comment explaining the four tables. Acceptance: `pnpm prisma:generate` ok, `pnpm db:migrate` applies, `pnpm --filter @visvine/web exec tsc --noEmit` passes.

## Outcome

Added the four Prisma models for Tool builds/versions/installs/state and their hand-written migration; applied cleanly to the local Docker DB.

- `AppToolBuild` (`app_tool_builds`): a space's compiled working copy of one Tool (unique on spaceId+name), space-cascade FK.
- `AppToolVersion` (`app_tool_versions`): the global, immutable marketplace registry snapshot, unique on key+version, indexed on status+submittedAt for the review/browse queries, nullable FK to User (SetNull) for the author, deliberately no FK on sourceSpaceId (must survive the source space's deletion).
- `AppToolInstall` (`app_tool_installs`): a space's pinned install, unique on spaceId+key and spaceId+slug, cascade FK to Space, Restrict FK to AppToolVersion, deliberately no FK on pendingVersionId.
- `AppToolState` (`app_tool_state`): per-install KV bridge state, unique on installId+key, cascade FK to AppToolInstall.

Added back-relations `Space.appToolBuilds`/`Space.appToolInstalls` and `User.appToolVersionsAuthored`. Migration follows the `20260817120000_agents` style: header comment explaining all four tables and the two deliberate non-FK columns, explicit `CREATE TABLE`/`CREATE UNIQUE INDEX`/`ALTER TABLE ... ADD CONSTRAINT` statements, snake_case columns via `@map`/`@@map`.

Verified: `pnpm prisma:generate` succeeded; started Docker (was down) and `pnpm db:up`; `pnpm db:migrate` applied the new migration cleanly (baseline + deploy + sql-functions all succeeded); `prisma migrate status` reports "Database schema is up to date!"; `pnpm --filter @visvine/web exec tsc --noEmit` passed with zero errors.
