import Foundation

/// Faithful port of `resolveMediaUrl` (src/services/api.ts), covered by MediaURLTests.
///  - nil / empty           → nil
///  - absolute http(s)/data → unchanged
///  - leading-slash path    → prefixed with the API base
///  - bare token            → left alone
enum MediaURL {
    private static let absolute = try! NSRegularExpression(pattern: "^(https?:|data:)")

    static func resolve(_ url: String?) -> String? {
        guard let url, !url.isEmpty else { return nil }
        let range = NSRange(url.startIndex..., in: url)
        if absolute.firstMatch(in: url, range: range) != nil { return url }
        if url.hasPrefix("/") { return AppConfig.apiBase + url }
        return url
    }
}
