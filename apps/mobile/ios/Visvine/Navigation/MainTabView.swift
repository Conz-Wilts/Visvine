import SwiftUI

/// Hosts the three tabs — Home, Messages, Tools (docs/mobile.md) — the
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
    @State private var discoverPresented = false

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
            Tab("Tools", systemImage: "square.grid.2x2", value: MainTab.tools) {
                stack { ToolsView(onProfile: { profilePresented = true }) }
            }
            Tab(value: MainTab.create, role: .search) {
                Color.clear
            } label: {
                Label { Text("Create") } icon: {
                    Image(uiImage: createIcon).renderingMode(.original)
                }
            }
        }
        .tint(theme.colors.accent)
        // The search slot always draws its own white glass disc, which no
        // tint or image can fill. The slot keeps the space; this solid
        // circle covers it and takes the press.
        .overlay(alignment: .bottomTrailing) {
            Button { createPresented = true } label: {
                Image(uiImage: createIcon)
                    .resizable()
                    .frame(width: 64, height: 64)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Create")
            .padding(.trailing, 20)
            .padding(.bottom, 20)
            .ignoresSafeArea()
        }
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

    /// The create button is a solid accent circle with a white cross. Drawn
    /// as an original-colour image, because the tab bar tints a symbol.
    private var createIcon: UIImage {
        let side: CGFloat = 64
        let accent = UIColor(theme.colors.accent)
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
            accent.setFill()
            UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: side, height: side)).fill()
            let arm: CGFloat = 13, mid = side / 2
            let cross = UIBezierPath()
            cross.move(to: CGPoint(x: mid - arm, y: mid)); cross.addLine(to: CGPoint(x: mid + arm, y: mid))
            cross.move(to: CGPoint(x: mid, y: mid - arm)); cross.addLine(to: CGPoint(x: mid, y: mid + arm))
            cross.lineWidth = 4
            cross.lineCapStyle = .round
            UIColor.white.setStroke()
            cross.stroke()
        }.withRenderingMode(.alwaysOriginal)
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
