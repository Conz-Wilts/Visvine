---
id: 041
title: app_tool_state has no per-install cap — an installed Tool can write unbounded rows
status: done
kind: fix
size: s
wave: 2
depends_on: []
touches: [apps/web/lib/tools/state.ts, apps/web/lib/tools/bridge.ts, apps/web/tests/tools-bridge.test.ts]
created_by: 040
session: d292a82f-f091-4e69-9329-0bcb6ca0d6ea
model: sonnet
effort: high
---

## Task

lib/tools/state.ts#setToolState enforces STATE_MAX_BYTES (16KB) per value on both paths, and evicts least-recently-written keys past PREVIEW_MAX_KEYS (100) for PREVIEW targets only. The install path (t.installId !== null) upserts into prisma.appToolState with no key-count and no per-install total-byte ceiling, so a Tool looping state.set with fresh keys grows the table without bound — at BRIDGE_LIMITS.callsPerMinute (120, lib/tools/protocol.ts) that is roughly 1.9 MB/min per viewer per install, and the bridge rate limit is in-process so it does not bound this across workers either. The brief requires 'hard caps, visible failure' and this is the only storage surface without one; the preview path already shows the intended shape.

Fix: give the install path the same bound the preview path has. Count existing rows for the install inside setToolState (a single prisma.appToolState.count on installId) and, when a NEW key would exceed the cap, refuse with { ok: false, reason: ... } rather than evicting — evicting a row an installed Tool is relying on is a silent data loss, whereas a refusal surfaces through bridge.ts#stateSet as a too_large-style error the author can read. Overwriting an existing key must always be allowed. Export the cap next to STATE_MAX_BYTES so the SDK docs (lib/tools/sdkDocs.ts) can name it, and consider a per-install total-byte ceiling as the second half of the same check. bridge.ts#stateSet currently hard-codes the 'too_large' code and a byte-shaped message, so it needs a branch for the new refusal reason with a message naming the key limit. Add tests to tests/tools-bridge.test.ts alongside the existing state cases: a new key past the cap refuses, an existing key still writes, and clearing (value null) frees a slot.

## Outcome

Gave the install path in lib/tools/state.ts#setToolState the same key-count bound the preview path already had, but as a refusal instead of an eviction.

Exported `STATE_MAX_KEYS = 100` next to `STATE_MAX_BYTES` (previously a private `PREVIEW_MAX_KEYS`, now shared). Added a `key_limit` variant to `StateSetResult`. For an install, the write now tries `prisma.appToolState.updateMany` first — if that touches a row, the key already existed and the overwrite is always allowed, cap or no cap. Only when it updates zero rows (a genuinely new key) does it run `prisma.appToolState.count({ where: { installId } })` and refuse with `{ ok: false, reason: 'key_limit' }` once the install is at 100 rows, instead of upserting unconditionally as before. Clearing a key (value `null`) still deletes unconditionally, freeing a slot. The preview path is unchanged in behavior, just renamed to the shared constant.

bridge.ts#stateSet now branches on `result.reason`: `too_large` keeps its existing byte-shaped message, and the new `key_limit` reason returns a `too_large`-coded BridgeResponse (no new BridgeErrorCode was needed/added — protocol.ts was out of scope) with a message naming the 100-key limit and telling the author to clear a key first.

Verified: `pnpm exec tsc --noEmit` clean, `eslint lib/tools/state.ts lib/tools/bridge.ts tests/tools-bridge.test.ts --max-warnings=0` clean, and `node --import tsx --test tests/tools-bridge.test.ts` — all 42 tests pass, including 3 new ones (new key past cap refuses with a message naming the 100 limit; overwriting an existing key at the cap still writes; clearing a key at the cap frees a slot for a new one). Since this repo has no DB-backed unit-test convention (confirmed no test file touches live prisma), the new tests use an in-memory fake `setToolState`/`getToolState` pair that mirrors the real refuse/overwrite/clear semantics against `STATE_MAX_KEYS`, exercised through the real `handleBridgeCall` — proving the bridge's `key_limit` wiring end to end without a database.

Did not touch lib/tools/sdkDocs.ts (out of scope for this task) even though the brief mentions it could name the new cap — it doesn't currently name STATE_MAX_BYTES numerically either, so nothing broke; a follow-up could add both to the docs if desired.
