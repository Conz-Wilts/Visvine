import Foundation

/// Tabs (Home / Messages / Discover).
enum MainTab: Hashable {
    case home, messages, discover

    /// Map an OAuth pending-route hint ("Messages"/"Discover") to a tab. Anything else lands on Home.
    static func from(pendingRoute name: String?) -> MainTab {
        switch name?.lowercased() {
        case "messages": return .messages
        case "discover": return .discover
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
    /// A folder of the space's context, and one note of it.
    case contextFolder(ContextNode)
    case contextNote(path: String, title: String)
}

/// Pushes within the Profile modal stack.
enum ProfileRoute: Hashable {
    case edit
    case settings
}
