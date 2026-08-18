---
id: 059
title: Verify wave 5
status: done
kind: verify
size: null
wave: 5
depends_on: []
touches: []
created_by: null
session: 066eccef-0919-4b2a-8d62-774a2bae9739
model: opus
effort: high
---

## Task

Run the checks and review the diff for wave 5.

## Outcome

PASS: All gates re-run clean from scratch: tsc --noEmit clean; `eslint . --max-warnings=0` clean; knip zero; `pnpm build` exit 0; `pnpm test` 984/984 pass (matching the claimed +20 from tests/tools-escape.test.ts, which I read — 20 real tests, every dependency a throw-trap so a pass proves the gate refused before contextService/the connector runtime/the scheduler).

Both live scripts re-run independently, not taken on report:
- `CLOUD_SQL_CONNECTION_NAME= pnpm --filter @visvine/web verify:tools:escape` → 29 passed, 0 failed against the running dev server with TOOLS_ORIGIN=http://127.0.0.1:3000; cleanup left 0 fixture notes, 0 registry/build/install rows and no tool:hostile rail key.
- `scripts/seed-wayfinder-tool.ts` → 0 check(s) failed, and genuinely idempotent on my run (0 tasks created / 12 refreshed, nothing republished, nothing re-installed, existing v2 install reused).

I also drove the Wayfinder Tool in headless Chromium myself (scratch Playwright, dev-login as admin@local.dev): the sidebar carries the /t/wayfinder rail row; the rail page renders the project list (User-created Tools · 12 tasks · harness/visvine-tools/project.md) plus the live degraded banner; /directory/note/harness/visvine-tools/project.md renders the plan panel and six wave columns; the task note renders its detail page with Mark done / Run. Every surface loads inside iframe[src^="http://127.0.0.1:3000/api/tools/runtime/frame"] — the separate tools origin, not the app origin.

Diff review: the only source change in the wave is apps/web/next.config.ts, one import plus `frame-src 'self'` → `'self' + toolsOrigin()`. The defect it fixes is real and production-fatal as reported — with a separate TOOLS_ORIGIN the app's own CSP blocked the Tool frame outright. I confirmed the follow-up half too: the fresh build's .next/routes-manifest.json carries `frame-src 'self' http://127.0.0.1:3000`, i.e. the value is baked from build-time env, exactly the Cloud Run hazard already filed as task 058 (wave 6) — which also owns the regression check that is currently absent (nothing in tests/ pins frame-src today). The agents/ SEALED_WRITE_DIRS wall that blocks Run from authoring a brief is filed as 057 (wave 6). Both deviations (project.md instead of index.md, forced by enforceIndexFrontmatter; the sealed brief) are documented in examples/tools/wayfinder/index.md and docs/wayfinder-tool.md rather than papered over, and docs/wayfinder-tool.md matches what I observed.

Nits, not worth an agent: the rail page's project list arrives after a bridge round-trip so it renders header-only for a beat (my first probe raced it); examples/ sits outside every lint/knip/tsconfig glob, which I verified rather than assumed; briefFor() hardcodes model gemini/gemma-4-31b-it, which is the registry's own default, so valid.
