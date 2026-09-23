import SwiftUI

/// Top-level view. Pins the light appearance the web app is built in, then
/// gates the UI on (1) the remote kill-switch, (2) the auth-loading splash,
/// and (3) the authenticated/unauthenticated graph.
struct RootView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(KillSwitch.self) private var killSwitch

    var body: some View {
        let c = theme.colors
        ZStack {
            c.surface.ignoresSafeArea()

            switch killSwitch.state {
            case .disabled(let message):
                BlockingScreen(title: "Visvine is unavailable", message: message)
            case .updateRequired(let message):
                BlockingScreen(title: "Update required", message: message)
            case .operational:
                if auth.isLoading {
                    VStack(spacing: 28) {
                        Wordmark(size: 30, stacked: true)
                        ProgressView()
                    }
                } else if auth.isAuthenticated {
                    MainTabView()
                } else {
                    LoginView()
                }
            }
        }
        .preferredColorScheme(.light)
        .tint(c.accent)
    }
}

private struct BlockingScreen: View {
    @Environment(ThemeStore.self) private var theme
    let title: String
    let message: String

    var body: some View {
        let c = theme.colors
        VStack(spacing: VVSpace.x2) {
            Text(title).font(.system(size: VVFontSize.s20, weight: .bold)).foregroundStyle(c.fg)
            Text(message).font(.system(size: VVFontSize.s15)).foregroundStyle(c.fgMuted).multilineTextAlignment(.center)
        }
        .padding(VVSpace.x8)
    }
}
