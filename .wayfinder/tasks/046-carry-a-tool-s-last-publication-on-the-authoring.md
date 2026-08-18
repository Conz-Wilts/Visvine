---
id: 046
title: Carry a Tool's last publication on the authoring roster (Mine tab's review status)
status: todo
kind: build
size: s
wave: 4
depends_on: []
touches: [apps/web/lib/tools/service.ts, apps/web/features/tools/components/marketplace/MineTab.tsx]
created_by: 018
session: null
model: null
effort: null
---

## Task

The `/tools` Mine tab is specified to show each authored Tool's "last published status (pending/approved/rejected + reviewer note)", but the only route it reads — `GET /api/communities/[spaceId]/tools/authoring` → `AuthoredToolSummary` — does not carry it. `AuthoredToolSummary` has `version` (the note's `version:`, 0 until first publish) and the build, and nothing about the registry. There is no other way in: `GET /api/tools/registry` lists only the LATEST APPROVED version of each Tool and is filtered fuzzily by `?q=`, and `GET /api/tools/registry/[versionId]` needs an id the roster never sees — so an author whose first submission is still pending, or was rejected, has no id to look it up with. `registry.ts#versionHistory(key)` already answers exactly this per Tool, and the key is `${sourceSpaceId}/${name}`, which the roster knows.

Add an optional `publication` to `AuthoredToolSummary` in `apps/web/lib/tools/service.ts#listAuthoredTools` (and `describeAuthoredTool`, so the author page in task 019 gets it too): `{ versionId, version, status, reviewNote, submittedAt, reviewedAt } | null` for the NEWEST version of that Tool's key whatever its status — pending, rejected and withdrawn are the ones the author most needs to see, and a rejection note is the whole point of the field. One batched query over `app_tool_versions` for the whole roster (`key IN (...)`, `DISTINCT ON (key)` by version desc, or fold in memory the way `browseVersions` does), not one per row. `lib/tools/api.ts` re-exports the type already, so the wire side follows for free.

Then render it in `apps/web/features/tools/components/marketplace/MineTab.tsx`: the row currently prints `published v{n}` / `never published` from the note's own `version:` and only knows about a submission made in the same browser session (`Submitted` local state — delete that once the field is real). It should show a status chip (In review / Approved / Rejected / Withdrawn) beside the build chip, and the reviewer's note under the row when there is one. Publish stays admin-gated; a second pending version is still refused by the library. Verify with the same walkthrough this task used: publish a working copy, reload — the pending state must survive the reload — then reject it as a super admin and confirm the note reaches the author.
