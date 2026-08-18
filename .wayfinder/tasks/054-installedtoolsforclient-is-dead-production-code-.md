---
id: 054
title: `installedToolsForClient` is dead production code whose doc comment now contradicts its replacement
status: done
kind: fix
size: xs
wave: 3
depends_on: []
touches: [apps/web/lib/tools/installs.ts, apps/web/tests/tools-registry.test.ts, apps/web/features/tools/lib/railRows.ts]
created_by: 050
session: 05d669ed-21ce-4ce3-89cd-1b07625f3e42
model: sonnet
effort: high
---

## Task

`apps/web/lib/tools/installs.ts#installedToolsForClient` (line 441) documents itself as "The slice the space DTO carries" and deliberately includes disabled installs ("the console still lists them, and hiding them here would make an admin's switch look like an uninstall").

Task 017 replaced it: `lib/spaces/queries.ts:79` now calls the batched `installedToolsForSpaces`, which filters `enabled: true` — the exact opposite policy. Grepping `apps/web` for `installedToolsForClient` outside its own definition finds only a prose mention in `features/tools/lib/railRows.ts:36` and two lines in `tests/tools-registry.test.ts` (43, 269). knip stays quiet only because tests are inside its `project` glob, so a test is keeping an otherwise-unreachable function alive.

Two things to settle:
1. Delete `installedToolsForClient` and the `tests/tools-registry.test.ts` block that covers it (its behaviour is now covered by `installedToolsForSpaces`), or — if the disabled-included slice is genuinely still wanted — give it a real consumer and reword `installedToolsForSpaces`' comment so the two policies are stated side by side rather than each claiming to be the space DTO's source.
2. The stale claim has already propagated: `features/admin/components/SpaceToolsPanel.tsx` reads `space.installedTools` (enabled-only), so a disabled install has no row in the console's Tools panel — contradicting the "the console still lists them" rationale. Whichever way (1) is resolved, fix that comment too.

Verify with `pnpm --filter @visvine/web exec knip`, `tsc --noEmit` and `pnpm test`.

## Outcome

Deleted the dead `installedToolsForClient` function and fixed the stale doc comments that referenced it. Verified it had zero production consumers (only imported in tests plus a prose mention in railRows.ts) — its "the console still lists them" rationale was already false, since `SpaceToolsPanel.tsx` reads `space.installedTools`, which comes from the enabled-only `installedToolsForSpaces`.

Changes:
- `lib/tools/installs.ts`: removed `installedToolsForClient` entirely; reworded `toClientDto`'s comment (no longer "the single-space read above and the batched one below"); trimmed `installedToolsForSpaces`' comment's now-dangling "unlike the single-space read" clause.
- `tests/tools-registry.test.ts`: dropped the import and the array entry in the "install library exposes the space-side lifecycle" shape test that referenced it.
- `features/tools/lib/railRows.ts`: fixed the doc comment that named `installedToolsForClient` as the source of `label: null` — it's actually `installedToolsForSpaces` (what feeds `toolRailRows`).

Not fixed: `tests/tools-rail.test.ts:68` has the same stale `installedToolsForClient` reference in a comment, but that file is currently leased by another agent (task 052) and the edit was refused. One-line fix still needed there: `installedToolsForClient` → `installedToolsForSpaces`.

Verified: `pnpm --filter @visvine/web exec knip` (clean, no new dead exports), `pnpm --filter @visvine/web exec tsc --noEmit` (clean), and `node --import tsx --test tests/tools-registry.test.ts tests/tools-rail.test.ts` (41/41 pass). Grepped the whole repo to confirm no remaining code references to `installedToolsForClient`.
