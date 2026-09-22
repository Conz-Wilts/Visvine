import Foundation

/// Tenant space — mirrors the web API's `Space` DTO (server truth).
struct Space: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    var description: String?
    var imageUrl: String?
    var image: String?
    var visibility: String?
}

struct SpacesResponse: Codable {
    let spaces: [Space]
}

/// One membership row — GET /api/user/spaces.
struct UserSpacesResponse: Codable {
    let spaces: [Space]
}

/// A publicly listed upcoming event — GET /api/events/discover.
struct DiscoverEvent: Codable, Identifiable {
    let id: String
    let slug: String
    let title: String
    var description: String?
    let startAt: String
    var locationLabel: String?
    var eventType: String?
    var coverImageUrl: String?
    var spaceName: String?
    var spaceImageUrl: String?
}

struct DiscoverEventsResponse: Codable {
    let events: [DiscoverEvent]
}

/// POST /api/spaces/<id>/join answers with the membership it wrote.
struct JoinResponse: Codable {
    struct Membership: Codable { var status: String? }
    var membership: Membership?
}
