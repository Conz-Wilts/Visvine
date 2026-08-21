import SwiftUI

/// Sign in — the mark, one line of purpose, and the Google button.
struct LoginView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @State private var oauth = OAuthService()

    var body: some View {
        let c = theme.colors
        NavigationStack {
            VStack(spacing: 0) {
                Spacer()
                VisvineIcon(.network, size: 56).foregroundStyle(c.accent)
                Text("Visvine").font(.system(size: 34, weight: .bold)).foregroundStyle(c.textPrimary).padding(.top, 16)
                Text("Connect with your space").font(.system(size: 16)).foregroundStyle(c.textMuted).padding(.top, 8)

                if let error = auth.authErrorMessage {
                    Text(error).font(.system(size: 14)).foregroundStyle(c.error)
                        .multilineTextAlignment(.center).padding(.top, 16).padding(.horizontal, 24)
                }

                Button(action: signIn) {
                    Text("Continue with Google")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(c.accent, in: RoundedRectangle(cornerRadius: 8))
                }
                .padding(.top, 48)

                if AppConfig.devAuthEnabled {
                    NavigationLink {
                        DevLoginView()
                    } label: {
                        HStack {
                            VisvineIcon(.tool)
                            Text("Dev login (skip Google)").font(.system(size: 14, weight: .semibold))
                        }
                        .foregroundStyle(c.textSecondary)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(c.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .padding(.top, 12)
                }

                Text("By signing in, you agree to our Terms of Service and Privacy Policy")
                    .font(.system(size: 12)).foregroundStyle(c.textMuted)
                    .multilineTextAlignment(.center).padding(.top, 32).padding(.horizontal, 16)
                Spacer()
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(c.bgPrimary)
        }
    }

    private func signIn() {
        auth.clearAuthError()
        oauth.start { url in
            if let url { auth.handleDeepLink(url) }
        }
    }
}
