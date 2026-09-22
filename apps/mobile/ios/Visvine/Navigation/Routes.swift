import Foundation

/// Tabs (Home / Messages / Activity).
enum MainTab: Hashable {
    case home, messages, activity

    /// Map an OAuth pending-route hint ("Messages"/"Activity", or the older
    /// "Directory"/"Events") to a tab. Anything else lands on Home.
    static func from(pendingRoute name: String?) -> MainTab {
        switch name?.lowercased() {
        case "messages": return .messages
        case "activity": return .activity
        default: return .home
        }
    }
}

/// Detail screens pushed within a tab's NavigationStack.
enum AppRoute: Hashable {
    case fullProfile(personId: String, name: String?)
    case eventDetail(eventId: String, title: String?)
    case conversation(id: String, name: String?)
    /// A standing chat with one of the space's agents.
    case agentChat(spaceId: String, agentName: String, title: String)
    /// The people picker that opens a DM.
    case newMessage
    /// The Directory and Events screens, reached from Home.
    case people
    case events
}

/// Pushes within the Profile modal stack.
enum ProfileRoute: Hashable {
    case edit
    case settings
}
