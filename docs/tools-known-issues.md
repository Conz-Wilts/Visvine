# Tools — known issues

What is still open on the user-created Tools feature. The feature ships green —
`tsc` 0, `eslint --max-warnings=0` 0, `pnpm test` green, `knip` 0, `next build` 0
— so nothing here is a regression. These are items judged "known, not fixed" at
the time, plus the deployment steps that need a person.

Each is self-contained: the file, what is wrong, why it matters, a suggested fix,
and how to prove it. They are independent — fix any subset in any order.

Ground rules for anyone (or anything) working through these:

- Run all four gates before and after: `pnpm typecheck` · `pnpm lint` ·
  `pnpm test` · `pnpm --filter @visvine/web knip`. All four must stay zero.
- The live suites need a dev server on :3000 with `TOOLS_ORIGIN` set:
  `pnpm --filter @visvine/web verify:tools` and `verify:tools:escape`.
- Do not weaken the perimeter, the sealed namespaces, the `tools` feature-key
  gate, or the origin split to make any of this easier. Those are the feature's
  security boundary and each has tests pinning it.
- Prefer the narrow fix. Every item below was judged "not worth a task" at the
  time precisely because the blast radius of a wide fix exceeded the defect.

---

## P1 — deployment, needs a person (no code change)

These are the only items that stop Tools working in production. Neither is a bug.

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

No YAML edit is needed — `.github/workflows/deploy.yml` passes it in
`--set-env-vars`, and that is all it needs to be. The Content-Security-Policy is
built per request in `proxy.ts` (`lib/security/csp.ts`), because it carries a
nonce, so `frame-src` reads the environment on every response.

**What that means operationally:** the value takes effect on the next revision,
not the next build. Cloud Run resolves env vars when a revision is created, so
after setting the variable make a revision — a push to main, or
`gh workflow run "Deploy to Cloud Run"`.

Until the variable is set, leaving it unset is the safe state — `toolsOrigin()`
returns null and the app degrades to the documented same-origin fallback.

---

## P2 — efficiency

### K5. `context.list` loads the whole visible vault on every call

**File:** `apps/web/lib/tools/bridge.ts` (`deps.visibleVault` in the `context.list`
handler)

Every `context.list` — including a glob matching three notes — materialises the
viewer's entire visible vault, then filters in JS. Correct, and the result is
capped, but the cost is O(vault) per bridge call in a path a Tool can hit
120×/min.

**Fix:** push the glob's static prefix down into the vault query where one exists
(`compileGlob` already computes the literal head for the matcher), so a `deals/**`
list does not read `people/**`. Keep the `refuseRead` filter in JS — the
perimeter must stay the last word.

**Verify:** existing bridge tests pin the returned rows; add one asserting the
prefix is passed through, and confirm `verify:tools:escape` still passes (the
perimeter must not be bypassed by the narrowed read).

---

## P3 — cosmetic

### K6. Uninstall leaves a dead `featureConfig.enabled['tool:<slug>']` key

**File:** `apps/web/lib/tools/installs.ts` (`featureConfigWithoutRail`)

Uninstall strips the rail key from `order`, `more` and `adminOnly` but not from
`enabled`. Behaviourally harmless — reinstall defaults to enabled anyway — but
the config accumulates dead keys over time.

**Why it was left:** `mergeFeatureConfig` cannot express a key deletion by
design, and `apps/web/lib/featureAccess.ts` was outside the task's scope. Fixing
this means giving the merge helper a deletion form, which touches every feature,
not just Tools. Weigh that before starting.

### K11. `deploy.yml` expands to an empty `TOOLS_ORIGIN=` when the variable is unset

**File:** `.github/workflows/deploy.yml`

`--set-env-vars=…,TOOLS_ORIGIN=${{ vars.TOOLS_ORIGIN }}` becomes a trailing
`TOOLS_ORIGIN=` if the repo variable is not set. Current gcloud accepts an empty
value there and `toolsOrigin()` treats it as null (the documented same-origin
fallback), so this is safe today — but it is the one line in the deploy path that
cannot be exercised locally, and a future gcloud could reject it.

