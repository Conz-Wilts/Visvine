# Tools — known issues

Everything the Wayfinder run (2026-08-18, waves 1–6) left open on the user-created
Tools feature. The feature ships green — `tsc` 0, `eslint --max-warnings=0` 0,
`pnpm test` 991/991, `knip` 0, `next build` 0, `verify:tools:escape` 31/31,
`verify:wayfinder-tool` 21/21 — so nothing here is a regression. These are the
items the verify passes recorded as "known, not fixed", plus the deployment steps
that need a person.

Source of record: `.wayfinder/tasks/060-*.md`, `062-*.md`, `027-*.md`, `043-*.md`,
`040-*.md`.

## How to use this document

Each issue is self-contained: the file and line, what is wrong, why it matters, a
suggested fix, and how to prove the fix. They are independent — fix any subset in
any order.

Ground rules for anyone (or anything) working through these:

- Run all four gates from `apps/web` before and after:
  `pnpm --filter @visvine/web exec tsc --noEmit` · `pnpm lint` · `pnpm test` ·
  `pnpm --filter @visvine/web exec knip`. All four must stay zero.
- The two live suites need a dev server on :3000 with `TOOLS_ORIGIN` set:
  `pnpm --filter @visvine/web verify:tools:escape` and `verify:wayfinder-tool`.
- Do not weaken the perimeter, the sealed namespaces, the `tools` feature-key
  gate, or the origin split to make any of this easier. Those are the feature's
  security boundary and each has tests pinning it.
- Prefer the narrow fix. Every item below was judged "not worth a task" at the
  time precisely because the blast radius of a wide fix exceeded the defect.

---

## P1 — deployment, needs a person (no code change)

These are the only items that stop Tools working in production. None is a bug.

### D1. DNS + domain mapping for the tools origin

1. CNAME `tools.visvine.com` to the target `gcloud` prints (usually
   `ghs.googlehosted.com` — follow what gcloud says, it changes).
2. `gcloud run domain-mappings create --service visvine-web --domain tools.visvine.com --region australia-southeast1`
   — the SAME Cloud Run service. There is no second service; the host split
   happens inside the app (`apps/web/lib/tools/origin.ts`).

### D2. Set the `TOOLS_ORIGIN` repository variable

GitHub → Settings → Secrets and variables → Actions → Variables →
`TOOLS_ORIGIN=https://tools.visvine.com`. It is a public hostname, so a variable,
not a secret.

No YAML edit is needed — `.github/workflows/deploy.yml` already passes it as both
`--build-arg` (line 81) and `--set-env-vars` (line 120), and the "Verify
TOOLS_ORIGIN survived the build" step (line 84) fails the deploy if the built
image's `frame-src` does not name it.

**Why both:** Next bakes `headers()` into `.next/routes-manifest.json` at BUILD
time and the standalone server serves from that manifest. An image built without
`TOOLS_ORIGIN` bakes `frame-src 'self'` and no Tool renders behind the very origin
split meant to protect it. Runtime env alone is not enough.

Until the variable is set, leaving it unset is the safe state — `toolsOrigin()`
returns null and the app degrades to the documented same-origin fallback.

### D3. Database migration

Nothing manual. `deploy.yml` runs `prisma migrate deploy` before the image build,
so `20260818120000_app_tools` applies on the next normal deploy.

---

## P2 — correctness, worth fixing

### K1. `state.set` can lose a write on a genuinely concurrent new key

**File:** `apps/web/lib/tools/state.ts:114-118`

`stateSet` does `updateMany` → `count` → `create`. Two concurrent `state.set`
calls for the same *brand-new* key can both see `updated.count === 0`, both pass
the `STATE_MAX_KEYS` check, and the second `create` hits the
`app_tool_state_identity` unique constraint. `handleBridgeCall` catches it and
answers `internal`, so the Tool sees an opaque failure instead of a write.

**Blast radius:** narrow — same install, same key, first-ever write, genuinely
simultaneous. No data loss, and a retry succeeds.

**Fix:** replace the `create` with an `upsert` on the `app_tool_state_identity`
composite, keeping the `count` check before it so the 100-key cap still refuses
the 101st key. The cap check racing is acceptable (worst case one extra row); the
crash is not.

**Verify:** existing state tests stay green; add one asserting that a second
create on an existing identity updates rather than throwing.

### K2. `browseVersions` silently restarts at page one on a stale cursor

**File:** `apps/web/lib/tools/registry.ts:633`

```ts
const start = opts.cursor ? latest.findIndex((row) => row.key === opts.cursor) + 1 : 0
```

If the cursor key has vanished from the fold since the page was served
(withdrawn, rejected, renamed), `findIndex` returns `-1`, `+1` makes it `0`, and
the caller silently gets page one again instead of the end of the list. A client
paging through the marketplace loops forever.

