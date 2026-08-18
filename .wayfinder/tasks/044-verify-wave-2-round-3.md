---
id: 044
title: Verify wave 2 (round 3)
status: done
kind: verify
size: null
wave: 2
depends_on: []
touches: []
created_by: null
session: b6eff46f-4e4d-4d84-9a16-517994137099
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 2.

## Outcome

FAIL: FAIL — one concrete defect, everything else green.

**Commands** (apps/web, all re-run from scratch): `tsc --noEmit` clean · `eslint . --max-warnings=0` clean · `pnpm test` **887 pass / 0 fail** (33 suites) · `pnpm build` exit 0 including the `tsx scripts/build-tool-vendor.ts` prestep · `knip` reports the same 10 entries as rounds 1 and 2, all of them task 010's `lib/tools/service.ts` exports awaiting wave-3 consumers (015/016) — unchanged, still task 027's to close. Wave 2 is committed at f6af4ec and the tree is otherwise clean.

**Round-1 and round-2 findings re-checked and still closed.** `STATE_MAX_KEYS` refusal path, the `tools` feature key in `resolveBridgeTarget` (both arms, before `readVisible`), and the frame-token route's single door through `resolveBridgeTarget` are all as 043 described.

**The new defect: the glob compiler backtracks catastrophically, and wave 2 is where an attacker can reach it.** `lib/tools/perimeter.ts#globRegExp` turns each middle `**` segment into `(?:[^/]+/)*`; adjacent groups of that shape are textbook exponential backtracking. Measured against the real module (probe, apps/web cwd, path `'a/'×24 + 'index.md'`): `**/`×8 → 697 ms, `**/`×10 → 9.3 s, and `refuseRead` with `**/`×14 in the perimeter → **141 seconds** of blocked event loop. Node is single-threaded, so one call freezes the whole web process for every user. Two reachable doors, both opened by wave-2 code: (1) `bridge.ts#contextList` takes the caller's `glob` as a bare `z.string().max(512)` and feeds it straight to `globMatch` for every visible path — no grammar check at all, so any member who can resolve a target can hang the server with one bridge call; (2) `parseToolPerimeter` accepts `**/**/**/…` as a declared read glob (it passes `GLOB_ENTRY_RE`), and `target.ts#resolvePreview` parses the *live* note, so authoring a Tool in your own space and previewing it is enough — no publish, no review. Filed as one issue.

**Nits, no task needed.** (1) `installs.ts#setTypeClaims` merges the admin's `claims` keys into `requestedClaims` un-lowercased, while `ToolTypeSurface.type` is lower-cased at parse — a `{ Deal: 'page' }` override passes the declared-types check (which lowercases) and then silently no-ops. The `TypeClaims` doc comment says "keyed by lower-case type name", so it is a contract wave-3 routes must honour rather than a bug, but one `.toLowerCase()` in `requestedClaims` would make it unbreakable. (2) `globCache` in perimeter.ts is unbounded and keyed by caller-supplied patterns once (1) above is reachable — worth bounding in the same fix. (3) All of round 2's nits stand unchanged (the `state.set` new-key race answering `internal`, `browseVersions` restarting at page one on a vanished cursor, `service.ts`'s comments leaning on `writeGated`'s `'edit'` default, `createTool` leaving a node behind if a starter write is denied, `bridgeRateKey(userId, null)` bucketing all previews together, `contextList` loading the whole `visibleVault` per call).
