import Foundation

struct MessageSender: Codable {
    let id: String
    var name: String
    var image: String?
}

/// A single message. The server returns extra rich fields which Codable ignores.
struct Message: Codable, Identifiable {
    let id: String
    var text: String
    var attachmentUrl: String?
    var createdAt: String
    var sender: MessageSender
    var isOwn: Bool
}

struct ConversationParticipant: Codable, Identifiable {
    let id: String
    var name: String
    var email: String?
    var image: String?
    var role: String?
    var lastReadAt: String?
}

struct Conversation: Codable, Identifiable {
    let id: String
    var type: String
    var name: String
    var avatarUrl: String?
    var participants: [ConversationParticipant]
    var lastMessage: Message?
    var unreadCount: Int
    var updatedAt: String?
}

struct ConversationsResponse: Codable {
    let conversations: [Conversation]
}

/// GET …/messages → cursor-paginated page.
struct MessagesPage: Codable {
    var conversation: Conversation?
    var messages: [Message]
    var nextCursor: String?
    var hasMore: Bool?
}

struct SendMessageRequest: Codable {
    let text: String
}

/// POST /api/messages/conversations → the DM with one person, made on first use.
struct CreateDmRequest: Codable {
    let userId: String
}

struct CreateDmResponse: Codable {
    let conversation: Conversation
}

/// GET /api/messages/users?query= — the people picker (email is never sent).
struct UsersSearchResponse: Codable {
    let users: [MessageSender]
}
