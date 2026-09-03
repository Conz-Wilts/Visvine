# Cleanup, refactor and dead-code prompt

Paste everything below the line into an agent session (or run it as a
`/cleanup` command). It is written for THIS repo: the gates, boundaries and
domain rules it names are the ones in `AGENTS.md`, `eslint.config.mjs`,
`knip.json` and CI. Sources that shaped it are listed at the end.

---

You are doing a **behaviour-preserving cleanup** of the Visvine codebase:
delete dead code, collapse duplication, and move code to where the repo says
it belongs. Nothing a user, an API caller, an MCP client, an agent run or a
seed script can observe may change. If a change would alter behaviour, it is
not cleanup — stop, list it under *Deferred*, and move on.

Read `AGENTS.md` first. It overrides anything below that disagrees with it.

## 0. Ground rules

1. **Verify before you delete, verify after.** A tool saying "unused" is a
   lead, not a verdict. Grep the whole repo (including `scripts/`, `tests/`,
   `prisma/`, `apps/desktop`, `apps/mobile`, `docs/`, `.github/`) before
   removing anything. Then run the gate.
2. **The gate is fixed and runs in this order**, the same order as CI:
   ```
   pnpm typecheck
   pnpm lint                              # --max-warnings=0: a warning fails
   pnpm test                              # node --import tsx --test tests/*.test.ts
   pnpm --filter @visvine/web knip
   ```
   Run all four after every batch. A DB-backed test that *skips* is not a
   pass; if your batch touches `lib/notes`, `lib/agents`, `lib/connectors` or
   Prisma, run with the Docker Postgres up so those tests actually execute.
   Run `pnpm --filter @visvine/web db:notes:verify` if you touched any seed
   layer.
3. **Small batches, one concern per commit.** One knip category, one
   duplicated helper, one module move. Never mix a deletion with a rename with
   a behaviour fix. If the gate fails, revert the batch rather than patching
   around it.
4. **Do not touch these on a cleanup pass**: `schema.prisma` and
   `prisma/migrations/**` (a schema change is a migration, not cleanup),
   `prisma/migrations-archive/**` (kept to read), `apps/web/AGENTS.md`
   (written by `next dev`), `/api/health` (must never grow a dependency),
   `proxy.ts` CSP, `scripts/rotate-secrets-key.ts`, `public/images/brand-icon.png`
   and `app/icon.png` (must stay identical), `.env*`.
5. **Do not widen anything.** No new scope, no wider query over
   `AppToolVersion`, no relaxed Zod schema, no perimeter read from prose, no
   `'unsafe-inline'`. Cleanup only ever removes or moves.
