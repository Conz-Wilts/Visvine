# Visvine iOS (Swift / SwiftUI)

Native iOS client for Visvine. Talks to the unchanged `@visvine/web` backend over
HTTPS (Bearer-token JWT). MVVM + a thin repository/data layer; SwiftUI; the
Observation framework (`@Observable`); `URLSession` + `Codable`.

## Requirements

- Xcode 15+ (iOS 17 deployment target — `@Observable` / `NavigationStack`)
- [XcodeGen](https://github.com/yonsei/XcodeGen) (`brew install xcodegen`)

## First-time setup

The Xcode project is defined as code in `project.yml` (not committed as a
`.xcodeproj`). Generate it:

```bash
cd apps/mobile/ios
xcodegen generate
open Visvine.xcodeproj
```

## Build & test

```bash
xcodegen generate
xcodebuild -scheme Visvine -destination 'platform=iOS Simulator,name=iPhone 15' build
xcodebuild -scheme Visvine -destination 'platform=iOS Simulator,name=iPhone 15' test
```

Or just build/run from Xcode after `xcodegen generate`.

## Configuration

App config lives in `Visvine/Info.plist` and is read in `Core/AppConfig.swift`:

| Info.plist key | Default | Purpose |
|---|---|---|
| `VisvineApiBaseURL` | `http://localhost:3000` | Backend origin (simulator → host) |
| `VisvineDevAuthEnabled` | `true` | Show the in-app "Dev login" path |
| `VisvineGoogleClientID` | _(empty)_ | Web client id for real Google OAuth |

For a physical device, point `VisvineApiBaseURL` at your LAN IP or a Cloudflare
tunnel (and add the tunnel callback to the OAuth client — see the repo README).

## Layout

```
Visvine/
├── Core/            AppConfig, KillSwitch (remote gate)
├── Models/          Codable wire models (mirror the web API server-truth shapes)
├── Networking/      APIClient (URLSession), MediaURL, APIResult
├── Storage/         KeychainTokenStore, PreferencesStore (UserDefaults)
├── Realtime/        MessageStream (URLSession.bytes SSE → /api/messages/stream)
├── Repositories/    Auth/Space/Directory/Events/Messages/Profile
├── Auth/            AuthManager (session+deep link), OAuthService (ASWebAuth…)
├── State/           SpaceStore, ThemeStore, SearchStore (@Observable)
├── Theme/           8 hues (buildColors), DynamicColors
├── Util/            search heuristic, date formatting
├── Components/      ScreenHeader, SearchOverlay, SpaceAvatar, glass
├── Navigation/      RootView, MainTabView, glass tab bar, route enums
└── Views/           login, dev-login, directory, full-profile, events,
                     messaging, profile, edit-profile, settings
```

## Notes

- **Realtime** is foreground-only (SSE over `URLSession.bytes`, header-authed).
  Background delivery needs push (APNs) — an explicit follow-on.
- **Kill-switch** (`Core/KillSwitch.swift`) is wired into the root view from day
  one but inert until a remote source is connected (its `refresh()` is the seam).
- The glass tab/search bars use real `.ultraThinMaterial` backdrop blur.
- App icon / accent color live in `Assets.xcassets`; the 1024px icon image is a
  placeholder to be supplied by design.
```

## Icons

The app draws Visvine's own icons, not SF Symbols. The glyphs are SVG files in
`assets/icons/` at the repo root (shared with the web and Android apps); they
become template-rendered image sets under `Visvine/Assets.xcassets/Icons` via:

    node scripts/build-icons.mjs           # regenerate (output is committed)
    node scripts/build-icons.mjs --check   # fail if the committed output is stale

`Components/VisvineIcon.swift` is the view that draws one, so a call site reads
`VisvineIcon(.check, size: 14)` and still takes its tint from `foregroundStyle`.
Adding a glyph: add its name to `IOS_ICONS` in the script, run it, add the case
to `VisvineIconName`. See `docs/icons.md`.
