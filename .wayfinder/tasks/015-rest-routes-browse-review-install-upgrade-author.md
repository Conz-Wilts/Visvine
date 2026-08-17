---
id: 015
title: "REST routes: browse/review/install/upgrade + authoring working copies"
status: todo
kind: build
size: m
wave: 3
depends_on: [012, 010]
touches: [apps/web/app/api/tools/registry/route.ts, "apps/web/app/api/tools/registry/[versionId]/route.ts", apps/web/app/api/tools/review/route.ts, "apps/web/app/api/tools/review/[versionId]/route.ts", "apps/web/app/api/communities/[spaceId]/tools/route.ts", "apps/web/app/api/communities/[spaceId]/tools/[installId]/route.ts", "apps/web/app/api/communities/[spaceId]/tools/authoring/route.ts", "apps/web/app/api/communities/[spaceId]/tools/authoring/[name]/route.ts", apps/web/lib/tools/api.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

Thin route handlers over lib/tools/{registry,installs,service}.ts, in the house style (see apps/web/app/api/communities/[spaceId]/connectors/* and agents/*): `requireSession()`, `isAdmin(userId, spaceId, email)` for admin actions, `isSuperAdmin(email)` for review, zod-validated bodies, JSON envelopes with named keys.

- `GET /api/tools/registry?q=&cursor=` → `{ versions: BrowseItem[] , nextCursor }` (approved latest per key, plus `installedInSpace?: boolean` when `?spaceId=` is given).
- `GET /api/tools/registry/[versionId]` → `{ version: { …public fields, config, perimeter, perimeterDiff, uiSource? (only for super-admins or the author), history: [{version, status, reviewedAt}] } }`.
- `GET /api/tools/review` (super-admin) → `{ queue: [...pending with author, key, version, perimeter, perimeterDiff] }`; `GET /api/tools/review/[versionId]` → full detail incl. before/after sources for the CodeDiff; `POST /api/tools/review/[versionId]` `{ decision: 'approved'|'rejected', note? }`.
- `GET /api/communities/[spaceId]/tools` (member) → `{ installs: InstallSummary[] }` (non-admins get the list without pending upgrade details); `POST` (admin) `{ versionId, slug?, typeClaims? }` → `{ install, conflicts }`.
- `PATCH /api/communities/[spaceId]/tools/[installId]` (admin) `{ enabled? | typeClaims? | applyUpgrade?: true | recheck?: true }`; `DELETE` uninstall.
- `GET /api/communities/[spaceId]/tools/authoring` (member) → `{ tools: AuthoredToolSummary[] }`; `GET …/authoring/[name]` → `{ tool: detail incl. sources + build }`; `POST …/authoring/[name]` `{ action: 'publish', note? }` (admin) → `{ version }` or 409 with the build errors when not ok.

**lib/tools/api.ts** — the DTO types shared with the client (`BrowseItem`, `VersionDetail`, `InstallSummary` re-export, `AuthoredToolSummary`) so UI tasks import types from one place (must not import React). Acceptance: tsc/lint/knip clean; exercise each route once with curl against `pnpm dev` using a dev-login cookie (document the calls you made in the outcome).