6. **Comments describe the app as it is.** No provenance ("used to", "was
   moved from", "legacy shim added in"), no changelog, no `@deprecated` left
   as a tombstone. If a comment explains something no longer true, fix or
   delete the comment. If code is dead, delete it; do not comment it out.
7. **Ask before touching**: anything under `lib/mcp/**` that a live OAuth
   client depends on (`legacyResourceUrl`, `/api/mcp/creator` 308,
   `/api/oauth/register`); the `registered` key in the events API (mobile
   contract); `lib/mediaUrl.ts` legacy GCS URL handling (prod rows). These are
   *known compat surfaces*; removing one is a product decision, not cleanup.

## 1. Detect

Run these and save the raw output before changing anything:

```
pnpm --filter @visvine/web knip --no-progress
pnpm --filter @visvine/web exec eslint . --max-warnings=0 --format unix
pnpm --filter @visvine/web exec tsc --noEmit --noUnusedLocals --noUnusedParameters
git ls-files | grep -E '\.(bak|old|orig)$|_backup|/tmp/'      # stray artifacts
grep -rniE 'legacy|back-?compat|backwards compat' apps/web --include='*.ts' --include='*.tsx' -l
```

Triage every finding into one of three buckets and write the list down
(scratchpad, not the repo):

| Bucket | What goes here | Action |
|---|---|---|
| **SAFE** | unused files, unused exports with zero grep hits outside their own file, unused deps not referenced by any config | delete |
| **CAREFUL** | exports hit only by tests; anything reached by string/dynamic import, `next.config.ts`, `serverExternalPackages`, `scripts/**`, seeds, `knip.json#entry`; barrel re-exports (`components/ui/index.ts`) | inspect by hand |
| **RISKY** | public API (`app/api/**` handlers, `lib/actions/defs/**` action names and their Zod input, MCP scopes, note frontmatter keys, `metadata.*` keys on nodes), anything mobile or desktop calls, anything a seed layer writes | leave; note under *Deferred* |

False-positive traps specific to this repo:

- **Vocabulary is not rot.** `deprecated` in `lib/notes/shared/lifecycle.ts`,
  `types.ts`, `queryPlan.ts` and `lib/actions/defs/context.ts` is a note
  lifecycle status, not dead code. `TODO` hits are mostly `TODOIST_*` keys in
  `lib/connectors/catalog.ts`.
- **Legacy read paths are load-bearing until their backfill ran in prod**:
  `agents/<name>/activation.md` (until `db:agents:activation`),
  `connectors/<name>.md` with `kind: model` (until `db:models:migrate`),
  `people/<slug>.md` flat aliases (`canonicalEntityPath`). Deleting the read
  before the script has run in production breaks running agents.
- **Actions are registered by name.** Removing an export from
  `lib/actions/defs/*` removes an action from `/api/actions/<name>` and the
  MCP tool. Check `lib/actions/recipes.ts` and the action notes
  (`db:actions:sync`) before assuming an action is unused.
- **Tests read the schema.** `tests/delete-account.test.ts` and
  `tests/connector-catalog.test.ts` enumerate real code; a "test-only" export
  may be the thing that keeps a contract honest. Keep it, and add it to
  `knip.json#entry` or mark it `/** @internal */` rather than deleting.
- **knip entries** in `knip.json` (`features/tools/kit/*`, `lib/tools/protocol.ts`,
  `lib/tools/sdkDocs.ts`) are reached at runtime by the Tool iframe, not by
  imports. Do not remove them because nothing imports them.

## 2. Remove, in this order

1. **Stray artifacts** at repo root and in `apps/web` that are not source and
   not referenced (`git ls-files` output above; `app_backup.local.sql`, loose
   PNG screenshots, `tmp/`). Confirm each is unreferenced; if it is a design
   reference someone may want, ask rather than delete.
2. **Unused files** (knip). Lowest risk. Delete, gate, commit.
3. **Unused dependencies** (knip). Check `next.config.ts`
   (`serverExternalPackages`, `outputFileTracingIncludes`), `scripts/**`,
   `.github/workflows/*` and `apps/desktop` before removing. The QuickJS
   singlefile package is deliberately pinned even though the meta-package
   resolves it; leave it.
4. **Unused exports**, batches of ≤20, riskiest last. If an export is used only
   inside its own file, drop the `export` keyword rather than the symbol.
   Prefer removing a re-export from a barrel over removing the source.
5. **Unused vars / params / imports** flagged by `--noUnusedLocals`. Prefix
   intentionally-unused params with `_` only when the signature is fixed by a
   caller (route handler, callback); otherwise delete the param.
6. **Dead branches**: `if (false)`, unreachable `return`s, feature flags whose
   env var no deployment sets (check `docs/runbook.md` and `deploy.yml` first),
   `catch` blocks that swallow and re-implement the surrounding path.
7. **Legacy compat shims** whose backfill has run everywhere — only those
   confirmed with the owner (rule 0.7).

## 3. Refactor, only where the repo already says how

Refactoring here means **making code match the conventions `AGENTS.md`
already states**, not inventing new ones. Each item is a separate batch.

- **Route handlers are thin.** A handler in `app/api/**` that inlines session
  checks, admin checks, JSON parsing, or try/catch response shaping should
  use `lib/api/route.ts` (`requireApiSession`, `requireSpaceAdmin`,
  `parseBody`, `ApiError`, `handleApiError`) and push domain logic into
  `lib/<domain>/`. Check `instanceof NextResponse` and return it; do not
  re-throw.
- **Shared helpers over re-rolls.** Any local `fetch(...).then(r => r.json())`
  → `lib/fetchJson.ts`; any hand-rolled relative-time or date formatting →
  `lib/date.ts`; any ad-hoc overlay → `components/ui/Modal.tsx`; any
  `console.*` in server code → `lib/logger.ts` (`error` only for a genuine
  fault, always `{ err }`; `warn` for the app working as designed).
- **Boundaries** (enforced by eslint, so violations are already errors — but
  near-misses are not): domain UI lives in `features/<domain>/components`,
  only `components/ui` is shared, `lib/**` imports no React, icons come from
  `features/shared/icons`. If a component in `components/ui` is used by one
  feature only, move it into that feature.
- **One definition per fact.** If two files each compute "is this person an
  admin", "what is this entity's canonical path", "which model does this space
  run on", or "is this connector enabled", one of them is wrong. Keep the one
  `AGENTS.md` names (`lib/auth.ts#isAdmin`, `canonicalEntityPath`,
  `lib/agents/spaceModels.ts`, `isConnectorEnabled`) and route the other
  through it.
- **Pure over impure.** When a function in `lib/**` mixes a Prisma read with
  a decision, split the decision into `lib/<domain>/shared/*` (or the existing
  pure module) so it can be tested with `node:test` without a DB. Do this only
  when a test already exists or you add one in the same batch.
- **Big files** are a smell, not a target. `lib/actions/defs/context.ts`
  (2.2k lines), `lib/notes/store.ts`, `lib/tools/registry.ts`,
  `ConnectorPageContent.tsx`, `ConnectorsPanel.tsx`, `NoteSidebar.tsx` and
  `directory/[nodeId]/page.tsx` are each over 1k lines. Split one only along
  a seam that already exists (a group of actions, a tab, a panel), keep the
  public exports identical, and do it as its own commit. Do not split for
  line count alone.
- **Naming.** Match the file's neighbours. Types and components
  `UpperCamelCase`, functions and values `lowerCamelCase`, module-level
  constants `CONSTANT_CASE`. Tables are named for the tool that owns them
  (`context_*`, `connector_*`, `event_*`). The notes surface is **Context**
  everywhere; do not reintroduce "brain", "notes app" or another word for it.
  `const` by default, never `var`, one declaration per statement.
- **Comments and docs.** After every batch, fix any comment, `docs/*.md` or
  `AGENTS.md` sentence that now names a file, function or flag that no longer
  exists. `prisma/TABLES.md` must still describe every table.

## 4. What NOT to do

- Do not run `eslint --fix` or `knip --fix` across the tree. Apply fixes per
  batch so each diff is reviewable.
- Do not re-enable the disabled `react-hooks/*` rules in `eslint.config.mjs`
  as part of cleanup. They fire on ~175 pre-existing sites; turning one on is
  its own project with its own commit series.
- Do not add `noUnusedLocals` / `noUncheckedIndexedAccess` to `tsconfig`
  unless the tree is already clean under it. Use the flag to *find* work, not
  to ship red.
- Do not rename for taste. A rename is justified only when the old name is
  wrong about what the thing does now.
- Do not "modernise" working code (class → hooks, callback → async, `for` →
  `reduce`) with no defect behind it.
- Do not add abstractions to remove two similar lines. Three concrete uses
  before one helper.
- Do not delete a test because the code it covered moved; move the test.
- Do not touch `apps/mobile` or `apps/desktop` contracts (`Authorization:
  Bearer`, event payload keys, preload bridge events) from the web side.

## 5. Commit and report

Commit straight to `main` (no feature branches in this repo). Conventional
Commits, lowercase, declarative sentence describing the end state:

```
refactor(api): every route under /api/communities goes through lib/api/route
refactor: the connectors catalogue is one file again
chore: unused exports under lib/notes are gone
```

Body: what was removed and *why it was safe* (which check proved it), in
two or three lines. End with the co-author trailer the session provides.

When you stop, report in this shape:

```
## Removed
- <path or symbol> — <proof it was dead>
## Consolidated
- <what> → <where it now lives>
## Deferred (needs a decision)
- <thing> — <why it looks dead, what would break, who decides>
## Gate
typecheck ✓  lint ✓  test ✓ (N run, M skipped — DB up? yes/no)  knip ✓
```

If the gate is not green, say so first and say what is red. Never report
"done" with a skipped step.

---

## Sources

Repo: `AGENTS.md`, `apps/web/eslint.config.mjs`, `apps/web/knip.json`,
`packages/config/tsconfig/base.json`, `.github/workflows/ci.yml`.

External guidance the rules above were checked against:

- [Effective TypeScript — use knip](https://effectivetypescript.com/2023/07/29/knip/)
- [Deleting dead code in TypeScript (barrel-file false positives)](https://camchenry.com/blog/deleting-dead-code-in-typescript)
- [Knip + AI agent workflow: verify by grep, test-only → @internal, batches of 20](https://www.56kode.com/posts/clean-typescript-project-knip-ai-workflow/)
- [ECC refactor-cleaner agent: SAFE / CAREFUL / RISKY triage](https://github.com/affaan-m/ECC/blob/main/agents/refactor-cleaner.md)
- [Kiro — program analysis makes agent refactoring safe](https://kiro.dev/blog/refactoring-made-right/)
- [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html)
- [Next.js 16 App Router project structure](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure)
- [Dead code identification and removal, 2026](https://pensero.ai/blog/dead-code)
