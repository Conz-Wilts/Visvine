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
./gradlew :app:testDebugUnitTest  # unit tests (MediaUrl, search heuristic, chat SSE events)
./gradlew :app:lintDebug          # Android lint
```

## Configuration

App config is set via Gradle properties (in `gradle.properties`,
`~/.gradle/gradle.properties`, or `-P`):

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
│   ├── realtime/    MessageStream (OkHttp SSE → /api/messages/stream), ChatEventParser
│   └── repository/  Auth/Space/Directory/Events/Messages/Feed/Agents/Activity/Actions/Profile repos
├── di/              Hilt NetworkModule
└── ui/
    ├── theme/       8 hues (buildColors), Compose theme
    ├── state/       SpaceManager, SearchController (app-scoped stores)
    ├── viewmodel/   one ViewModel per screen + shared (Auth/Theme/...)
    ├── components/  ScreenHeader, SearchOverlay, SpaceAvatar, PersonAvatar, SegmentedNav,
    │                MessageBubble, ConversationRow, DateSeparator, Hairline, Loading
    ├── navigation/  Routes, nav graphs, glass tab bar
    └── screens/     home, messaging, activity, agents, directory, events, auth, profile, settings
```

## Screens

Three tabs (`docs/mobile.md`), and what each opens:

| Tab | Screen | Opens |
|---|---|---|
| **Home** | `home/HomeScreen` — the space switcher, People and Events rows, the space's feed, the quick-capture composer | `directory/DirectoryScreen`, `events/EventsListScreen` (root-level, from the two rows) |
| **Messages** | `messaging/MessagesHubScreen` — Agents (standing threads) / Contacts (DMs) | `agents/AgentChatScreen` (SSE turn over `…/chat/stream`), `messaging/ConversationScreen`, `messaging/NewMessageScreen` (person picker → DM) |
| **Activity** | `activity/ActivityScreen` — coming up, then runs, mentions, replies and requests by day, approve/decline on the row | an agent chat, a conversation, an event |

The current space is remembered in DataStore (`visvine_current_space_id`) and
restored on launch by `SpaceManager`.

## Notes

- **Realtime** is foreground-only (SSE). Background delivery needs push
  (APNs/FCM) — an explicit follow-on.
- **Kill-switch** (`core/KillSwitch.kt`) is wired into the root UI from day one
  but inert until a remote source is connected (its `refresh()` is the seam).
- App icons are vector adaptive icons (no binary assets committed).
```

## Icons

The app draws Visvine's own icons, not Material's. The glyphs are SVG files in
`assets/icons/` at the repo root (shared with the web and iOS apps); they become
`res/drawable/ic_*.xml` vector drawables via:

    node scripts/build-icons.mjs           # regenerate (output is committed)
    node scripts/build-icons.mjs --check   # fail if the committed output is stale

`ui/icons/AppIcons.kt` names them, so a call site reads
`Icon(AppIcons.Check, contentDescription = null, tint = ...)`. Adding a glyph:
add its name to `ANDROID_ICONS` in the script, run it, add the property to
`AppIcons`. See `docs/icons.md`.
