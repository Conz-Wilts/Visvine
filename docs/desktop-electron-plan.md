# Visvine Desktop (Electron) — build plan

Status: **implemented in `apps/desktop`** (2026-08-15). This doc records the plan the
build followed and the decisions behind it; `apps/desktop/README.md` is the operator guide.

## Goal

Ship Visvine as a desktop app (Windows / macOS / Linux) inside this monorepo without
forking the product: the desktop app is a **thin Electron shell around the existing
Next.js web app**, the same way the native mobile clients are thin clients over the web
API. One codebase for the UI, one server, one auth system.

## Why a shell (and not a bundled server)

`apps/web` needs Postgres + pgvector, Prisma, GCS and Google OAuth. Bundling that into
an installer would mean shipping a database engine, per-user secrets and a full server
runtime, and it would still need the network for GCS/OAuth. Slack, Notion, Linear and
Figma all ship the same shape: Chromium window → hosted web app. So:

- **Packaged app** loads `https://visvine.com` (override with `VISVINE_DESKTOP_URL`,
  `--url=…`, or a persisted setting).
- **Dev** loads `http://localhost:3000` from `pnpm dev`, and can use `/dev/login`.
- Auth is the normal web cookie session (`auth_session`) inside Electron's persistent
  session partition — no changes to `lib/session.ts` or the API contract.

## Architecture (`apps/desktop`, package `@visvine/desktop`)

| Piece | Responsibility |
| --- | --- |
| `src/main.ts` | app lifecycle, single-instance lock, `visvine://` deep links, window creation, server-availability wait + offline fallback |
| `src/config.ts` | resolves the app URL (`--url` → env → saved setting → default per mode) |
| `src/urls.ts` | **pure** navigation policy: same-app vs auth-provider vs external — unit-tested |
| `src/window-state.ts` | persists window bounds/maximised state under `app.getPath('userData')` |
| `src/menu.ts` | native menu (navigation, reload, zoom, devtools, "Open in browser") |
| `src/preload.ts` | `contextBridge` → `window.visvineDesktop = { platform, version, isDesktop }` only |
| `resources/offline.html` | shown when the server is unreachable; retries automatically |
| `electron-builder.yml` | NSIS (win), DMG (mac), AppImage/deb (linux) targets |

Security posture: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
`webSecurity` on, `setWindowOpenHandler` opens anything off-app in the system browser,
`will-navigate` blocks navigation to non-app / non-auth origins, permission requests are
denied by default (except clipboard/fullscreen), and only the `visvineDesktop` bridge is
exposed. The Chromium UA is normalised (Electron token stripped, `VisvineDesktop/<v>`
appended) so Google OAuth does not reject the sign-in with `disallowed_useragent`.

## Web-side touch points

Deliberately none required. Optional follow-ups the shell already supports:
`navigator.userAgent` contains `VisvineDesktop/<version>` and `window.visvineDesktop`
is present, so the web app can detect the shell (e.g. hide "Download the app" banners).

## Scripts

Root: `pnpm dev:desktop` (web + electron together), `pnpm desktop:build`,
`pnpm desktop:dist`, `pnpm desktop:test`, `pnpm desktop:e2e`.

## Test plan

1. **Unit** — `node --test` over `src/urls.ts` / `src/config.ts` (URL policy, UA rewrite,
   URL resolution precedence).
2. **Type/lint** — `tsc --noEmit` for the desktop package; root `pnpm typecheck` /
   `pnpm lint` unaffected (desktop is its own tsconfig).
3. **E2E** — Playwright `_electron` launches the built app against the local dev server:
   window opens → sign-in page renders → dev login as `admin@local.dev` → `/home`
   renders authenticated shell → external link goes to `shell.openExternal` (stubbed) →
   offline page shows when the URL is unreachable.
4. **Package** — `electron-builder --dir` produces an unpacked app that launches.

## Out of scope / follow-ups

- Auto-update (electron-updater) — needs a release feed + code signing certs.
- Code signing / notarisation — needs Apple Team ID / Windows cert (same blocker as mobile).
- Native notifications for messages — the web app has no push layer today.
- Offline cache — the web app is server-rendered; a service worker is a web-side project.
