import SwiftUI

/// Hosts the three tabs — Home, Messages, Discover (docs/mobile.md) — the
/// floating glass tab bar with create and search, the space sidebar, and the
/// Profile modal. Each tab
/// is its own NavigationStack so detail screens push within the tab; the
/// Directory and Events screens are pushed from Home rather than being tabs.
struct MainTabView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(SpaceStore.self) private var space

    @State private var selected: MainTab = .home
    @State private var profilePresented = false
    @State private var createPresented = false

    var body: some View {
        ZStack(alignment: .bottom) {
            tabContent
            GlassTabBar(selected: $selected, onCreate: { createPresented = true })
        }
        .overlay(alignment: .topLeading) {
            if space.switcherOpen {
                SpaceSidebar(
                    onDiscover: { selected = .discover },
                    onSettings: { profilePresented = true }
                )
            }
        }
        .sheet(isPresented: $createPresented) {
            CreateSheet()
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
