import Foundation

/// Token lifecycle + session retrieval. Mirrors AuthContext: restore-on-launch →
/// getSession → clear-on-401.
struct AuthRepository {
    private let api = APIClient.shared
    private let tokenStore = KeychainTokenStore.shared

    var savedToken: String? { tokenStore.token }
    func saveToken(_ token: String) { tokenStore.save(token) }
    func clearToken() { tokenStore.clear() }

    func getSession() async -> APIResult<User> {
        let res: APIResult<SessionResponse> = await api.request("/api/auth/session")
        switch res {
        case .success(let response):
            if var user = response.session?.user {
                user.image = MediaURL.resolve(user.image)
                return .success(user)
            }
            return .failure("No session")
        case .failure(let message):
            return .failure(message)
        }
    }

    /// Trades the handoff the browser returned for a session, proving with the
    /// verifier that this app is the one that started the sign-in.
    func redeemHandoff(_ handoff: String, verifier: String) async -> APIResult<String> {
        let body = try? JSONEncoder().encode(HandoffRequest(handoff: handoff, verifier: verifier))
        let res: APIResult<HandoffResponse> = await api.request("/api/auth/mobile/token", method: "POST", body: body)
        switch res {
        case .success(let r): return .success(r.token)
        case .failure(let m): return .failure(m)
        }
    }

    func signOut() async {
        let _: APIResult<EmptyResponse> = await api.request("/api/auth/signout", method: "POST")
    }

    func listDevUsers() async -> APIResult<[DevUser]> {
        let res: APIResult<DevUsersResponse> = await api.request("/api/dev/list-users")
        switch res {
        case .success(let r): return .success(r.users)
        case .failure(let m): return .failure(m)
        }
    }

    func issueDevToken(userId: String) async -> APIResult<IssueTokenResponse> {
        let body = try? JSONEncoder().encode(IssueTokenRequest(userId: userId))
        return await api.request("/api/dev/issue-token", method: "POST", body: body)
    }
}
