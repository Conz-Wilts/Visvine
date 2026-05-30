import Foundation

/// Date/time formatting mirroring the RN screens' `toLocale*String` output.
/// Inputs are ISO-8601 strings; rendered in the device zone/locale.
enum DateFormatting {
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso: ISO8601DateFormatter = ISO8601DateFormatter()

    private static func parse(_ value: String) -> Date? {
        isoFractional.date(from: value) ?? iso.date(from: value)
    }

    private static func format(_ value: String, _ template: String) -> String {
        guard let date = parse(value) else { return value }
        let f = DateFormatter()
        f.locale = .current
        f.setLocalizedDateFormatFromTemplate(template)
        return f.string(from: date)
    }

    /// "Mon, Jan 5"
    static func shortDate(_ value: String) -> String { format(value, "EEE MMM d") }
    /// "Monday, January 5, 2026"
    static func longDate(_ value: String) -> String { format(value, "EEEE MMMM d yyyy") }
    /// "3:00 PM"
    static func time(_ value: String) -> String { format(value, "h:mm a") }
    /// "Jan"
    static func monthShort(_ value: String) -> String { format(value, "MMM") }
    /// "5"
    static func dayOfMonth(_ value: String) -> String {
        guard let date = parse(value) else { return value }
        return String(Calendar.current.component(.day, from: date))
    }

    static func isUpcoming(_ value: String) -> Bool {
        guard let date = parse(value) else { return false }
        return date > Date()
    }

    /// Conversations list relative format: now / 5m / 3h / 2d / "Mar 4".
    static func relativeShort(_ value: String) -> String {
        guard let date = parse(value) else { return value }
        let diff = Date().timeIntervalSince(date)
        let mins = Int(diff / 60), hours = Int(diff / 3600), days = Int(diff / 86400)
        switch true {
        case mins < 1: return "now"
        case mins < 60: return "\(mins)m"
        case hours < 24: return "\(hours)h"
        case days < 7: return "\(days)d"
        default: return format(value, "MMM d")
        }
    }
}
