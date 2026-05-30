import Foundation

/// Directory member — a Node row from /api/data/nodes, reused for /api/profile/[id].
/// Mirrors src/types/index.ts `DirectoryMember` (note snake_case wire fields).
struct DirectoryMember: Codable, Identifiable {
    let id: String
    var name: String
    var type: String
    var subtitle: String?
    var imageUrl: String?
    var location: String?
    var tags: [String]?
    var communityId: String?
    var title: String?
    var company: String?
    var email: String?

    enum CodingKeys: String, CodingKey {
        case id, name, type, subtitle, location, tags, title, company, email
        case imageUrl = "image_url"
        case communityId = "community_id"
    }
}

struct NodesResponse: Codable {
    let nodes: [DirectoryMember]
}

/// Partial profile patch sent by the edit screen (PATCH /api/profile/[id]).
struct ProfileUpdate: Codable {
    var name: String?
    var title: String?
    var company: String?
    var location: String?
}
