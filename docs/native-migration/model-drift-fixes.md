# Native model drift — patch spec for the iOS & Android pods

> **Status:** Proposed · **Owner:** Shared Architecture · **Last updated:** 2026-05-30
>
> A web/mobile code-sharing audit found the Kotlin (`apps/mobile/android/.../data/model/*.kt`) and
> Swift (`apps/mobile/ios/Visvine/Models/*.swift`) wire models **disagree with each other** on field
> optionality for several fields, and one side disagrees with **server truth** (see
> [`api-contract.md`](./api-contract.md)). This was written on a Windows box with **no JDK/Swift
> toolchain**, so the changes below are specified for the pods to apply and compile — they are *not*
> applied in the repo. Each is a few lines; the only real decision is the **decode policy** (§3).

## 1. The drift (field-by-field)

Server truth column is from `api-contract.md` + the web types (`apps/web/lib/types.ts` `NBEvent`,
`apps/web/lib/messages/types.ts` `ConversationSummary`/`ConversationParticipant`). "req" = the server
always sends it; "nullable" = sent but may be `null`; "opt" = may be absent.

| Model · field | Server truth | Android (Kotlin) | iOS (Swift) | Agree? |
|---|---|---|---|---|
| `Event.communityId` | req | `String = ""` | `String?` | ❌ iOS over-optional |
| `Event.visibility` | req (`'public'\|'community'\|'private'`) | `String = "community"` | `String?` | ❌ iOS over-optional |
| `Event.hosts` | req `string[]` | `List<String> = emptyList()` | `[String]?` | ❌ iOS over-optional |
| `Event.analytics` | req | `EventAnalytics = EventAnalytics()` | `EventAnalytics?` | ❌ iOS over-optional |
| `Conversation.updatedAt` | req | `String = ""` | `String?` | ❌ iOS over-optional |
| `ConversationParticipant.email` | req | `String = ""` | `String?` | ❌ iOS over-optional |
| `ConversationParticipant.role` | req (`admin\|member`) | `String = "member"` | `String?` | ❌ iOS over-optional |

**Pattern:** Android already matches server truth (required → non-null with a default). **iOS is
systematically over-optional** — every field above is `?` even though the server always sends it. The
iOS views paper over this with coalescing (`event.visibility ?? "community"`,
`event.analytics ?? EventAnalytics(...)`), so it compiles and runs — but the model lies about the
contract, and the two platforms model the same wire object differently.

Genuinely-optional fields (`Event.endAt/timezone/location/capacity`, `*.avatarUrl/image/lastReadAt`,
`Conversation.lastMessage`) already agree on both sides — leave them.

## 2. Recommended direction — make iOS match server truth + Android

Tighten the seven iOS fields to non-optional so all three (server, Android, iOS) agree.

`apps/mobile/ios/Visvine/Models/Event.swift`:
```swift
// before → after
var communityId: String?      →  var communityId: String
var visibility: String?       →  var visibility: String
var hosts: [String]?          →  var hosts: [String]
var analytics: EventAnalytics? → var analytics: EventAnalytics
```
`apps/mobile/ios/Visvine/Models/Messaging.swift`:
```swift
// Conversation
var updatedAt: String?        →  var updatedAt: String
// ConversationParticipant
var email: String?            →  var email: String
var role: String?             →  var role: String
```

Then simplify the now-redundant call-site coalescing (optional — purely cosmetic once the fields are
non-optional):
- `ios/Visvine/Views/EventDetailView.swift:51` and `EventsListView.swift:99`
  `event.analytics ?? EventAnalytics(views:0,rsvpCount:0,checkinCount:0)` → `event.analytics`
- `EventDetailView.swift:99` `(event.visibility ?? "community")` → `event.visibility`

Android needs **no change** under this direction.

## 3. The decision the pods must make — strict vs. lenient decode

This is why this isn't a blind find/replace. Kotlin and Swift behave **differently** when a "required"
field is actually missing from the JSON, and the two model styles above are not equivalent:

- **Kotlin** `val f: String = ""` (kotlinx.serialization): a missing `f` → uses the default, **no throw**. Lenient.
- **Swift** `let f: String` (Codable): a missing `f` → `decode` **throws**, the whole object fails. Strict.

So even after §2, the platforms differ in *robustness*: Android tolerates a contract violation
(silently defaults); iOS rejects it (the API call returns `.failure`). Pick one policy and make both
match it:

- **Option A — Strict both (recommended):** keep iOS non-optional (throws on violation); drop the
  Kotlin defaults on these seven fields (`val communityId: String` with no `= ""`) so kotlinx also
  throws. Contract violations surface immediately and are caught by the **staging contract-conformance
  test** (`api-contract.md` §"Contract-conformance test"). Cleanest, and the conformance test is the
  safety net. Cost: a backend regression breaks the screen instead of degrading it.
- **Option B — Lenient both:** keep Kotlin defaults; give iOS a custom `init(from:)` using
  `decodeIfPresent(...) ?? default` for these fields so Swift also defaults instead of throwing. Most
  crash-resistant, but a drifting backend fails silently (mitigated only by the conformance test).
  More boilerplate on iOS.

Recommendation: **Option A** — it's the least code and it makes the already-planned conformance test
the single mechanism that guards drift, rather than having each client silently absorb it. Whichever
is chosen, apply it to **all seven fields on both platforms** so they stay symmetric.

## 4. Verify (pods, with toolchains)

- Android: `./gradlew :app:compileDebugKotlin :app:testDebugUnitTest`
- iOS: `xcodebuild -scheme Visvine build test` (after `xcodegen generate`)
- Both: run the existing `MediaUrl`/`Search` unit tests (unaffected, but cheap regression check).
- Add/extend the staging contract-conformance assertions so the chosen policy is enforced in CI.
