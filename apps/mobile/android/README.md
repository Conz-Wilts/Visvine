# Visvine Android (Kotlin / Jetpack Compose)

Native Android client for Visvine. Talks to the unchanged `@visvine/web` backend
over HTTPS (Bearer-token JWT). MVVM + a thin repository/data layer; Compose UI;
Hilt DI; Retrofit/OkHttp + kotlinx.serialization.

## Requirements

- JDK 17
- Android SDK (compileSdk 35), `minSdk` 26
- Android Studio Ladybug+ (recommended) or a local Gradle 8.11+

## First-time setup

The Gradle **wrapper scripts** (`gradlew`, `gradlew.bat`) and
`gradle/wrapper/gradle-wrapper.properties` are committed, but the binary
`gradle-wrapper.jar` is not. Generate it once:

```bash
cd apps/mobile/android
gradle wrapper --gradle-version 8.11.1   # or just open the folder in Android Studio
```

Create `local.properties` with your SDK path (Android Studio does this for you):

```
sdk.dir=/path/to/Android/sdk
```

## Build & run

```bash
./gradlew :app:assembleDebug      # build
./gradlew :app:installDebug       # install on a running emulator/device
./gradlew :app:testDebugUnitTest  # unit tests (MediaUrl, search heuristic)
./gradlew :app:lintDebug          # Android lint
```

## Configuration

App config replaces the old `EXPO_PUBLIC_*` env values; set via Gradle
properties (in `gradle.properties`, `~/.gradle/gradle.properties`, or `-P`):

| Property | Default | Purpose |
|---|---|---|
| `visvine.apiBaseUrl` | `http://10.0.2.2:3000` | Backend origin (emulator → host) |
| `visvine.devAuthEnabled` | `true` | Show the in-app "Dev login" path |
| `visvine.googleClientId` | _(empty)_ | Web client id for real Google OAuth |

These surface as `BuildConfig.API_BASE_URL` / `DEV_AUTH_ENABLED` /
`GOOGLE_CLIENT_ID` and are read in `core/AppConfig.kt`. For a physical device,
point `visvine.apiBaseUrl` at your LAN IP or a Cloudflare tunnel.

## Layout

```
app/src/main/java/com/visvine/mobile/
├── core/            AppConfig, KillSwitch (remote gate)
├── auth/            AuthManager (session+deep-link), OAuthLauncher (Custom Tabs)
├── data/
│   ├── model/       @Serializable wire models (mirror the web API server-truth shapes)
│   ├── remote/      Retrofit VisvineApi, AuthInterceptor, MediaUrl, ApiResult
│   ├── local/       TokenStore (Keystore), PreferencesStore (DataStore)
│   ├── realtime/    MessageStream (OkHttp SSE → /api/messages/stream)
│   └── repository/  Auth/Community/Directory/Events/Messages/Profile repos
├── di/              Hilt NetworkModule
└── ui/
    ├── theme/       8 hues + dark toggle (buildColors), Compose theme
    ├── state/       CommunityManager, SearchController (app-scoped stores)
    ├── viewmodel/   one ViewModel per screen + shared (Auth/Theme/...)
    ├── components/   ScreenHeader, SearchOverlay, CommunityAvatar, Loading
    ├── navigation/  Routes, nav graphs, glass tab bar
    └── screens/     auth, directory, events, messaging, profile, settings
```

## Notes

- **Realtime** is foreground-only (SSE). Background delivery needs push
  (APNs/FCM) — an explicit follow-on.
- **Kill-switch** (`core/KillSwitch.kt`) is wired into the root UI from day one
  but inert until a remote source is connected (its `refresh()` is the seam).
- App icons are vector adaptive icons (no binary assets committed).
```