**Fix:** branch on `-1` explicitly and end the page (return empty items with
`cursor: null`) rather than falling back to the start.

**Verify:** unit test in the registry tests — browse with a cursor key that is not
in the result set, assert empty + null cursor, not page one.

### K3. ~~`createTool` can leave a node + index note behind on a denied starter write~~ — FIXED 2026-08-18

**File:** `apps/web/lib/tools/service.ts` (`createTool`)

`createTool` now runs `writeDenialFull` for the index note **and both starter
source paths** before `syncEntityNode` / `createIndexFolder`, so a denial is
known before anything is created and the name stays free for the retry. The
in-loop denial check remains only for a grant revoked mid-call.

### K4. Every preview shares one bridge rate-limit bucket per viewer

**File:** `apps/web/lib/tools/limits.ts:42`

```ts
return `${viewerId}:${installId ?? 'preview'}`
```

Installs are bucketed per install, as the comment intends. Previews are not —
every Tool a viewer previews shares the single `<viewerId>:preview` bucket, so one
chatty draft starves every other draft the same author is working on. The author
sees rate-limit errors from a Tool that made no calls.

**Fix:** carry the preview's tool name (or the resolved target key) into the key:
`${viewerId}:preview:${toolName}`. The call site resolves the target already;
thread the name through rather than widening the signature elsewhere.

**Verify:** limits tests — two different preview targets for the same viewer must
not consume each other's budget.

---

## P3 — efficiency

### K5. `context.list` loads the whole visible vault on every call

**File:** `apps/web/lib/tools/bridge.ts:282`

```ts
const { metas } = await deps.visibleVault(t.principal, t.context)
```

Every `context.list` — including a glob matching three notes — materialises the
viewer's entire visible vault, then filters in JS. Correct, and the result is
capped, but the cost is O(vault) per bridge call in a path a Tool can hit
120×/min.

**Fix:** push the glob's static prefix down into the vault query where one exists
(`compileGlob` already computes the literal head for the matcher), so a `deals/**`
list does not read `people/**`. Keep the `refuseRead` filter in JS — the perimeter
must stay the last word.

**Verify:** existing bridge tests pin the returned rows; add one asserting the
prefix is passed through, and confirm `verify:tools:escape` still passes (the
perimeter must not be bypassed by the narrowed read).

---

## P4 — cosmetic and documentation

### K6. Uninstall leaves a dead `featureConfig.enabled['tool:<slug>']` key

**File:** `apps/web/lib/tools/installs.ts:311-321` (`featureConfigWithoutRail`)

Uninstall strips the rail key from `order`, `more` and `adminOnly` but not from
`enabled`. Behaviourally harmless — reinstall defaults to enabled anyway — but the
config accumulates dead keys over time.

**Why it was left:** `mergeFeatureConfig` cannot express a key deletion by design,
and `apps/web/lib/featureAccess.ts` was outside the task's scope. Fixing this
means giving the merge helper a deletion form, which touches every feature, not
just Tools. Weigh that before starting.

### K7. Writing an agent brief also writes `agents/index.md`

**File:** `apps/web/lib/tools/bridge.ts:179-186, 238` (`SEALED_WRITE_DIRS`,
`agentBriefExemption`)

The create-only agent-brief exemption works as designed, but the note store's
folder-index behaviour means creating `agents/<name>.md` also creates or updates
`agents/index.md` (a `type: Index` children listing) — a second write inside a
sealed namespace that the seal's own comments do not mention.

Benign: the listing can only name briefs the Tool was allowed to create.

**Fix:** documentation only. Say so in the comment block above
`SEALED_WRITE_DIRS` and in the `docs/tools.md` bridge section, so the next reader
does not think the seal has a hole.

### K8. `check_tool` does not warn about an `agents/` write glob with no named agents

**File:** `apps/web/lib/mcp/appTools.ts:396-421` (the `warnings` block)

A Tool can declare `perimeter.write: ['agents/**']` while naming no agents. Since
task 057 narrowed the seal to create-only, the trap is much smaller than it was,
but the author still gets no signal that the glob buys them nothing.

**Fix:** add one more `warnings.push(...)` alongside the empty-perimeter and
page-claim warnings — if any write glob's top segment is `agents` and
`config.perimeter.agents` is empty, say that the only permitted `agents/` write is
creating the brief of a declared agent.

### K9. Root `CLAUDE.md` is gitignored, so its Tools subsection is not committed

**File:** `.gitignore:34`

Tasks 021 and 027 added a "Tools (user-created)" subsection to the root
`CLAUDE.md`. That file is gitignored and untracked, so the subsection exists only
in this working copy and no checkpoint will ever commit it.

