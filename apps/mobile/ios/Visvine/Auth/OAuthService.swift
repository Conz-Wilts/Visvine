import AuthenticationServices
import CryptoKit
import Security
import UIKit

/// A PKCE pair (RFC 7636): the verifier never leaves the app; the challenge
/// travels through the browser. The server's half is apps/web/lib/auth/handoff.ts.
struct PKCE {
    let verifier: String
    let challenge: String

    static func make() -> PKCE {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let verifier = Data(bytes).base64URLEncoded()
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return PKCE(verifier: verifier, challenge: Data(digest).base64URLEncoded())
    }
}

private extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Launches Google OAuth in an ASWebAuthenticationSession. The server-mediated
/// code exchange happens at `/api/auth/callback/google-mobile`, which redirects
/// to `visvine://auth/callback?handoff=…&state=…`; the session intercepts that
/// URL and returns it, so the caller hands it to `AuthManager.handleDeepLink`,
/// which redeems the handoff with the verifier it kept.
final class OAuthService: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func start(challenge: String, nonce: String, onCallback: @escaping (URL?) -> Void) {
        let session = ASWebAuthenticationSession(
            url: authURL(challenge: challenge, nonce: nonce),
            callbackURLScheme: AppConfig.deepLinkScheme
        ) { callbackURL, _ in
            onCallback(callbackURL)
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        session.start()
        self.session = session
    }

    private func authURL(challenge: String, nonce: String) -> URL {
        let stateObject: [String: String] = [
            "state": nonce,
            "challenge": challenge,
            "callbackUrl": "/directory",
        ]
        let stateJSON = (try? JSONSerialization.data(withJSONObject: stateObject))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: AppConfig.googleClientID),
            URLQueryItem(name: "redirect_uri", value: "\(AppConfig.apiBase)/api/auth/callback/google-mobile"),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "state", value: stateJSON),
        ]
        return components.url!
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return window }
        return ASPresentationAnchor(windowScene: scenes.first!)
    }
}
