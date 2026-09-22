import SwiftUI

/// Hosts the three tabs — Home, Messages, Discover (docs/mobile.md) — the
/// floating glass tab bar, the search overlay, and the Profile modal. Each tab
/// is its own NavigationStack so detail screens push within the tab; the
/// Directory and Events screens are pushed from Home rather than being tabs.
struct MainTabView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(SpaceStore.self) private var space
    @Environment(SearchStore.self) private var search

    @State private var selected: MainTab = .home
    @State private var profilePresented = false

    var body: some View {
        ZStack(alignment: .bottom) {
            tabContent
            GlassTabBar(selected: $selected, onSearch: { search.open() })
            SearchOverlay()
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

    @ViewBuilder private var tabContent: some View {
        switch selected {
        case .home:
            NavigationStack {
                HomeView(onProfile: { profilePresented = true })
                    .navigationDestination(for: AppRoute.self, destination: destination)
            }
        case .messages:
            NavigationStack {
                MessagesHubView(onProfile: { profilePresented = true })
                    .navigationDestination(for: AppRoute.self, destination: destination)
            }
        case .discover:
            NavigationStack {
                DiscoverView(onProfile: { profilePresented = true })
                    .navigationDestination(for: AppRoute.self, destination: destination)
            }
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
