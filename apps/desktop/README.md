# @visvine/desktop

The Visvine desktop app: an Electron shell that loads the Visvine web app
(`apps/web`) in a hardened Chromium window. Like the native mobile clients it is a
thin client — there is no separate UI or API surface to keep in sync. See
`docs/desktop-electron-plan.md` for the design rationale.

## Run it

```bash
pnpm dev:desktop        # from repo root: local Postgres + Next.js dev server + Electron
```

or, with `pnpm dev` already running in another terminal:

```bash
pnpm --filter @visvine/desktop dev          # build once, launch against http://localhost:3000
pnpm --filter @visvine/desktop dev:watch    # tsc --watch + electron
```

Local sign-in works through the normal `/dev/login` page (needs `ENABLE_DEV_AUTH=true`
in `apps/web/.env`, which `pnpm dev` already assumes). If the server isn't up yet the
window shows an offline page and opens the app automatically once it can reach it.

## Which server does it talk to?

Resolved in this order (`src/config.ts`):

1. `--url=https://…` CLI flag
2. `VISVINE_DESKTOP_URL` env var
3. `desktop-settings.json` in the app's userData folder (`{ "appUrl": "…" }`)
4. `http://localhost:3000` when running unpackaged/dev, `https://visvine.com` when packaged

The URL must be the same origin the server itself advertises as `NEXT_PUBLIC_APP_URL`
— the auth callbacks redirect to that absolute origin, so pointing the shell at
`http://127.0.0.1:3000` while the server says `http://localhost:3000` ends every
sign-in on a different origin than the one holding the cookie (true in a browser too).

`VISVINE_DESKTOP_DEV=1|0` forces dev/prod mode; `VISVINE_DESKTOP_USER_DATA=<dir>`
relocates the profile (used by the e2e tests so they never touch your real session).

## Verify

```bash
pnpm desktop:typecheck   # tsc --noEmit
pnpm desktop:test        # builds, then node --test over the pure helpers (URL policy, UA, config)
pnpm desktop:e2e         # Playwright _electron smoke run against the live dev server
```

The e2e run boots the built app, checks the app origin loads, that the preload
bridge (`window.visvineDesktop`) and `VisvineDesktop/<version>` UA are present, does a
dev login as `admin@local.dev`, renders `/home` and `/directory`, proves external
links and off-origin server redirects leave the shell (`shell.openExternal` is stubbed and asserted), checks
window-state persistence, cold-start deep links (`visvine-desktop://open/directory`)
and the offline fallback.

## Package

```bash
pnpm desktop:pack   # unpacked app in apps/desktop/release/ (quick local check)
pnpm desktop:dist   # installers: NSIS (win), DMG+zip (mac), AppImage+deb (linux)
```

Not wired yet (needs certificates / a release feed): code signing, notarisation and
auto-update.

## Layout

```
src/main.ts          app lifecycle, single-instance, deep links, window, offline poll
src/config.ts        app URL resolution + persisted settings
src/urls.ts          pure navigation policy + UA/deep-link helpers (unit-tested)
src/window-state.ts  window bounds persistence
src/menu.ts          native application menu
src/preload.ts       contextBridge → window.visvineDesktop (read-only)
resources/           offline.html
assets/              icon.png (from apps/web/app/icon.png)
tests/               node:test unit tests (run against dist/)
e2e/run.mjs          Playwright electron smoke test
electron-builder.yml packaging targets
```

## Security posture

`contextIsolation`, `sandbox`, no `nodeConnector`, `webSecurity` on. Only same-origin
and Google account URLs load in-window; other `http(s)`/`mailto:` links go to the OS
browser; `javascript:`/`data:` navigations are dropped. The policy is applied to
`will-navigate`, `will-redirect` (server-side 30x to another origin, e.g. the MCP OAuth
consent hop) and `window.open`, and inherited by any child window (only an auth provider may open one).
Permission checks and requests are denied except clipboard, fullscreen and
notifications, and only for the app origin itself. The renderer sees a read-only
`{ isDesktop, platform, version }` bridge and nothing else. The Electron UA token is
stripped (Google refuses OAuth from embedded UAs) and `VisvineDesktop/<version>` is
appended so the web app can detect the shell.
