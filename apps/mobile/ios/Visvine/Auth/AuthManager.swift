import Foundation
import Observation

/// App-scoped session holder — the native equivalent of AuthContext. Owns the
/// restore-on-launch → getSession → clear-on-401 lifecycle, OAuth deep-link
/// parsing (success *and* error paths), and the pending-route hint used to land
/// the user on the right tab after sign-in.
@MainActor
@Observable
final class AuthManager {
    var user: User?
    var isLoading = true
    var isAuthenticated = false
    var pendingRoute: String?
    /// Set when an error deep link arrives; views observe to surface an alert.
    var authErrorMessage: String?

    private let repo = AuthRepository()
    private var handledURLs = Set<String>()
    /// The sign-in this app started: the verifier stays here, the nonce comes
    /// back on the return link, and a return that does not carry it is ignored.
    private var pendingSignIn: (verifier: String, nonce: String, startedAt: Date)?

    init() {
        Task { await checkSession() }
    }

    func checkSession() async {
        // No token means nothing to restore: show sign-in without a round trip.
        guard repo.savedToken != nil else { isLoading = false; return }
        switch await repo.getSession() {
        case .success(let u):
            user = u; isAuthenticated = true; isLoading = false
        case .failure(let message):
            // Only a server that answered may end the session; an unreachable
            // one keeps the token for the next launch.
            if message != APIClient.offlineMessage { repo.clearToken() }
            user = nil; isAuthenticated = false; isLoading = false
        }
    }

    /// Used by the dev-login path: set the user and persist its token directly.
    func setUser(_ user: User?, token: String?) {
        if let token { repo.saveToken(token) }
        self.user = user
        isAuthenticated = user != nil
        isLoading = false
    }

    func logout() {
        Task {
            await repo.signOut()
            repo.clearToken()
            handledURLs.removeAll()
            user = nil; isAuthenticated = false; isLoading = false
        }
    }

    /// Starts a sign-in: the challenge and nonce go to the browser, the
    /// verifier stays in memory until the handoff comes back.
    func beginSignIn() -> (challenge: String, nonce: String) {
        let pkce = PKCE.make()
        let nonce = UUID().uuidString
        pendingSignIn = (pkce.verifier, nonce, Date())
        return (pkce.challenge, nonce)
    }

    func clearPendingRoute() { pendingRoute = nil }
    func clearAuthError() { authErrorMessage = nil }

    /// Handle a visvine:// deep link. Faithful port of AuthContext.handleDeepLink,
    /// extended to cover the error callback (`visvine://auth/error?error=…`).
    func handleDeepLink(_ url: URL) {
        let key = url.absoluteString
        if handledURLs.contains(key) { return }
        guard url.host == "auth" else { return }
        let segment = url.lastPathComponent
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func query(_ name: String) -> String? { items.first { $0.name == name }?.value }

        switch segment {
        case "error":
            handledURLs.insert(key)
            authErrorMessage = query("message") ?? message(forError: query("error"))
            isLoading = false

        case "callback":
            guard let handoff = query("handoff"),
                  let pending = pendingSignIn,
                  query("state") == pending.nonce,
                  Date().timeIntervalSince(pending.startedAt) < 600
            else { return }
            handledURLs.insert(key)
            pendingSignIn = nil
            let callbackURL = query("callbackUrl")
            isLoading = true
            Task {
                switch await repo.redeemHandoff(handoff, verifier: pending.verifier) {
                case .success(let token):
                    repo.saveToken(token)
                case .failure(let message):
                    authErrorMessage = message; isLoading = false
                    return
                }
                switch await repo.getSession() {
                case .success(let u):
                    pendingRoute = route(fromCallback: callbackURL)
                    user = u; isAuthenticated = true; isLoading = false
                case .failure:
                    repo.clearToken(); user = nil; isAuthenticated = false; isLoading = false
                }
            }

        default:
            break
        }
    }

    // Decode callbackUrl ("/directory") → tab name ("Directory"), matching AuthContext.
    private func route(fromCallback callbackURL: String?) -> String {
        let decoded = callbackURL?.removingPercentEncoding ?? "/directory"
        let route = decoded.hasPrefix("/") ? String(decoded.dropFirst()) : decoded
        guard let first = route.first else { return "Directory" }
        return first.uppercased() + route.dropFirst()
    }

    private func message(forError code: String?) -> String {
        switch code {
        // The web-only claim path can't complete on mobile (see google-mobile route).
        case "account_claim_required": return "Please sign in on web first to claim your account"
        case "update_required": return "Update Visvine to sign in"
        default: return "Sign in failed. Please try again."
        }
    }
}
