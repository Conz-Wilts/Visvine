---
id: 007
title: Isolate accepts extra host capabilities (for Tool data.js)
status: done
kind: build
size: s
wave: 1
depends_on: []
touches: [apps/web/lib/connectors/isolate.ts, apps/web/tests/connector-isolate.test.ts]
created_by: 002
session: 8fa927af-918c-4336-9770-0e7864b0616d
model: sonnet
effort: high
---

## Task

Extend `runInIsolate(perimeter, code, options)` in apps/web/lib/connectors/isolate.ts so callers can install additional capability functions without touching the connector defaults. Add to `IsolateRunOptions`: `capabilities?: Record<string, (args: unknown[]) => Promise<unknown>>` (installed as globals under a single frozen namespace object `visvine` — e.g. `{ 'context.read': fn }` becomes `visvine.context.read(...)`; dotted keys build nested objects; every fn is async and goes through the same `installCapability` pending-work driver so awaits resolve, and errors surface as rejected promises inside the isolate with the host error message), `omitDefaults?: ('fetch'|'sql'|'mcp'|'sleep')[]` (Tools' data.js must NOT get raw `fetch`/`sql`/`mcp` — only `sleep`), and `globals?: Record<string, unknown>` (JSON-safe values installed frozen, e.g. `subject`, `install`). Values crossing the boundary must go through the existing `toHandle`/`marshalValue` paths and honour `MARSHAL_LIMITS`. Keep `MAX_CONCURRENT_RUNS`, timeout and redaction behaviour unchanged. Add tests to tests/connector-isolate.test.ts: a custom capability is callable and awaited; a nested dotted name works; omitDefaults removes `fetch` (typeof fetch === 'undefined' inside); host errors reject; globals are frozen. Acceptance: tsc/lint/test clean; existing isolate tests still pass.

## Outcome

Extended `runInIsolate` in apps/web/lib/connectors/isolate.ts with three new IsolateRunOptions: `capabilities`, `omitDefaults`, and `globals`, so Tool data.js runs can get bridge-specific capabilities without touching connector defaults.

Details:
- `capabilities?: Record<string, (args: unknown[]) => Promise<unknown>>` — each fn is installed via the existing `installCapability` pending-work driver (async, awaits resolve, host errors reject as isolate Errors) under a host-chosen throwaway flat global name (`__cap_0`, `__cap_1`, ...), then rehomed into a single frozen `visvine` global built via `Object.create(null)` + bracket assignment (never an object literal, so a key like `__proto__` can't reassign a prototype). Dotted keys (`"context.read"`) build nested frozen objects (`visvine.context.read(...)`). The flat throwaway names are deleted from the global scope afterward so only `visvine` is visible.
- `omitDefaults?: ('fetch'|'sql'|'mcp'|'sleep')[]` — gates the four existing `installCapability` calls (and the `mcp` namespace eval) so Tools' data.js can be run with only `sleep` installed; omitted capabilities are genuinely absent globals (`typeof fetch === 'undefined'`), not stubs.
- `globals?: Record<string, unknown>` — JSON-safe values (e.g. `subject`, `install`) marshalled through the existing `marshalValue`/`MARSHAL_LIMITS` path, installed via `toHandle`, then deep-frozen (Object.freeze alone is shallow; added a small recursive `__visvine_deepFreeze` isolate-side helper, safe since marshalValue's output is cycle-free) so nested mutation is blocked too, matching the "globals are frozen" acceptance criterion.

`MAX_CONCURRENT_RUNS`, timeout, and redaction behavior are untouched — new code only adds installs inside the existing `Scope.withScopeAsync` block.

Verification:
- Added 6 tests to apps/web/tests/connector-isolate.test.ts: custom capability callable+awaited, dotted nested capability, omitDefaults strips fetch/sql/mcp while sleep survives, host error rejection surfaces its message, globals frozen (including nested), visvine namespace itself frozen against reassignment.
- `node --import tsx --test tests/connector-isolate.test.ts` from apps/web: 45/45 pass (39 pre-existing + 6 new).
- `pnpm --filter @visvine/web exec tsc --noEmit`: clean.
- `pnpm --filter @visvine/web exec eslint lib/connectors/isolate.ts tests/connector-isolate.test.ts --max-warnings=0`: clean.
