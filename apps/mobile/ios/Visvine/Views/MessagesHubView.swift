import SwiftUI

/// Messages: your direct conversations with people from any space
/// (docs/mobile.md § Messages). One header, one list.
struct MessagesHubView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(SearchStore.self) private var search
    @State private var conversations = ConversationsModel()

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(onProfile: onProfile)
            HStack {
                Spacer()
                NavigationLink(value: AppRoute.newMessage) {
                    VisvineIcon(.personAdd, size: 20).foregroundStyle(c.accent)
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("New message")
                .padding(.trailing, VVSpace.x3)
            }
            contactsList
        }
        .background(c.surface)
        .searchScope("Search messages")
        .task { await conversations.load() }
        .task { await conversations.startRealtime() }
    }

    @ViewBuilder private var contactsList: some View {
        let c = theme.colors
        if let error = conversations.error {
            Text(error).foregroundStyle(c.danger).font(.system(size: VVFontSize.s14))
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x3)
        }
        if conversations.loading {
            ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            let items = conversations.filtered(query: search.query, userId: auth.user?.id).filter { $0.type == "DM" }
            if items.isEmpty {
                EmptyStateView(text: search.query.isEmpty ? "No messages yet" : "No conversations found", icon: .message)
                    .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(items) { conversation in
                            let name = conversations.displayName(conversation, userId: auth.user?.id)
                            NavigationLink(value: AppRoute.conversation(id: conversation.id, name: name)) {
                                ConversationRow(conversation: conversation, name: name)
                            }
                            .buttonStyle(.plain)
                            Hairline()
                        }
                        Color.clear.frame(height: 96)
                    }
                }
                .refreshable { await conversations.refresh() }
            }
        }
    }
}
