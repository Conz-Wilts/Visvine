---
id: 013
title: "Tool runtime routes: frame document, bundle, vendor ESM (React + tool-kit)"
status: todo
kind: build
size: l
wave: 2
depends_on: [004, 008, 009, 005]
touches: [apps/web/app/api/tools/runtime/frame/route.ts, "apps/web/app/api/tools/runtime/bundle/[id]/route.ts", "apps/web/app/api/tools/runtime/vendor/[file]/route.ts", apps/web/lib/tools/vendorBundle.ts, apps/web/lib/tools/frameDocument.ts, apps/web/tests/tools-frame-document.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

Serve everything a sandboxed Tool frame needs, under the tools origin (these paths are public in proxy.ts and authenticate ONLY via the frame token from lib/tools/frameToken.ts).

**lib/tools/vendorBundle.ts**: build once per process (memoised promise) with esbuild: `vendorFile(name: 'react.js'|'react-jsx-runtime.js'|'react-dom-client.js'|'tool-kit.js')` → `{ code, etag }`. `react.js` = `export * from 'react'; export { default } from 'react'` bundled with `define process.env.NODE_ENV='production'`, format esm, minify; `react-dom-client.js` marks `react` external so both share one React instance (import map resolves it); `tool-kit.js` bundles apps/web/features/tools/kit/index.ts + runtime.ts (`export * from './index'; export { bootTool } from './runtime'`) with `react`, `react/jsx-runtime`, `react-dom/client` external. Resolve entry paths with `require.resolve`/`import.meta` relative to apps/web so it works in `next dev` and the standalone build (test that assumption; if standalone tracing misses the kit sources, fall back to a `prebuild` script that writes vendor files to `apps/web/public/tool-runtime/` — say which you did). ETag = sha1 of code; `Cache-Control: public, max-age=31536000, immutable` when the URL carries `?v=<etag>`.

**lib/tools/frameDocument.ts** (pure): `renderFrameDocument({ selfOrigin, appOrigin, bundleUrl, vendorBase, nonce? }): string` — minimal HTML: `<meta charset>`, import map `{ imports: { react: vendorBase+'/react.js?v=…', 'react/jsx-runtime': …, 'react-dom/client': …, '@visvine/tool-kit': …} }`, `<div id="root">`, a module script `import { bootTool } from '@visvine/tool-kit'; bootTool(() => import(bundleUrl))` with `parentOrigin = appOrigin` passed in; a `<noscript>`; a base style resetting margins and `color-scheme`. No inline event handlers. Test the output contains the import map and no external URLs beyond selfOrigin.

**routes**: `GET /api/tools/runtime/frame?token=…` → verify token → resolve bundle id (`install:<installId>` → the version's uiBundle; `preview:<spaceId>/<name>` → the AppToolBuild's uiBundle) → respond HTML with `frameHeaders(frameCsp(...))` (selfOrigin = request origin, appOrigin from lib/tools/origin). If the token is invalid → 403 HTML error card (plain page). If build not ok → 200 HTML error card listing diagnostics (this IS the 'compile error in-pane' surface for previews). `GET /api/tools/runtime/bundle/[id]?token=…` → same token check → JS with `bundleHeaders()`; the id is `v_<versionId>` or `b_<buildId>`; ETag from a hash column or computed. `GET /api/tools/runtime/vendor/[file]` → vendorFile (public, no token; only the four names).

Routes must set `Cross-Origin-Resource-Policy: cross-origin` and never set cookies. Acceptance: tsc/lint/test/knip clean; with `pnpm dev` running and `TOOLS_ORIGIN=http://127.0.0.1:3000`, `curl http://127.0.0.1:3000/api/tools/runtime/vendor/react.js` returns JS (report).
