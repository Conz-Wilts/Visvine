import AuthenticationServices
import UIKit

/// Launches Google OAuth in an ASWebAuthenticationSession. The server-mediated
/// code exchange happens at `/api/auth/callback/google-mobile`, which redirects
/// to `visvine://auth/callback?token=…`; the session intercepts that URL and
/// returns it, so the caller hands it to `AuthManager.handleDeepLink`.
final class OAuthService: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func start(onCallback: @escaping (URL?) -> Void) {
        let session = ASWebAuthenticationSession(
            url: authURL(),
            callbackURLScheme: AppConfig.deepLinkScheme
        ) { callbackURL, _ in
            onCallback(callbackURL)
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        session.start()
        self.session = session
    }

    private func authURL() -> URL {
        let stateObject: [String: String] = [
            "state": UUID().uuidString,
            "redirectUri": "\(AppConfig.deepLinkScheme)://auth/callback",
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
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        return window ?? ASPresentationAnchor()
    }
}
