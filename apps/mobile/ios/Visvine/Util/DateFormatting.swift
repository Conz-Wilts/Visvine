import Foundation

/// Date/time formatting matching the web app's `toLocale*String` output. Inputs
/// are ISO-8601 strings; rendered in the device zone/locale.
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

    /// "Fri, Aug 21, 3:00 PM – 4:00 PM" — the events feed's one facts line.
    /// Mirrors EventsFeedView.formatFullDate, including the note-first case
    /// where an event exists before anyone has dated it.
    static func fullDate(_ startAt: String, endAt: String? = nil) -> String {
        if startAt.isEmpty { return "No date yet" }
        let datePart = format(startAt, "EEE MMM d")
        let startTime = time(startAt)
        if let endAt, !endAt.isEmpty {
            return "\(datePart), \(startTime) – \(time(endAt))"
        }
        return "\(datePart), \(startTime)"
    }

    /// "August 2026" — the month heading the upcoming events are filed under.
    static func monthKey(_ value: String) -> String { format(value, "MMMM yyyy") }

    /// "Starts in 3 days" / "Starting soon" / nil once it has begun. Mirrors
    /// lib/eventUtils.ts#startsInLabel.
    static func startsInLabel(_ value: String) -> String? {
        guard let date = parse(value) else { return nil }
        let diff = date.timeIntervalSinceNow
        if diff < 0 { return nil }
        let hours = Int(diff / 3600)
        if hours < 1 { return "Starting soon" }
        if hours < 24 { return "Starts in \(hours) \(hours == 1 ? "hour" : "hours")" }
        let days = Int((diff / 86400).rounded())
        if days == 1 { return "Starts tomorrow" }
        if days < 30 { return "Starts in \(days) days" }
        let months = Int((Double(days) / 30).rounded())
        return "Starts in \(months) month\(months > 1 ? "s" : "")"
    }

    static func isUpcoming(_ value: String) -> Bool {
        guard let date = parse(value) else { return false }
        return date > Date()
    }

    /// "Today", "Yesterday", else "Monday, January 5, 2026" — Activity's day headings.
    static func dayLabel(_ value: String) -> String {
        guard let date = parse(value) else { return value }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        return longDate(value)
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
