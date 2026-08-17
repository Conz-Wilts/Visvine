---
id: 040
title: Verify wave 2
status: done
kind: verify
size: null
wave: 2
depends_on: []
touches: []
created_by: null
session: befe6a34-2bfe-41f5-ad64-56dcf7d09ca2
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 2.

## Outcome

FAIL: Commands (apps/web): `tsc --noEmit` clean · `eslint . --max-warnings=0` clean · full suite **880 pass / 0 fail** (33 suites) · `pnpm --filter @visvine/web build` exit 0, including the new `tsx scripts/build-tool-vendor.ts` prestep, which wrote all four vendor modules to `public/tool-runtime/` (react 10036B, react-dom-client 185739B, react-jsx-runtime 1410B, tool-kit 18609B). `knip` reports 10 entries, all of them task 010's `lib/tools/service.ts` exports whose consumers are wave-3 tasks 015/016 — expected, not a regression, but the plan's "knip stays zero" is not currently true and task 027 must close it.

Read the whole wave diff against the plan. The five tasks each did the thing they claim. Spot-checked the load-bearing claims rather than trusting the write-ups: store-hook parity is exact (`toolNote*` sits beside `agentNote*` at all seven sites, and `createIndexFolder` routes through `createNote` so the index write is covered); `canReadPath` really is sync, so the frame-token preview gate is a genuine check and not a truthy Promise; the Dockerfile runs `pnpm --filter @visvine/web build` (the package script, so the vendor prestep does run in the image) and copies `apps/web/public` into the runner, so task 013's prebuilt-artifact fallback holds in production; `esbuild` is in `serverExternalPackages`; `/api/tools/runtime` is in `PUBLIC_PATHS` so the cookie-less frame loads. Perimeter-before-grant ordering, viewer-principal-only auth, the version-not-working-copy rule for installs, the sealed `tools|agents|connectors` write namespaces, `isAdmin` gating plus `spaceId` scoping on every install mutation, and the `updateSpaceConfig` advisory lock around row+featureConfig all check out as described.

Two concrete defects, both in wave-2 files, both small:

1. **`lib/tools/state.ts` caps a preview at 100 keys but caps an install at nothing.** `setToolState` enforces the 16KB per-value limit on both paths, then evicts past `PREVIEW_MAX_KEYS` for previews only; the install path upserts into `app_tool_state` with no key-count or per-install byte ceiling. At `BRIDGE_LIMITS.callsPerMinute` (120) that is ~1.9 MB/min of unbounded row growth per viewer per install. The brief asks for "hard caps, visible failure" and this is the one storage surface without one.

2. **Nothing server-side enforces the `tools` feature key.** `lib/tools/bridge.ts#agentsRun` correctly calls `featureAccessForbidden(..., 'agents', ...)`, but neither `resolveBridgeTarget` nor `/api/tools/frame-token` asks the same question about `'tools'` — which is a real feature key (`ALL_FEATURE_KEYS`, `NAV_HIDDEN_FEATURE_KEYS`, and `NODE_TYPE_FEATURE_KEYS` maps `tool → tools`), so a space that has switched Tools off still has members able to mint frame tokens and drive the bridge. Task 028 covers only the admin toggle UI. Task 014 left a TODO naming exactly this, and it is entangled with the second half: `/api/tools/frame-token` carries its own copy of the membership/readability check because `target.ts` had not landed when 014 started, and two copies of that question is how it stops being one question.

Nits, no task needed: `lib/tools/service.ts` comments say writes are "stamped with the human origin `edit`" but pass no origin — `writeGated`'s default is `'edit'`, so behaviour is right and the comment is merely load-bearing on a default. `createTool` can leave a node + index note behind if one of the two starter-source writes is denied. `bridgeRateKey(userId, null)` puts every one of a viewer's previews in one bucket. `contextList` loads the whole `visibleVault` per call. `hostBridge` posts to `'*'` because an opaque origin matches nothing else — correctly reasoned and correctly documented; the residual leak (a Tool that navigates its own frame then receives later `setSubject` pushes) is data it already had, and wave 5's escape suite is the right place for it.
