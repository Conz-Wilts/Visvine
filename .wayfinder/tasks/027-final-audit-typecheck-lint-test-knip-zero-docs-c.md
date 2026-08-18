---
id: 027
title: "Final audit: typecheck/lint/test/knip zero, docs current, loose ends from the waves"
status: done
kind: build
size: m
wave: 6
depends_on: [022, 023, 018, 020, 021, 016]
touches: [docs/tools.md, CLAUDE.md, apps/web/knip.json, apps/web/lib/tools/**, apps/web/features/tools/**, apps/web/lib/mcp/appTools.ts, apps/web/app/api/tools/**]
created_by: 002
session: 557a7d24-060a-46a4-a7c0-ca99ab2c9742
model: opus
effort: xhigh
---

## Task

Close the feature. Run `pnpm --filter @visvine/web exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm --filter @visvine/web exec knip` and fix everything they report inside the Tools code (unused exports, dead helpers, missing entry files in knip.json). Reconcile any TODOs left by earlier tasks (grep `TODO(tools)` / `resolveBridgeTarget` duplication between the frame-token route and the bridge — unify on lib/tools/target.ts). Re-read docs/tools.md and the CLAUDE.md subsection against the final code: MCP tool names + scopes, bridge method list and limits, env vars, verify commands (`verify:tools`, `verify:tools:escape`, `verify:wayfinder-tool`), the ops runbook. Confirm `pnpm --filter @visvine/web build` succeeds on this machine (or, if the known Windows EPERM affects it, state that and confirm `next build` at least compiles the routes) and that esbuild + the QuickJS variant are both in `serverExternalPackages`. Report a crisp checklist of what is verified and what the human must do (DNS + domain mapping + `TOOLS_ORIGIN` in deploy env, run `pnpm db:migrate` in prod via the normal deploy).

## Outcome

All four gates are zero on the final tree (after 026 landed) and the production build succeeds; docs/tools.md and the CLAUDE.md subsection now match the shipped code; both named loose ends turned out to be already closed by earlier waves. One deployment-blocking fact was confirmed empirically and belongs to open task 058.

VERIFIED
- Gates, final run over the complete tree: `tsc --noEmit` 0 · `pnpm lint` (eslint --max-warnings=0) 0 · `pnpm test` 984/984 pass, 33 suites, 0 fail · `knip` 0.
- Build: `pnpm --filter @visvine/web build` (build-tool-vendor + Turbopack `next build`) exits 0 — 195 routes, all 10 Tools routes compiled (bridge, frame-token, registry[+id], review[+id], runtime frame/bundle/vendor, /t/[slug], /tools, /tools/preview/[name]). The "known Windows EPERM" did NOT occur; that note is stale. Because a dev server (026's Playwright run) held `.next`, I built a copy in a gitignored in-repo dir and removed it afterwards — `git status` and `apps/web/node_modules` are clean and untouched.
- `serverExternalPackages` carries both `esbuild` and `@jitl/quickjs-singlefile-cjs-release-sync`, and `output: standalone` really traces them: the standalone tree contains the esbuild package + its platform binary (`@esbuild/win32-x64/esbuild.exe`), the QuickJS singlefile package, and the prebuilt `public/tool-runtime/*.js` vendor ESM.
- Loose ends named in the task: no `TODO(tools)` exists anywhere in the repo. `resolveBridgeTarget` is already unified on `lib/tools/target.ts` — both `/api/tools/bridge` and `/api/tools/frame-token` import it, and frame-token delegates membership, the `tools` key, `enabled` and preview read-access to it rather than re-asking (task 042 closed this). No duplication left to remove.
- Docs checked line-by-line against source, all already correct: 9 MCP tool names and their 3/5/1 scope split, 11 bridge methods, all six BRIDGE_LIMITS numbers, TOOL_BUNDLE_LIMITS, the 10 TOOL_RAIL_ICONS, SEALED_WRITE_DIRS, the 10 BUILT_IN_TYPES, the 4 VENDOR_FILES, frame-token audience + 300s TTL, ToolsHostDecision's three values, TOOLS_ORIGIN in .env.example, and "no admin writeDenial on tools/, frozen for AI origins".

CHANGED
- apps/web/knip.json — dropped the `features/tools/components/CodeDiff.tsx` entry and its stale wave-2/3 comment; ToolReviewPanel imports it now, so the exemption claimed something untrue (task 020 flagged this but was blocked on the lease). knip re-run: still 0.
- docs/tools.md — verification section now names the real script aliases (`verify:tools`, `verify:tools:escape`, `verify:wayfinder-tool`; all three exist in package.json as of 026), states they need a dev server on :3000, adds the `CLOUD_SQL_CONNECTION_NAME=` gotcha, and replaces an over-broad "each cleans up" claim (verify:wayfinder-tool leaves an idempotent seed). Added three things the code has but the doc didn't: `state.set` caps (16 KB / 100 keys, install refuses vs preview evicts), an Audit trail section (publish/review/install/upgrade/uninstall + every bridge write, `action: 'tool'`), and the fact that the `tools` feature key is re-checked server-side at every door.
- CLAUDE.md — corrected "each install adds its own rail key" (only an install declaring `surfaces.rail` does) and noted the key is enforced at every door.

WHAT THE HUMAN MUST DO
1. DNS: CNAME `tools.visvine.com` to the target `gcloud` prints.
2. `gcloud run domain-mappings create --service visvine-web --domain tools.visvine.com --region australia-southeast1` (same service — the host split is in-app).
3. Set `TOOLS_ORIGIN=https://tools.visvine.com` in BOTH the Cloud Run runtime env (`--set-env-vars`, deploy.yml line 87) AND the Docker build. This is not a nicety: I confirmed `frame-src` is baked into `.next/routes-manifest.json` at build time — my build with `TOOLS_ORIGIN=http://127.0.0.1:3000` produced `frame-src 'self' http://127.0.0.1:3000`, and `docker build` (deploy.yml line 74) passes no build args today, so an image built without it bakes `frame-src 'self'` and no Tool would render behind the very origin split meant to protect it. Open task 058 owns that fix; until it lands, leaving TOOLS_ORIGIN unset in prod is the safe state (documented same-origin fallback).
4. `pnpm db:migrate` in prod needs no manual step — deploy.yml line 65 runs `prisma migrate deploy` before the image build, so `20260818120000_app_tools` applies on the next normal deploy.

ALSO WORTH KNOWING (not fixed, deliberately)
- Root `CLAUDE.md` is gitignored (.gitignore line 34) and untracked, so the Tools subsection — task 021's and my correction — lives only in the working copy and will not be committed by the wave checkpoint. Worth deciding whether that file should be tracked.
- Cosmetic: uninstall strips a Tool's rail key from `order`/`more`/`adminOnly` but leaves a dead `featureConfig.enabled['tool:<slug>']` key. Behaviourally harmless (reinstall's default is enabled anyway). Not fixed here because `mergeFeatureConfig` cannot express a key deletion by design and `lib/featureAccess.ts` is outside this task's scope; not worth a follow-up task on its own.
- Wave 6 still has 057 (agents/ write seal vs the Wayfinder Run flow) and 058 open; neither is mine.
