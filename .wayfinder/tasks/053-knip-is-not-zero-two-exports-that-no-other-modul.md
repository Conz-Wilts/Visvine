---
id: 053
title: "knip is not zero: two exports that no other module imports"
status: done
kind: fix
size: xs
wave: 3
depends_on: []
touches: [apps/web/lib/tools/perimeter.ts, apps/web/lib/tools/service.ts]
created_by: 050
session: 2042ae47-cc0d-41f8-ad5e-375b524830dd
model: sonnet
effort: high
---

## Task

The plan's verification section requires `pnpm --filter @visvine/web exec knip` to stay at zero; it currently exits 1 with two entries, both left over from earlier waves and both trivially fixable:

1. `Unused exports: isGlobPatternSafe  function  lib/tools/perimeter.ts:183` — a grep across `apps/web` shows every call site is inside `lib/tools/perimeter.ts` itself (lines 220, 259, 289); the only other mentions are doc comments in `lib/tools/bridge.ts:201` and `tests/tools-perimeter.test.ts:130`, neither of which imports it. Task 045's outcome claims it is "a new exported pure predicate" reached from bridge.ts, but bridge.ts actually calls `isValidGlobEntry`, which is the wrapper that calls it.

2. `Unused exported types: ToolServiceError  type  lib/tools/service.ts:120` — used only within `lib/tools/service.ts` (lines 121, 124, 135).

Fix: drop the `export` keyword on both. Verify the tests that reference `isGlobPatternSafe` only do so in prose (they do — `tests/tools-perimeter.test.ts` exercises it through `globMatch`/`isValidGlobEntry`/`parseToolPerimeter`), then re-run `pnpm --filter @visvine/web exec knip` and confirm exit 0, plus `tsc --noEmit` and `pnpm test`.

## Outcome

Fixed both knip findings by dropping the unnecessary `export` keyword — neither symbol is imported anywhere outside its own file.

- `apps/web/lib/tools/perimeter.ts:183` — `isGlobPatternSafe` changed from `export function` to `function`; confirmed all call sites (lines 220, 259, 289) are within the same file, and the only other mentions (`bridge.ts:201` doc comment, `tests/tools-perimeter.test.ts:130` prose) don't import it.
- `apps/web/lib/tools/service.ts:120` — `ToolServiceError` type changed from `export type` to `type`; used only at lines 121/124/135 in the same file.

Verified: `pnpm exec knip` now exits 0 with no output (was exit 1 with the two entries), `pnpm exec tsc --noEmit` clean, `pnpm test` → 943/943 pass, 0 fail.
