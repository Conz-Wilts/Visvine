# Visvine mobile

Two **native** clients, not one cross-platform app and not part of the
pnpm/Turbo workspace:

| | Stack | Build | Guide |
|---|---|---|---|
| `android/` | Kotlin + Jetpack Compose, Hilt, Retrofit/OkHttp | Gradle | [`android/README.md`](android/README.md) |
| `ios/` | Swift + SwiftUI, `@Observable`, `URLSession` | Xcode (XcodeGen) | [`ios/README.md`](ios/README.md) |

Both are **thin clients**: they hold no schema, no database and no business
rules. Everything they show comes from `apps/web` over HTTPS with a Bearer JWT.
Run the platform guide for toolchain setup and build commands; this page covers
only what the two have in common — which is the part that bites.

## The contract is the web app

There is no shared types package. The API contract *is* the web route handlers
under `apps/web/app/api/**` plus the DTO types in `apps/web/lib/` (`lib/types/`,
`lib/messages/types.ts`). Server truth; the clients mirror it by hand.

Two quirks the clients must match, because the server will not change to suit
them:

- **Casing is inconsistent per route.** Some endpoints answer `snake_case`,
  others `camelCase`. Check the handler, not the neighbouring endpoint.
- **Responses are named-key envelopes**, not bare arrays: `{ communities: [...] }`,
  `{ nodes: [...] }`.

Media is served public, so image loads need no auth header — but URLs come back
relative (`/api/media/...`) and each client rewrites them against its configured
API base (`MediaUrl` on Android, `MediaURL` on iOS).

Icons are shared too, and generated rather than hand-drawn: the SVGs in
`assets/icons/` at the repo root are the source for all three clients, codegen'd
into Android vector drawables and iOS asset-catalog image sets by each
platform's `scripts/build-icons.mjs`. Generated output is committed. See
`docs/icons.md`.

## What the screens look like

The web app is the source of truth for the surface as well as the features, so
both clients follow the same quiet-surface rules `apps/web` does:

- **No cards.** A group of rows is opened by a 1px `borderSubtle` hairline on the
  flat `bgPrimary` surface — not wrapped in a rounded, tinted block.
- **One label shape:** a rounded square (6dp/pt), painted in its own colour or
  plain on `bgTertiary`. No pills, and no tinted wash inside a border of the same
  hue.
- **Buttons are rounded squares** (8dp/pt), painted: accent for the primary,
  `bgSecondary` for its quiet half. None of them cast a shadow.
- **Shadows are for things that float** — the glass tab bar and the search
  overlay, and nothing else.
- **Empty states** are a line of muted text, optionally a small icon and a text
  link in the accent. No tile behind the icon.
- **The app is light-only**, like the web app: `UIUserInterfaceStyle: Light` on
  iOS, `forceDarkAllowed=false` on Android, one palette in `buildColors`.

The directory card is the one deliberate exception to "no cards": it is the same
object `NodeCard.tsx` draws on the web, ring and all — square identity media,
name over tagline over the type chip, two tagline lines always reserved.

## Pointing a client at a backend

One setting per platform:

| Platform | Setting | Where |
|---|---|---|
| Android | `visvine.apiBaseUrl` | Gradle property |
| iOS | `VisvineApiBaseURL` | `Info.plist` |

What to set it to depends on where the app runs:

- **Simulator / emulator** reach the dev server directly: `http://localhost:3000`
  on iOS, `http://10.0.2.2:3000` on Android.
- **A physical device cannot reach `localhost`.** Use your LAN IP, or — the
  cleaner option — a Cloudflare tunnel fronting the dev server:

  ```bash
  cloudflared tunnel --url http://localhost:3000
  ```

For **real Google OAuth** on a device there is a third step, because Google
refuses non-HTTPS redirect URIs: set `NEXT_PUBLIC_APP_URL` (web) to the tunnel
URL, and register both `<origin>/api/auth/callback/google-mobile` and the
`visvine://` scheme with the OAuth client. The mobile callback is a separate
route from the web one (`/api/auth/callback/google`) for exactly this reason.

## Signing in during development

You usually do not need any of the OAuth setup above. The login screen has a
**"Dev login (skip Google)"** button that lists the seeded users and mints a
session directly — the same bypass as the web `/dev/login`. Anchor users are
`admin@local.dev` (admin + super admin) and `member@local.dev`.

The bypass returns 404 unless the *server* runs with both
`NODE_ENV=development` and `ENABLE_DEV_AUTH=true`, so it cannot be switched on
against a production build.

## Sessions

Both clients send `Authorization: Bearer <jwt>` — the same HS256 30-day session
the web app puts in an `auth_session` cookie, just a different transport. One
signing key (`AUTH_SECRET`), one verifier (`apps/web/lib/session.ts`), two
acceptance paths.
