# Visvine mobile — store deployment runbook

How to get the native apps onto real phones via **TestFlight** (iOS, the
priority) and **Google Play internal/closed testing** (Android). The repo prep
below is **already done**; what remains is account setup + filling in a few
secrets that can't live in git.

> Build machine reality: **iOS archives must be built on macOS** (Xcode). Android
> builds run anywhere, including Windows.

---

## 0. Fill-in values (do these once)

| Where | Placeholder to replace | With |
|---|---|---|
| `ios/Config/Local.xcconfig` (create from `.example`) | `REPLACE_WITH_TEAM_ID` | Apple Developer **Team ID** (App Store Connect → Membership) |
| `ios/Config/Release.xcconfig` | `REPLACE-WITH-CLOUD-RUN-URL` | your **Cloud Run HTTPS host** (keep the `https:/$()/` prefix form) |
| `android/keystore.properties` (create from `.example`) | passwords / alias | your **upload keystore** credentials |
| `android/app/build.gradle.kts` | `REPLACE-WITH-CLOUD-RUN-URL` | your **Cloud Run HTTPS URL** (or pass `-Pvisvine.apiBaseUrl.release=…`) |

Also register `https://<cloud-run-host>/api/auth/callback/google-mobile` and the
`visvine://` scheme in your **Google OAuth client**, so real sign-in works off
localhost.

---

## iOS → TestFlight (external/wider beta)

### A. Accounts (start first — enrollment can take 24–48h)
1. Enroll in the **Apple Developer Program** ($99/yr). Note your **Team ID**.
2. In **App Store Connect**, create the app: bundle id `com.visvine.mobile`,
   name "Visvine", primary language, SKU.

### B. Repo prep — DONE in this commit
- `Config/{Base,Debug,Release}.xcconfig` drive backend URL + dev-auth per build:
  **Debug = localhost + dev-login on**, **Release = production + dev-login off**.
- `Info.plist` now reads those build settings (no hardcoded dev values).
- `PrivacyInfo.xcprivacy` added (required for submission; declares UserDefaults
  required-reason API + a starter collected-data list — keep it in sync with the
  App Privacy answers in App Store Connect).
- `DEVELOPMENT_TEAM` comes from `Config/Local.xcconfig` (gitignored).

### C. You still need to supply
- [ ] `Config/Local.xcconfig` with your **Team ID** (copy from `.example`).
- [ ] **Cloud Run URL** in `Config/Release.xcconfig`.
- [ ] A real **1024×1024 app icon** (opaque, no alpha) in
      `Visvine/Assets.xcassets/AppIcon.appiconset` — currently a placeholder.
      Apple rejects builds without it.
- [ ] **Decision — Sign in with Apple (Guideline 4.8).** Because the app offers
      Google login, Apple commonly **requires** Sign in with Apple too. This is
      the most likely rejection reason. Either add it (needs an iOS button +
      entitlement + a backend `/api/auth/callback/apple` route) or be ready for a
      possible rejection on the beta review. Recommended: add it before the
      external-tester review to avoid a round-trip.
- [ ] A hosted **privacy policy URL** (required in TestFlight test info).

### D. Build & upload (on the Mac)
```bash
cd apps/mobile/ios
xcodegen generate          # regenerates Visvine.xcodeproj from project.yml
open Visvine.xcodeproj
```
In Xcode: destination **Any iOS Device (arm64)** → **Product ▸ Archive** →
**Organizer ▸ Distribute App ▸ App Store Connect ▸ Upload**. Processing in App
Store Connect takes ~5–30 min.

Bump **CURRENT_PROJECT_VERSION** (`project.yml` → `settings.base`) on every
upload — build numbers must strictly increase.

### E. TestFlight beta
- **Internal testers** (App Store Connect users you add, ≤100): build available
  immediately, no review. Use this to smoke-test first.
- **External testers** (your wider group, ≤10,000): create a group, add emails or
  enable the **public link**. The **first external build needs Beta App Review**
  (lighter than full review, usually <48h). In **TestFlight → Test Information**
  provide a beta description, feedback email, privacy policy URL, "What to test",
  and **demo credentials** (dev-login is off, so reviewers/testers need a real
  account). Builds expire **90 days** after upload.

---

## Android → Google Play internal/closed testing

### A. Account
1. Create a **Play Console** account ($25 one-time). Prefer an **Organization**
   account — it avoids the 2026 rule requiring *personal* accounts to run 14 days
   of closed testing with ≥12 testers before production.

### B. Repo prep — DONE in this commit
- `app/build.gradle.kts` has a **release signing config** that reads
  `keystore.properties` (gitignored); release builds are unsigned only if that
  file is absent.
- Release builds default to **production backend + dev-login off**
  (`visvine.apiBaseUrl.release` / `visvine.devAuthEnabled.release`).
- `.gitignore` blocks `keystore.properties`, `*.jks`, `*.keystore`.

### C. You still need to supply
- [ ] Generate an **upload keystore** and create `keystore.properties` (see
      `keystore.properties.example` for the keytool command + fields).
- [ ] **Cloud Run URL** in `build.gradle.kts` (or `-Pvisvine.apiBaseUrl.release=…`).
- [ ] Store listing assets (icon 512px, feature graphic, screenshots) + a
      **Data Safety** form + privacy policy URL in the Play Console.

### D. Build & upload
```bash
cd apps/mobile/android
./gradlew :app:bundleRelease     # signed .aab at app/build/outputs/bundle/release/
```
Upload the `.aab` to the **Internal testing** track (live in minutes, ≤100
testers) → share the opt-in link. Bump **versionCode** in `build.gradle.kts` on
every upload.

> Quick "just on my phone" milestone with no Play account:
> `./gradlew :app:assembleRelease` → send the signed APK to people to sideload.

---

## Cost & time summary

| | iOS | Android |
|---|---|---|
| Account | $99/yr | $25 one-time |
| Build host | macOS (Xcode) | any (incl. Windows) |
| To "on phones" | enroll → archive → upload → 1 beta review (~2–3 days) | account → signed `.aab` → internal track (~1 day) |
