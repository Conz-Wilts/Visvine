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
                Wordmark(size: 30, stacked: true)

                if let error = auth.authErrorMessage {
                    Text(error).font(.system(size: VVFontSize.s14)).foregroundStyle(c.danger)
                        .multilineTextAlignment(.center).padding(.top, VVSpace.x4).padding(.horizontal, VVSpace.x6)
                }

                Button(action: signIn) {
                    Text("Continue with Google")
                        .font(.system(size: VVFontSize.s16, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, VVSpace.x4)
                        .background(c.accent, in: RoundedRectangle(cornerRadius: VVRadius.lg))
                }
                .padding(.top, VVSpace.x12)

                if AppConfig.devAuthEnabled {
                    NavigationLink {
                        DevLoginView()
                    } label: {
                        HStack {
                            VisvineIcon(.tool)
                            Text("Dev login (skip Google)").font(.system(size: VVFontSize.s14, weight: .semibold))
                        }
                        .foregroundStyle(c.fgSecondary)
                        .frame(maxWidth: .infinity).padding(.vertical, VVSpace.x3_5)
                        .background(c.surfaceSubtle, in: RoundedRectangle(cornerRadius: VVRadius.lg))
                    }
                    .padding(.top, VVSpace.x3)
                }

                Text("By signing in, you agree to our Terms of Service and Privacy Policy")
                    .font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgMuted)
                    .multilineTextAlignment(.center).padding(.top, VVSpace.x8).padding(.horizontal, VVSpace.x4)
                Spacer()
            }
            .padding(.horizontal, VVSpace.x6)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(c.surface)
        }
    }

    private func signIn() {
        auth.clearAuthError()
        oauth.start { url in
            if let url { auth.handleDeepLink(url) }
        }
    }
}
