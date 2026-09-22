import SwiftUI

/// Hosts the three tabs — Home, Messages, Discover (docs/mobile.md) — the
/// system tab bar with create, the space sidebar, and the
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

    /// The create tab is never selected: choosing it opens the sheet.
    private var selection: Binding<MainTab> {
        Binding(get: { selected }, set: { tab in
            if tab == .create { createPresented = true } else { selected = tab }
        })
    }

    // The system tab bar, so it sits where iOS puts it and its glass takes a
    // press-and-drag across tabs. Create rides the search slot: its own circle.
    var body: some View {
        TabView(selection: selection) {
            Tab("Home", systemImage: "house", value: MainTab.home) {
                stack { HomeView(onProfile: { profilePresented = true }) }
            }
            Tab("Messages", systemImage: "bubble.left", value: MainTab.messages) {
                stack { MessagesHubView(onProfile: { profilePresented = true }) }
            }
            Tab("Discover", systemImage: "safari", value: MainTab.discover) {
                stack { DiscoverView(onProfile: { profilePresented = true }) }
            }
            Tab(value: MainTab.create, role: .search) {
                Color.clear
            } label: {
                Label("Create", systemImage: "plus")
            }
        }
        .tint(theme.colors.accent)
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
