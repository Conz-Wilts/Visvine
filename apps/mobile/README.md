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

## The three tabs

The phone is a lite extension of a space — `docs/mobile.md` is the contract:

| Tab | Holds |
|---|---|
| **Home** | the space switcher, a People row and an Events row (the Directory and Events screens, pushed), and the space's feed |
| **Messages** | Agents — each of the space's agents as a standing chat thread, answered by the space's model with the agent's tools running as you; Contacts — DMs, with a people picker that makes one |
| **Activity** | runs that acted for you, mentions and replies, join and access requests you can answer in place, and the events you are going to |

The current space is remembered per device (`visvine_current_space_id`).

## The contract is the web app

There is no shared types package. The API contract *is* the web route handlers
under `apps/web/app/api/**` plus the DTO types in `apps/web/lib/` (`lib/types/`,
`lib/messages/types.ts`). Server truth; the clients mirror it by hand.

Two quirks the clients must match, because the server will not change to suit
them:

- **Casing is inconsistent per route.** Some endpoints answer `snake_case`,
  others `camelCase`. Check the handler, not the neighbouring endpoint.
- **Responses are named-key envelopes**, not bare arrays: `{ spaces: [...] }`,
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
both clients follow the same quiet-surface rules `apps/web` does. Every value
comes from the design tokens (`packages/tokens`, generated into
`Tokens.generated.swift` and `Tokens.kt` by `pnpm tokens:build`; reference in
`packages/ui/DESIGN.md`), under the same names as the web's utilities:

- **No cards.** A group of rows is opened by a 1px `lineSubtle` hairline on the
  flat `surface` — not wrapped in a rounded, tinted block.
- **One label shape:** a rounded square (`VVRadius.md`, 6), painted in its own
  colour or plain on `surfaceMuted`. No pills, and no tinted wash inside a border
  of the same hue.
- **Buttons are rounded squares** (`VVRadius.lg`, 8), painted: accent for the
  primary, `surfaceSubtle` for its quiet half. None of them cast a shadow.
- **Shadows are for things that float** — the glass tab bar and the search
  overlay, and nothing else.
- **Empty states** are a line of muted text, optionally a small icon and a text
  link in the accent. No tile behind the icon.
- **The app is light-only**, like the web app: `UIUserInterfaceStyle: Light` on
  iOS, `forceDarkAllowed=false` on Android. The tokens carry a provisional dark
  theme that neither app switches on.

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
