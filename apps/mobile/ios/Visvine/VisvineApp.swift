import SwiftUI

/// App entry point. The app-wide state the web app holds in nested React contexts
/// (theme → auth → space) lives here as app-scoped stores injected into the
/// environment. Also routes the visvine:// OAuth deep link into `AuthManager`.
@main
struct VisvineApp: App {
    @State private var theme = ThemeStore()
    @State private var auth: AuthManager
    @State private var space: SpaceStore
    @State private var search = SearchStore()
    @State private var killSwitch = KillSwitch()

    init() {
        let auth = AuthManager()
        _auth = State(initialValue: auth)
        _space = State(initialValue: SpaceStore(auth: auth))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(theme)
                .environment(auth)
                .environment(space)
                .environment(search)
                .environment(killSwitch)
                .onOpenURL { url in
                    auth.handleDeepLink(url)
                }
        }
    }
}
