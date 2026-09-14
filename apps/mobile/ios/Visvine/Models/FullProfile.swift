import Foundation

/// Rich profile — mirrors src/types/index.ts `FullProfile`.
struct FullProfile: Codable, Identifiable {
    let id: String
    var spaceId: String?
    var name: String
    var subtitle: String?
    var bio: String?
    var location: String?
    var website: String?
    var linkedinUrl: String?
    var twitterUrl: String?
    var phone: String?
    var pronouns: String?
    var openToWork: Bool?
    var email: String?
    var imageUrl: String?
    var tags: [String]?
    var userId: String?
    var createdAt: String?
    var updatedAt: String?
}
