import Foundation

/// Authenticated user — mirrors src/types/index.ts `User`.
struct User: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var email: String
    var image: String?
    var nodeId: String?
    var isSuperAdmin: Bool?
}

/// GET /api/auth/session → { session: { user } | null }
struct SessionResponse: Codable {
    let session: SessionPayload?
}

struct SessionPayload: Codable {
    let user: User?
}

/// A seeded user offered by the dev-login path.
struct DevUser: Codable, Identifiable {
    let id: String
    let name: String
    let email: String
    let image: String?
}

struct DevUsersResponse: Codable {
    let users: [DevUser]
}

struct IssueTokenRequest: Codable {
    let userId: String
}

struct IssueTokenResponse: Codable {
    let token: String
    let user: DevUser
}
