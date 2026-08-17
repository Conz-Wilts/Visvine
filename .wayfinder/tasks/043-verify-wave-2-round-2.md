---
id: 043
title: Verify wave 2 (round 2)
status: done
kind: verify
size: null
wave: 2
depends_on: []
touches: []
created_by: null
session: 3288e469-2e25-487a-96e2-5562a3f8f3c5
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 2.

## Outcome

PASS: PASS.

**Commands** (apps/web): `tsc --noEmit` clean · `eslint . --max-warnings=0` clean · `pnpm test` **887 pass / 0 fail** (33 suites, up from 880 — the 7 new tests are the two fixes) · `pnpm build` exit 0 (including the `tsx scripts/build-tool-vendor.ts` prestep) · `knip` reports the same 10 entries as round 1, all of them task 010's `lib/tools/service.ts` exports whose consumers are wave-3 tasks 015/016 — unchanged, not a regression, still task 027's to close.

**The two round-1 defects are closed, and the fixes are real rather than claimed.**

*041 (unbounded `app_tool_state`)* — `lib/tools/state.ts` now exports a shared `STATE_MAX_KEYS = 100` and the install path tries `updateMany` first, so an existing key is always overwritable, and only a genuinely new row runs the `count` and refuses with `key_limit`. Clearing still deletes unconditionally, so a Tool at the cap can always free a slot. `bridge.ts#stateSet` branches on the reason and returns a `too_large`-coded message naming the 100-key limit. Tests 32–34 in `tests/tools-bridge.test.ts` cover all three cases.

*042 (`tools` feature key never enforced; duplicated authorization)* — `resolveBridgeTarget` gained `forbiddenForTools`, called in both `resolveInstall` and `resolvePreview` immediately after `resolveContext` and before any perimeter/config/`readVisible` work, matching `bridge.ts#agentsRun`'s `agents` gate; admins are exempt via `featureAccessForbidden`'s own bypass. `/api/tools/frame-token` now calls `resolveBridgeTarget` and maps `BridgeError` → status, with the inline install/preview branches, the `TODO(wave 3)` and the dead `degradedFrom`/`stringList` helpers deleted — one door, not two. `ResolvedTarget.isAdmin` carries the viewer flag the route needs rather than recomputing it. Tests 43–46 cover the refusal for both target kinds (the preview case wires `readVisible` as a throw-trap, so it proves the ordering) and the admin exemption for both.

**Fresh review of the wave-2 diff, beyond re-checking round 1's findings.** Read `bridge.ts`, `target.ts`, `dataRun.ts`, `limits.ts`, `state.ts`, `runtimeBundle.ts`, `installs.ts`, `registry.ts`, `ToolFrame.tsx` and the four routes in full. Nothing new worth an agent. Spot-checks that held: bundle ids are `v_<uuid>`/`b_<uuid>`, so the `[id]` segment is single-path-safe and the token→id derivation is the only lookup; `publishTool`'s `principalIsSuperAdmin` is the notes-layer *space*-admin predicate (`p.system || p.spaceAdmin`), so space admins really can publish and the error string is accurate, while `reviewVersion` uses the env-driven `isSuperAdmin` — the two gates are correctly different; every install mutation loads through `loadInstall(spaceId, installId)` before an id-only `update`, so nothing escapes its space; `orderWithRail` materialises an absent `order` before appending, so installing never moves the space's front door; type names are lower-cased in `parseTypeSurfaces` at parse time, so `requestedClaims`' un-lowercased lookup against `resolveTypeClaims`' lower-cased keys cannot actually miss; `ToolFrame`'s `ResizeObserver` measures the slot's *top*, which no height it sets can move.

**Nits, no task needed.** (1) The 041 fix traded `upsert` for `updateMany`→`count`→`create`, so two concurrent `state.set` calls for the same *brand-new* key can both pass the count and one `create` will hit the `app_tool_state_identity` unique constraint — `handleBridgeCall` catches it and answers `internal` instead of writing. Narrow (same install, same new key, genuinely concurrent), no data loss, a retry succeeds; an `upsert` in place of the `create` would close it if wave 3 touches the file. (2) `browseVersions` restarts at page one when a cursor key has vanished from the fold (`findIndex` → -1 → 0) rather than ending the page. (3) Round 1's nits stand unchanged: `service.ts`'s comments lean on `writeGated`'s `'edit'` default rather than passing it, `createTool` can leave a node + index behind if a starter-source write is denied, `bridgeRateKey(userId, null)` buckets all of a viewer's previews together, and `contextList` loads the whole `visibleVault` per call.
