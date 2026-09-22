import Foundation

/// One channel the feed draws from — mirrors lib/messages/shared/feed.ts `FeedPlace`.
struct NamedRef: Codable, Hashable {
    let id: String
    var name: String
}

struct FeedPlace: Codable {
    let conversationId: String
    var channel: NamedRef
    var space: NamedRef
}

/// A post and its comments — mirrors `FeedPost`. The message is the same
/// `SerializedMessage` subset the conversations screens decode.
struct FeedPost: Codable, Identifiable {
    var id: String { message.id }
    let conversationId: String
    var channel: NamedRef
    var space: NamedRef
    var message: Message
    var comments: [Message]
}

/// GET /api/feed?spaceId=&cursor=&limit= — mirrors `FeedPage`.
struct FeedPage: Codable {
    var posts: [FeedPost]
    var nextCursor: String?
    /// The channels the viewer may post into. First page only.
    var targets: [FeedPlace]?
}
