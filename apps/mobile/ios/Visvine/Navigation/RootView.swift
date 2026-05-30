import SwiftUI

/// Top-level view. Applies the active color scheme, then gates the UI on
/// (1) the remote kill-switch, (2) the auth-loading splash, and (3) the
/// authenticated/unauthenticated graph — mirroring AppNavigator's switch.
struct RootView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(KillSwitch.self) private var killSwitch

    var body: some View {
        let c = theme.colors
        ZStack {
            c.bgSecondary.ignoresSafeArea()

            switch killSwitch.state {
            case .disabled(let message):
                BlockingScreen(title: "Visvine is unavailable", message: message)
            case .updateRequired(let message):
                BlockingScreen(title: "Update required", message: message)
            case .operational:
                if auth.isLoading {
                    LoadingView(message: "Signing you in…", fullScreen: true)
                } else if auth.isAuthenticated {
                    MainTabView()
                } else {
                    LoginView()
                }
            }
        }
        .preferredColorScheme(theme.isDark ? .dark : .light)
        .tint(c.accent)
    }
}

private struct BlockingScreen: View {
    @Environment(ThemeStore.self) private var theme
    let title: String
    let message: String

    var body: some View {
        let c = theme.colors
        VStack(spacing: 8) {
            Text(title).font(.system(size: 20, weight: .bold)).foregroundStyle(c.textPrimary)
            Text(message).font(.system(size: 15)).foregroundStyle(c.textMuted).multilineTextAlignment(.center)
        }
        .padding(32)
    }
}
