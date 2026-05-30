import Foundation

/// Tabs (Directory / Messages / Events).
enum MainTab: Hashable {
    case directory, messages, events

    /// Map an OAuth pending-route hint ("Directory"/"Messages"/"Events") to a tab.
    static func from(pendingRoute name: String?) -> MainTab {
        switch name?.lowercased() {
        case "messages": return .messages
        case "events": return .events
        default: return .directory
        }
    }
}

/// Detail screens pushed within a tab's NavigationStack.
enum AppRoute: Hashable {
    case fullProfile(personId: String, name: String?)
    case eventDetail(eventId: String, title: String?)
    case conversation(id: String, name: String?)
}

/// Pushes within the Profile modal stack.
enum ProfileRoute: Hashable {
    case edit
    case settings
}
