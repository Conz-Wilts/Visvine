import Foundation

/// Build/runtime configuration, sourced from Info.plist keys. Replaces the old
/// `EXPO_PUBLIC_*` values that were inlined into the JS bundle.
enum AppConfig {
    static let deepLinkScheme = "visvine"

    /// Backend origin (no trailing slash), e.g. http://localhost:3000.
    static let apiBase: String = {
        let raw = (infoString("VisvineApiBaseURL")) ?? "http://localhost:3000"
        return raw.hasSuffix("/") ? String(raw.dropLast()) : raw
    }()

    /// Whether the in-app "Dev login" path is offered.
    static let devAuthEnabled: Bool = {
        if let b = Bundle.main.object(forInfoDictionaryKey: "VisvineDevAuthEnabled") as? Bool { return b }
        return infoString("VisvineDevAuthEnabled") == "true"
    }()

    /// OAuth web client id; required only for real Google sign-in.
    static let googleClientID: String = infoString("VisvineGoogleClientID") ?? ""

    private static func infoString(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.isEmpty else { return nil }
        return value
    }
}
