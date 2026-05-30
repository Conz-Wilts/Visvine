# Visvine Mobile (Native)

Visvine's mobile clients are **fully native** apps that talk to the unchanged
`@visvine/web` backend over HTTPS (Bearer-token JWT). The previous Expo / React
Native app has been fully migrated and removed.

| Platform | Stack | Folder |
|---|---|---|
| **Android** | Kotlin · Jetpack Compose · Hilt · Retrofit/OkHttp | [`android/`](./android) |
| **iOS** | Swift · SwiftUI · Observation · URLSession | [`ios/`](./ios) |

Both follow the same architecture — **MVVM + a thin repository/data layer** — so
the screens line up 1:1 across platforms and with the old RN app:

- **11 screens**: Login, DevLogin, Directory, FullProfile, Events list/detail,
  Conversations list/thread, Profile, EditProfile, Settings.
- **4 app-scoped stores** (was: React Contexts): Auth, Community, Theme, Search.
- **API contract**: the same ~9 backend routes the RN `ApiService` called, with
  the `{data,error}` envelope, `resolveMediaUrl` rules, and OAuth deep-link flow
  ported faithfully. [`docs/native-migration/api-contract.md`](../../docs/native-migration/api-contract.md)
  is the canonical contract reference (server-truth shapes + drift register).
- **Foreground real-time messaging** via SSE (`/api/messages/stream`,
  header-authed). Push (background) and offline remain explicit follow-ons.

This is a **thin client**: all business logic stays server-side in `apps/web`.

## Getting started

- **Android** — see [`android/README.md`](./android/README.md)
  (`gradle wrapper` once, then `./gradlew :app:installDebug`).
- **iOS** — see [`ios/README.md`](./ios/README.md)
  (`xcodegen generate`, then build in Xcode).

## Backend & config

Both apps default to a local dev backend and offer a "Dev login" path
(no Google OAuth) when enabled:

| Concern | Android | iOS |
|---|---|---|
| Backend origin | `visvine.apiBaseUrl` (Gradle, default `http://10.0.2.2:3000`) | `VisvineApiBaseURL` (Info.plist, default `http://localhost:3000`) |
| Dev login | `visvine.devAuthEnabled` | `VisvineDevAuthEnabled` |
| Google client id | `visvine.googleClientId` | `VisvineGoogleClientID` |

For a physical device or real Google OAuth, point the backend origin at your LAN
IP / a Cloudflare tunnel and register `<origin>/api/auth/callback/google-mobile`
+ the `visvine://` scheme with the OAuth client (see the repo root README).

## Migration

The native rebuild strategy and phased plan live in
[`docs/native-migration/`](../../docs/native-migration/README.md).