**Fix, if you want it belt-and-braces:** build the `--set-env-vars` string in a
step that omits the pair when the variable is empty.

### K12. The pnpm esbuild postinstall notice

Docker's `pnpm install --frozen-lockfile` prints
`Ignored build scripts: esbuild@…` — pnpm 10 skips postinstalls and root
`package.json#pnpm.onlyBuiltDependencies` lists only `electron`. esbuild works
without its postinstall (verified: `transform` and `build` both run, and the
standalone trace carries the platform binary), so this is noise, not breakage.
Add `"esbuild"` to that list only if you want the log quiet — it is a real
change to what runs at install time, which is why it has not been done by
default.

---

## Accepted limitations — not defects, do not "fix"

Design outcomes recorded deliberately. Leave them alone unless a human asks
otherwise.

- **A Tool note's own page lives at `<dir>/project.md`, not `index.md`** —
  forced by `enforceIndexFrontmatter`; documented rather than worked around.
- **The seeded Portfolio Board (approved, installed) is left in the local dev
  DB on purpose**, so `app_tool_builds` / `_versions` / `_installs` / `_state`
  are never empty and the authoring path stays exercised. It declares
  `write: []` and no agents, so it adds no surface area to the seeded space.
- **A Tool may create an agent brief but never edit one** — create-only is a
  decision, not an oversight. Note that an exempt create also writes
  `agents/index.md` (the folder's children listing); that is documented at
  `SEALED_WRITE_DIRS` and is benign.
- **`hostBridge` posts to `'*'`** — an opaque origin matches nothing else. The
  reasoning is documented at the call site, and the residual case (a Tool that
  navigates its own frame, then receives later `setSubject` pushes) only ever
  hands back data the Tool already had. The escape suite covers it.

---

## Closed

Kept as a short list so nothing here gets re-reported.

| Defect | Where it was |
| --- | --- |
| `state.set` could lose a genuinely concurrent first write to a new key (unique-constraint violation surfaced to the Tool as an opaque `internal`) | `lib/tools/state.ts` — now an `upsert` |
| `browseVersions` restarted at page one on a cursor whose key had left the fold, so a paging client looped forever | `lib/tools/registry.ts` — now `pageByCursor`, which ends the listing instead |
| Every preview a viewer opened shared one `<viewer>:preview` rate bucket, so one chatty draft starved the author's other drafts | `lib/tools/limits.ts` — the bucket is keyed on `targetKey()` |
| `check_tool` gave no signal that an `agents/**` write glob with no declared agents grants nothing | `lib/actions/defs/apps.ts` — now a warning |
| `createTool` could leave a node + index note behind on a denied starter write | `lib/tools/service.ts` |
| `next.config.ts`'s global CSP set `frame-src 'self'` app-wide — the Tool frame never loaded, making the whole separate-origin design unreachable | `next.config.ts` |
| `TOOLS_ORIGIN` set to the app's own origin made the proxy 404 the entire site | `lib/tools/origin.ts` |
| Glob compiler backtracked catastrophically — one bridge call could hang a worker | `lib/tools/perimeter.ts` |
| `refuseRead`/`refuseWrite` let a `..` traversal path match a glob (`deals/../people/**`) | `lib/tools/perimeter.ts` |
| `compileToolUi` passed a non-literal dynamic `import()` straight through the import boundary | `lib/tools/compile.ts` |
| The `tools` feature key was never enforced server-side; `frame-token` duplicated the bridge's authorization | bridge, frame token, MCP, rail |
| `app_tool_state` had no per-install key cap — an installed Tool could write unbounded rows | `lib/tools/state.ts` |
| `frame-src` baked at build time would ship as `'self'` in any image built without `TOOLS_ORIGIN` | `.github/workflows/deploy.yml` |
| `applyUpgrade`'s Prisma select was missing `version: true` | `lib/tools/installs.ts` |
