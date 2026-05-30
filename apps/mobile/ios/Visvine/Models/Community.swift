import Foundation

/// Tenant community — mirrors docs/native-migration/api-contract.md `Community`.
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
