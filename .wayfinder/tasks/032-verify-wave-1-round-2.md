---
id: 032
title: Verify wave 1 (round 2)
status: done
kind: verify
size: null
wave: 1
depends_on: []
touches: []
created_by: null
session: c94daebe-4ba2-4277-8d54-65d6a5c0feb4
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 1.

## Outcome

FAIL: Wave 1 round 2. All gate commands are green and both round-1 fixes hold; two real defects found by probing the code (not by the gates), so back for one more pass.

COMMANDS (all from a clean run just now)
- `pnpm --filter @visvine/web exec tsc --noEmit` — exit 0, zero errors. (Round 1's 3 errors in features/tools/kit/runtime.ts and lib/tools/compile.ts are gone.)
- `pnpm test` — 718 pass / 0 fail / 33 suites.
- `pnpm lint` (`eslint . --max-warnings=0`) — exit 0, zero problems.
- `pnpm --filter @visvine/web exec knip --no-progress` — exit 0. Task 030's fix (referencing ToolConfig/ToolTypeSurface from tests rather than an entry-list escape hatch) confirmed.
- DB: `prisma migrate status` → "Database schema is up to date!", 4 migrations. `prisma migrate diff --from-config-datasource --to-schema` shows only the two pre-existing pgvector index drops (hand-written SQL that Prisma doesn't model) — so the hand-written 20260818120000_app_tools migration matches schema.prisma exactly, field for field, against the brief's spec.
- `next build` NOT run, deliberately: (a) a dev server (PID 44876) is live on :3000 sharing apps/web/.next in this shared workspace, and (b) nothing under app/ imports lib/tools/* or features/tools/* yet, so a build would neither trace esbuild nor compile the kit — it proves nothing until wave 2 lands the routes. Task 004 already traced esbuild through Next's own @vercel/nft (picks up the platform binary); the real `next build` + standalone grep belongs in wave 6 (task 027), which asks for it.

ROUND-1 FIXES VERIFIED
- 030: knip exits 0; knip.json untouched except task 009's four documented entry points.
- 031: `isToolIndexPath`/`toolNameOfEntityPath` are gone from lib/notes/entities.ts, replaced by a pointer comment; tests/notes-entities.test.ts now imports toolFileKindOfPath/toolNameOfPath from lib/tools/config.ts and asserts the previously-disagreeing case (`tools/Deal Pipeline/index.md`) is uniformly rejected. Import direction (config.ts → entities.ts) preserved.

DIFF REVIEW — the wave delivers what the plan's "Wave 1 — foundations" line asks for, and each task did what its outcome claims. Spot checks that held up: BUILT_IN_TYPES in config.ts exactly matches DEFAULT_NODE_TYPES, so no built-in page can be claimed with `mode: page` (the brief's non-goal holds), and entityKindOf covers the legacy spellings; perimeter globs can't traverse (`..` is rejected on the author side, and store.ts:99 rejects `..`/`.`/NUL on the request side, so the matcher's lack of `..` handling isn't reachable); frameToken pins `algorithms: ['HS256']` with a distinct `aud`; frameCsp's `default-src 'none'` covers worker-src/frame-src by fallback. I ran adversarial probes against the isolate: flat `__cap_N` names are genuinely deleted, `visvine` and its nested namespaces are frozen, globals are deep-frozen, `omitDefaults` leaves fetch/sql/mcp actually undefined, and capability keys `__proto__.polluted` / `constructor.prototype.polluted` do not poison Object.prototype.

TWO ISSUES FILED (both reproduced, not inferred) — see below.

NITS, not worth an agent:
- lib/connectors/isolate.ts: `delete globalThis.__visvine_deepFreeze` is a no-op. A global function declaration is non-configurable, so the helper stays visible to Tool code (probed: `typeof globalThis.__visvine_deepFreeze === 'function'`). Harmless — it only freezes isolate-side objects — but the line doesn't do what it says. Same for the global `const __visvine_root`, still reachable by name.
- tests/connector-isolate.test.ts "the visvine namespace itself is frozen" can't fail: it asserts `typeof visvine.read === 'function'`, which is true whether or not the assignment took, and then proves the real point in a *second, fresh* isolate that never attempted the mutation. The guarantee does hold (I verified `Object.isFrozen(visvine)` and that `visvine.context = null` doesn't take) — the test just doesn't test it. Wave 4's task 024 is the natural place to fix.
- compile.ts IMPORT_RULE lists four specifiers but EXTERNALS has five: `react-dom` is allowed and unmentioned in every refusal message.
- compileToolData accepts `require('fs')` and `import('fs')` and emits them verbatim. Not an escape (QuickJS has no `require` and no module loader, so both throw at runtime) but the author gets a runtime TypeError instead of the good compile-time message that ESM syntax gets.
- features/shared/lib/features.tsx says the `tools` FeatureDef exists "so the console's Tools panel can switch the surface on and off" — it can't, because SpaceToolsPanel derives rows and picker from `order`, which excludes NAV_HIDDEN keys. Task 006 flagged this and task 028 (wave 3) is queued to fix it; the comment is just ahead of reality.
- `TYPE_SYNONYMS` now folds `tools` → `tool`, and `tool`/`tools` became RESERVED + structural. A pre-existing space with a custom type named "Tools" would silently become the built-in Tool type and drop out of the directory grid. No such rows in the local DB (checked both `nodes.type` and `spaces.node_types`); prod is unverified and the probability is low, so I'm noting it rather than filing it.