Nothing in it is wrong today. Whether `CLAUDE.md` should be tracked at all is a
human decision — decide it, then either `git add -f` the file or accept that the
subsection is local-only.

### K10. The `CLOUD_SQL_CONNECTION_NAME` gotcha in the docs is bash-only

**File:** `docs/tools.md:582-584`

The doc says to prefix a local run with `CLOUD_SQL_CONNECTION_NAME= ` to point the
verify scripts at Docker. That is bash syntax. In PowerShell `$env:X = ''`
*deletes* the variable and the local-DB guard refuses, so a Windows developer
following the doc literally gets a confusing refusal.

**Fix:** add the PowerShell form next to it (`$env:CLOUD_SQL_CONNECTION_NAME =
$null; pnpm …`, or `Remove-Item Env:\CLOUD_SQL_CONNECTION_NAME`), which is what
actually works on the machine this was developed on.

### K11. `deploy.yml` expands to an empty `TOOLS_ORIGIN=` when the variable is unset

**File:** `.github/workflows/deploy.yml:120`

`--set-env-vars=…,TOOLS_ORIGIN=${{ vars.TOOLS_ORIGIN }}` becomes a trailing
`TOOLS_ORIGIN=` if the repo variable is not set. Current gcloud accepts an empty
value there and `toolsOrigin()` treats it as null (the documented same-origin
fallback), so this is safe today — but it is the one line in the deploy path that
cannot be exercised locally, and a future gcloud could reject it.

**Fix, if you want it belt-and-braces:** build the `--set-env-vars` string in a
step that omits the pair when the variable is empty.

### K12. Stray build artefacts and the pnpm esbuild postinstall

- `apps/web/.next-verify/` still contains `trace` and `_events.json` from a
  verification build. Gitignored, safe to delete: `rm -rf apps/web/.next-verify`.
- Docker's `pnpm install --frozen-lockfile` prints
  `Ignored build scripts: esbuild@0.28.2` — pnpm 10 skips postinstalls and root
  `package.json#pnpm.onlyBuiltDependencies` (line 60) lists only `electron`.
  esbuild works without its postinstall (verified: `transform` and `build` both
  run, and the standalone trace carries the platform binary), so this is noise,
  not breakage. Add `"esbuild"` to that list only if you want the log quiet.

---

## Accepted limitations — not defects, do not "fix"

These are design outcomes the run recorded deliberately. Leave them alone unless a
human asks otherwise.

- **The Wayfinder Tool's Run dispatches an agent that edits notes, not code.**
  That is the acceptance test's scope, stated in `docs/wayfinder-tool.md`.
- **`harness/<project>/project.md`, not `index.md`** — forced by
  `enforceIndexFrontmatter`; documented rather than worked around.
- **The seeded Wayfinder install is genuinely degraded** — the space has no
  `wayfinder-*` agent, so the degraded-mode path is exercised live rather than
  hypothetically. That is a feature of the test, not a failure.
- **The seeded Tool (v2, approved, installed), the `wayfinder-project` /
  `wayfinder-task` node types and the `harness/visvine-tools/` board are left in
  the local dev DB on purpose.**
- **A Tool may create an agent brief but never edit one** — create-only is the
  decision recorded in task 057, not an oversight.
- **`hostBridge` posts to `'*'`** — an opaque origin matches nothing else. The
  reasoning is documented at the call site, and the residual case (a Tool that
  navigates its own frame, then receives later `setSubject` pushes) only ever
  hands back data the Tool already had. Wave 5's escape suite covers it.

---

## Fixed during the run — context, not work

Listed so nobody re-reports them. Each was found by a verify pass, filed as its
own task, fixed and re-verified.

| Defect | Fixed by |
| --- | --- |
| `next.config.ts`'s global CSP set `frame-src 'self'` app-wide — the Tool frame never loaded, making the whole separate-origin design unreachable | 036, 024 |
| `TOOLS_ORIGIN` set to the app's own origin made the proxy 404 the entire site | 034 |
| Glob compiler backtracked catastrophically — one bridge call or one previewed Tool could hang a worker | 045 |
| `refuseRead`/`refuseWrite` let a `..` traversal path match a glob (`deals/../people/**`) | 037 |
| `compileToolUi` passed a non-literal dynamic `import()` straight through the import boundary | 033 |
| The `tools` feature key was never enforced server-side; `frame-token` duplicated the bridge's authorization | 042, 051, 052 |
| `app_tool_state` had no per-install key cap — an installed Tool could write unbounded rows | 041 |
| `verify-wayfinder-tool.ts` accepted a `SEALED` verdict, so a regression of the brief-write path would have passed silently | 061 |
| `frame-src` baked at build time would ship as `'self'` in any image built without `TOOLS_ORIGIN` | 058 |
| `applyUpgrade`'s Prisma select was missing `version: true` | 039 |
