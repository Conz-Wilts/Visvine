import SwiftUI

/// Hosts the three tabs — Home, Messages, Activity (docs/mobile.md) — the
/// system tab bar, the space sidebar, and the Profile modal. Each tab
/// is its own NavigationStack so detail screens push within the tab; the
/// Directory and Events screens are pushed from Home rather than being tabs.
struct MainTabView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(SpaceStore.self) private var space

    @State private var selected: MainTab = .home
    @State private var profilePresented = false
    @State private var discoverPresented = false

    // The system tab bar, so it sits where iOS puts it and its glass takes a
    // press-and-drag across tabs.
    var body: some View {
        TabView(selection: $selected) {
            Tab("Home", image: VisvineIconName.home.rawValue, value: MainTab.home) {
                stack { HomeView(onProfile: { profilePresented = true }) }
            }
            Tab("Messages", image: VisvineIconName.message.rawValue, value: MainTab.messages) {
                stack { MessagesHubView(onProfile: { profilePresented = true }) }
            }
            Tab("Activity", image: VisvineIconName.bell.rawValue, value: MainTab.activity) {
                stack { ActivityView(onProfile: { profilePresented = true }) }
            }
        }
        .tint(theme.colors.accent)
        .overlay(alignment: .topLeading) {
            if space.switcherOpen {
                SpaceSidebar(
                    onDiscover: { discoverPresented = true },
                    onSettings: { profilePresented = true }
                )
            }
        }
        .sheet(isPresented: $discoverPresented) {
            stack { DiscoverView(onProfile: { discoverPresented = false; profilePresented = true }) }
                .environment(theme)
                .environment(space)
        }
        .task(id: auth.user?.id) { await space.refresh() }
        .onAppear { applyPendingRoute() }
        .onChange(of: auth.pendingRoute) { _, _ in applyPendingRoute() }
        .fullScreenCover(isPresented: $profilePresented) {
            // Re-inject environment — presented covers don't reliably inherit it.
            ProfileFlow()
                .environment(theme)
                .environment(auth)
                .environment(space)
        }
    }

    private func stack(@ViewBuilder _ root: () -> some View) -> some View {
        NavigationStack {
            root().navigationDestination(for: AppRoute.self, destination: destination)
        }
    }

    @ViewBuilder private func destination(_ route: AppRoute) -> some View {
        switch route {
        case let .fullProfile(personId, name):
            FullProfileView(personId: personId, initialName: name)
        case let .eventDetail(eventId, title):
            EventDetailView(eventId: eventId, title: title)
        case let .conversation(id, name):
            ConversationView(conversationId: id, conversationName: name)
        case let .agentChat(spaceId, agentName, title):
            AgentChatView(spaceId: spaceId, agentName: agentName, title: title)
        case .newMessage:
            NewMessageView()
        case .people:
            DirectoryView(onProfile: { profilePresented = true })
        case .events:
            EventsListView(onProfile: { profilePresented = true })
        case let .contextFolder(node):
            ContextFolderView(node: node)
        case let .contextNote(path, title):
            ContextNoteView(path: path, title: title)
        }
    }

    private func applyPendingRoute() {
        if let route = auth.pendingRoute {
            selected = MainTab.from(pendingRoute: route)
            auth.clearPendingRoute()
        }
    }
}

/// The Profile modal as its own NavigationStack (Profile → Edit / Settings).
private struct ProfileFlow: View {
    var body: some View {
        NavigationStack {
            ProfileView()
                .navigationDestination(for: ProfileRoute.self) { route in
                    switch route {
                    case .edit: EditProfileView()
                    case .settings: SettingsView()
                    }
                }
        }
    }
}
