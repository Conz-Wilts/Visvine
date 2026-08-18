---
id: 056
title: Verify wave 4
status: done
kind: verify
size: null
wave: 4
depends_on: []
touches: []
created_by: null
session: 3c3e09dd-4d5b-4ff8-9e92-95aa19dd3683
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 4.

## Outcome

PASS: All gates clean and the wave's own live run passes.

**Commands** (apps/web): `tsc --noEmit` → 0 errors. `eslint . --max-warnings=0` → clean. `node --import tsx --test tests/*.test.ts` → **964 pass / 0 fail** (33 suites), including the 19 new `tools-type-pages.test.ts` cases. `knip --no-progress` → 0. `pnpm build` (full Next production build) → exit 0.

**Live e2e** — ran `scripts/verify-tools-e2e.ts` myself against the running dev server (`CLOUD_SQL_CONNECTION_NAME= pnpm exec tsx scripts/verify-tools-e2e.ts`): **21 passed, 0 failed**, exit 0, and it started from a clean slate (task 023's own runs plus mine = idempotent). It really does drive create_tool → located compile diagnostic → compile → check_tool → publish (+ the member-publish 403) → super-admin approve → install (rail key + space DTO) → three real HTTP GETs (frame doc with sandbox CSP/import map, the Tool's own bundle with its marker, vendor React ESM) → bridge context.list/perimeter refusal/write-as-viewer/data.call in the isolate/state round-trip → v2 approve with perimeter diff → upgrade → uninstall → cleanup verified empty. The space's `feature_config`, notes, registry rows and `tool:hello` node were all back as found.

**Diff review against the plan** — read every changed file:
- **022**: `lib/tools/typePages.ts` is genuinely pure and composes `DEFAULT_NODE_TYPES` + `entityKindOf` synonyms + `isReservedTypeName` rather than copying them; built-ins-win is re-checked on READ (`resolveTypePage` downgrades a stored `page` claim on a built-in to `tab`), which is the brief's hard rule. Note route mounts the Tool as the first tab with `tree-only` chrome (no editor underneath); `NodeRoute` inserts `tool:<slug>` tabs after the first tab via `useEntityChrome`, so NodePage/ResourceNodePage/ContextOnlyPage/Person all get it. Confirmed the claim that a Tool tab has no `?tab=` value: `useProfileTabParam` only ever returns `'context' | 'raw'`, and `setTabParam` deletes the param for anything else — so no link can put a Tool on a built-in page and a reload lands on the built-in first tab. TypesPanel's picker patches release-before-claim, and `setTypeClaims` merges (`{...parseTypeClaims(existing), ...claims}`) so a losing install keeps its other type claims.
- **046**: `latestPublications` is one batched `findMany` for the whole roster (no N+1); MineTab's session-only "Submitted" state is gone.
- **047**: fix is confined to ToolFrame's display logic — skeleton drops on iframe `load`, timeout became an additive strip instead of replacing the frame; hostBridge/frameDocument untouched, and their 27+11 tests still pass unmodified.
- **048**: `AuthoredToolView` moved to api.ts, dead `AuthoredToolResponse` deleted, and the three `spaceFacts` readings really are one exported function now with a private `spaceFactsForActor` wrapper preserving the acting-admin principal for install/upgrade/recheck.
- **049**: the `lastWantedTab` ref pattern is applied identically in all three shells, compared against the URL value (not `activeTab`), matching task 019.
- Out-of-scope edits (`tsconfig.json` / `eslint.config.mjs` / `knip.json` excluding `scripts/fixtures/**`) are justified — `ui.broken.tsx` is a deliberate syntax error and `ui.tsx` imports `@visvine/tool-kit`, which only resolves through the frame's import map. The `//` comments now in tsconfig.json and knip.json are parsed fine by tsc, next build, eslint and knip (all four ran clean above).
- Task 024 (adversarial escape suite) is in wave 5, so it is correctly not part of this wave.

**Nits, none worth an agent:**
1. `installs.ts#spaceFacts` now gets agent names via `listAgents`, which runs `summarise()` per agent (extra per-agent reads) where it previously did a plain vault walk. Same names, but slightly more work on install/upgrade/recheck — admin-only paths, so immaterial.
2. `PublishModal.onPublished` still declares `(version, status)`; MineTab's only consumer now ignores `status`.
3. TypesPanel's two-claimant `Select` is controlled on `claimants[0].id` with no local state, so it visually snaps back until the space DTO refreshes — an impossible-by-construction state anyway.
4. In a space that has any page claim, a cold note view holds `tree-only` chrome until `contextKeys.list` resolves. Documented and deliberate; spaces with no page claim take the old path exactly.
5. Pre-existing and app-wide, flagged by 022 and outside this wave: the global CSP `style-src 'self' 'unsafe-inline'` blocks `fonts.googleapis.com`, so the brand font "Open Sauce One" never loads anywhere in the app. Worth an owner in wave 6's audit.

One operational note for the human: I ran a full `pnpm build`, which rewrites `.next` under the dev server that was running on :3000. It still answered 200 afterwards and the e2e HTTP checks passed against it, but a restart is cheap insurance before the next live run.
