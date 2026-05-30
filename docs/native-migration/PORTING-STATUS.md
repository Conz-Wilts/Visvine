# Native port — status tracker

> Tracks the file-by-file migration of `apps/mobile` (Expo/RN) → `apps/android` (Kotlin/Compose) and
> `apps/ios` (Swift/SwiftUI). **Nothing has been compiled** — this machine has no JVM/Android SDK/Xcode
> (Node only). "Done" below = source written + reviewed by inspection; every item still needs an
> Android Studio / Xcode build pass to compile, resolve versions, and run.

Legend: ✅ ported (compile-pending) · 🟡 partial/approximate · ⬜ not started · — n/a

## Shared
| Item | RN source | Android | iOS |
|---|---|---|---|
| API contract (A1) | `services/api.ts` + routes | ✅ `docs/native-migration/api-contract.md` | (shared) |

## Data layer
| Item | RN source | Android | iOS |
|---|---|---|---|
| `resolveMediaUrl` (+test) | `services/api.ts` | ✅ `MediaUrl.kt` | ⬜ |
| `{data,error}` envelope | `services/api.ts` | ✅ `ApiResult.kt` | ⬜ |
| DTOs (server-truth) | `types/index.ts` + routes | ✅ `dto/Dtos.kt` | ⬜ |
| HTTP service (12 methods) | `services/api.ts` | ✅ `VisvineApi.kt` | ⬜ |
| Bearer interceptor | `services/api.ts` | ✅ `AuthInterceptor.kt` | ⬜ |
| Client factory | `services/api.ts` | ✅ `ApiClient.kt` | ⬜ |
| Repository | (contexts) | ✅ `data/VisvineRepository.kt` | ⬜ |
| Secure token store | `AuthContext` (SecureStore) | ✅ `data/auth/TokenStorage.kt` | ⬜ |

## App state / theme / DI
| Item | RN source | Android | iOS |
|---|---|---|---|
| Theme palettes + buildColors | `ThemeContext.tsx` | ✅ `ui/theme/ColorThemes.kt` | ⬜ |
| Compose/SwiftUI theme | `ThemeContext.tsx` | ✅ `ui/theme/Theme.kt` | ⬜ |
| Theme persistence | `ThemeContext` (SecureStore) | ✅ `data/prefs/ThemePreferences.kt` | ⬜ |
| Auth state | `AuthContext.tsx` | ✅ `ui/auth/AuthViewModel.kt` | ⬜ |
| Community state | `CommunityContext.tsx` | ✅ `ui/community/CommunityViewModel.kt` | ⬜ |
| Search state | `SearchContext.tsx` | ✅ `ui/search/SearchViewModel.kt` | ⬜ |
| DI / app container | (provider tree) | ✅ `di/AppContainer.kt` | ⬜ |
| OAuth + deep link | `LoginScreen` + `AuthContext` | ✅ `data/auth/OAuth.kt` | ⬜ |

## Components
| Item | RN source | Android | iOS |
|---|---|---|---|
| Glass surface (blur) | `TabNavigator`/`SearchOverlay` | ✅ `ui/components/GlassSurface.kt` | ⬜ |
| CommunityAvatar | `components/CommunityAvatar.tsx` | ✅ `ui/components/CommunityAvatar.kt` | ⬜ |
| Loading | `components/Loading.tsx` | ✅ `ui/components/Loading.kt` | ⬜ |
| ScreenHeader | `components/ScreenHeader.tsx` | ✅ `ui/components/ScreenHeader.kt` | ⬜ |
| SearchOverlay | `components/SearchOverlay.tsx` | ✅ `ui/components/SearchOverlay.kt` | ⬜ |

## Navigation
| Item | RN source | Android | iOS |
|---|---|---|---|
| App nav (auth/main + modals) | `AppNavigator.tsx` | ⬜ next | ⬜ |
| Glass tab bar + swipe | `TabNavigator.tsx` | ⬜ next | ⬜ |
| Host activity + deep links | `App.tsx` / `index.ts` | 🟡 `VisvineApp.kt` done; `MainActivity.kt` is still the View placeholder (no Compose host / deep-link filter yet) | ⬜ |

## Screens (11)
| Screen | RN source | Android | iOS |
|---|---|---|---|
| Login | `Auth/LoginScreen.tsx` | ⬜ next | ⬜ |
| DevLogin | `Auth/DevLoginScreen.tsx` | ⬜ | ⬜ |
| Directory | `Directory/DirectoryScreen.tsx` | ⬜ | ⬜ |
| FullProfile | `Profile/FullProfileScreen.tsx` | ⬜ | ⬜ |
| Profile | `Profile/ProfileScreen.tsx` | ⬜ | ⬜ |
| EditProfile | `Profile/EditProfileScreen.tsx` | ⬜ | ⬜ |
| Settings | `Settings/SettingsScreen.tsx` | ⬜ next | ⬜ |
| EventsList | `Events/EventsListScreen.tsx` | ⬜ | ⬜ |
| EventDetail | `Events/EventDetailScreen.tsx` | ⬜ | ⬜ |
| ConversationsList | `Messaging/ConversationsListScreen.tsx` | ⬜ | ⬜ |
| Conversation | `Messaging/ConversationScreen.tsx` | ⬜ | ⬜ |

## Not in scope of the port (follow-ons, see strategy doc)
Push (APNs/FCM), offline/local DB, scalable SSE fan-out, observability + kill-switch, CI/CD, store config.
