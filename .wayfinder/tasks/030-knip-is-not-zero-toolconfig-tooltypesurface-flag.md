---
id: 030
title: "knip is not zero: ToolConfig / ToolTypeSurface flagged as unused exports"
status: done
kind: fix
size: xs
wave: 1
depends_on: []
touches: [apps/web/tests/tools-config.test.ts]
created_by: 029
session: d8e925c5-e72f-4bc5-b538-c5d8f6f12f46
model: sonnet
effort: high
---

## Task

`pnpm --filter @visvine/web exec knip` exits 1 with:

    Unused exported types (2)
    ToolTypeSurface  interface  lib/tools/config.ts:200:18
    ToolConfig       interface  lib/tools/config.ts:205:18

Both interfaces are used inside lib/tools/config.ts itself (ToolConfig in ParseToolConfigResult, ToolTypeSurface in surfaces.types and parseTypeSurfaces) but are imported nowhere outside the module, and tests/tools-config.test.ts imports only the functions, so knip sees the exports as dead. The plan's verification list and CLAUDE.md both require knip to stay at zero, and task 027 (final audit) gates on it.

Fix: make the two types actually referenced from outside the module rather than silencing knip. The cheapest honest fix is to have tests/tools-config.test.ts import them and use them in an annotation — e.g. `import { parseToolConfig, type ToolConfig, type ToolTypeSurface } from '../lib/tools/config'` and annotate the parsed config / an expected surfaces.types literal in the existing happy-path and surfaces tests. Do NOT add lib/tools/config.ts to knip.json's entry list — wave 2 imports ToolConfig for real and the entry escape hatch would then hide genuinely dead exports there forever. Verify with `pnpm exec knip --no-progress` exiting 0 and `node --import tsx --test tests/tools-config.test.ts` still passing.

## Outcome

Fixed the knip "unused exported types" flag on ToolTypeSurface/ToolConfig by making tests/tools-config.test.ts actually reference them from outside lib/tools/config.ts, rather than adding an entry-list escape hatch.

Imported `type ToolConfig, type ToolTypeSurface` in tests/tools-config.test.ts alongside the existing function imports. In the "parseToolConfig reads a well-formed tool note" test, annotated the destructured result as `const config: ToolConfig = r.config` and typed the expected surfaces array as `const expectedTypes: ToolTypeSurface[] = [...]`, then used both in the existing assertions. No changes to knip.json or lib/tools/config.ts.

Verified: `pnpm exec knip --no-progress` exits 0 (previously reported the two unused exports). `node --import tsx --test tests/tools-config.test.ts` — all 23 tests pass.
