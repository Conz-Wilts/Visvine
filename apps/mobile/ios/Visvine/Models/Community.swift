import Foundation

/// Tenant community — mirrors the web API's `Community` DTO (server truth).
struct Community: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    var description: String?
    var imageUrl: String?
    var image: String?
}

struct CommunitiesResponse: Codable {
    let communities: [Community]
}
