---
id: 042
title: The `tools` feature key is never enforced server-side; frame-token duplicates the bridge's authorization
status: done
kind: fix
size: s
wave: 2
depends_on: []
touches: [apps/web/lib/tools/target.ts, apps/web/app/api/tools/frame-token/route.ts, apps/web/tests/tools-bridge.test.ts]
created_by: 040
session: 2bc02cc0-63c6-4955-8ddd-041b17205efc
model: sonnet
effort: high
---

## Task

Two halves of one fix, in the one place that should own the question.

(a) Missing gate. `tools` is a real feature key — it is in ALL_FEATURE_KEYS and NAV_HIDDEN_FEATURE_KEYS, and lib/featureAccess.ts maps the node type `tool -> tools` in NODE_TYPE_FEATURE_KEYS — so an admin can switch Tools off for a space. Nothing server-side honours that: lib/tools/target.ts#resolveBridgeTarget checks membership (resolveContext), and for installs `enabled`, but never asks featureAccessForbidden(userId, spaceId, 'tools', email). The precedent is in the same wave and the same file — lib/tools/bridge.ts#agentsRun gates on featureAccessForbidden(..., 'agents', ...) before claiming a run. Consequence: with Tools disabled for a space, a member can still POST /api/tools/frame-token, get a frame, and drive /api/tools/bridge. This is the same class as the members-can-curl-Channels hole featureAccessForbidden was written to close. Task 028 covers only the SpaceToolsPanel toggle UI, so no other task owns the server side.

(b) Duplicated authorization. app/api/tools/frame-token/route.ts carries its own inline copy of the install lookup + resolveContext + `enabled` check, and its own preview canReadPath check, because lib/tools/target.ts had not landed when task 014 was written. The route already carries a TODO(wave 3) saying exactly this and naming resolveBridgeTarget as the replacement. Two copies of 'may this viewer run this Tool' is how the two answers drift.

Fix: add the featureAccessForbidden(..., 'tools', ...) check to resolveBridgeTarget in lib/tools/target.ts, in BOTH the install and preview branches, after the membership resolve and before the perimeter/config work — returning the existing BridgeError shape with code 'forbidden'. Then rewrite app/api/tools/frame-token/route.ts to call resolveBridgeTarget instead of its inline branches, mapping the returned BridgeError codes to the route's status codes (not_found -> 404, forbidden -> 403, invalid -> 400) and reading install/degraded/viewer off the ResolvedTarget it already computes — note ResolvedTarget.install is a ToolInstallInfo and ResolvedTarget.degraded is a ToolDegraded|null, which is what FrameTokenResponse already wants; `viewer.isAdmin` still has to come from the resolved context, so surface it on ResolvedTarget rather than recomputing it in the route. Delete the TODO block. Keep the route's response shape byte-identical so features/tools/lib/hostBridge.ts#FrameTokenResponse and ToolFrame need no change. Add tests to tests/tools-bridge.test.ts covering a space with `tools` disabled refusing both target kinds, and an admin of that space still being allowed (featureAccessForbidden returns false for admins) — inject the check through BridgeDeps-style seams if resolveBridgeTarget needs one to stay testable without a DB.

## Outcome

Closed both halves of the gap: `resolveBridgeTarget` (lib/tools/target.ts) now enforces the `tools` feature key server-side, and the frame-token route no longer duplicates the install/preview authorization logic.

(a) Added a `forbiddenForTools` check to both `resolveInstall` and `resolvePreview` in target.ts, calling `featureAccessForbidden(userId, spaceId, 'tools', email)` right after `resolveContext` (membership) and before any perimeter/config work — same pattern as `bridge.ts#agentsRun`'s `agents` gate. Admins are exempt automatically because `featureAccessForbidden` itself already bypasses for admins.

(b) To keep this testable without a DB, gave `resolveBridgeTarget` an injectable `TargetDeps` seam (mirroring `BridgeDeps` on the bridge) covering `findInstall`, `findBuild`, `resolveContext`, `principalOf`, `readVisible`, and `featureAccessForbidden`, defaulting to real implementations (`REAL_DEPS`). Also surfaced `isAdmin: boolean` on `ResolvedTarget` (from `resolved.isAdmin`), since the frame-token route needs it for `viewer.isAdmin` and it shouldn't be recomputed there.

Rewrote `app/api/tools/frame-token/route.ts` to call `resolveBridgeTarget` instead of its own inline install/preview branches, mapping `BridgeError` codes to HTTP status (`not_found`→404, `forbidden`→403, else→400) and building the response from the `ResolvedTarget` (`install`, `degraded`, `isAdmin`). Deleted the `TODO(wave 3)` block and the now-dead `degradedFrom`/`stringList` helpers, plus the unused `prisma`/`toolRailKey`/`canReadPath`/`principalOf`/`resolveContext` imports. `FrameTokenResponse` type is untouched, so `hostBridge.ts` and `ToolFrame` need no changes.

Added tests to tests/tools-bridge.test.ts: a space with `tools` disabled refuses both an install target and a preview target (the preview case proves the gate runs before `readVisible`, which is wired as a throw-trap), and an admin of a tools-disabled space is still allowed for both target kinds. Also added the missing `isAdmin` field to the existing `target()` fixture builder (now required by `ResolvedTarget`).

Verified: `pnpm exec tsc --noEmit` clean, `pnpm exec eslint` clean on the three files, all 46 tests in tools-bridge.test.ts pass, and re-ran every `tests/tools-*.test.ts` file (16 files, 280+ tests) to confirm the new `isAdmin` field caused no regressions elsewhere.
