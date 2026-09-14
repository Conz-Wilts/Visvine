import Foundation

/// Tenant space — mirrors the web API's `Space` DTO (server truth).
struct Space: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    var description: String?
    var imageUrl: String?
    var image: String?
}

struct SpacesResponse: Codable {
    let spaces: [Space]
}
