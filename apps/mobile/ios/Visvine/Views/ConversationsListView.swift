import SwiftUI
import Observation

@Observable
@MainActor
final class ConversationsModel {
    var conversations: [Conversation] = []
    var loading = true
    var refreshing = false
    var error: String?

    private let repo = MessagesRepository()

    func load() async {
        loading = true
        await fetch()
        loading = false
    }
    func refresh() async { await fetch() }

    private func fetch() async {
        switch await repo.getConversations() {
        case .success(let list): conversations = list; error = nil
        case .failure(let m): error = m
        }
    }

    func startRealtime() async {
        for await event in repo.realtimeEvents() {
            if event.type == "message.new" || event.type == "conversation.updated" {
                await fetch()
            }
        }
    }

    func displayName(_ c: Conversation, userId: String?) -> String {
        let other = c.participants.first { $0.id != userId }
        return c.type == "GROUP" ? c.name : (other?.name ?? "Unknown")
    }

    func filtered(query: String, userId: String?) -> [Conversation] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        if needle.isEmpty { return conversations }
        return conversations.map { ($0, searchScore(needle, displayName($0, userId: userId))) }
            .filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.map { $0.0 }
    }
}

/// Every conversation you are in, as rows on hairlines.
struct ConversationsListView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(SearchStore.self) private var search
    @State private var model = ConversationsModel()

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(showSpaceSelector: false, onProfile: onProfile)
            if let error = model.error {
                Text(error).foregroundStyle(c.danger).font(.system(size: VVFontSize.s14))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x3)
            }
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                let items = model.filtered(query: search.query, userId: auth.user?.id)
                if items.isEmpty {
                    EmptyStateView(
                        text: search.query.isEmpty ? "No messages yet" : "No conversations found",
                        icon: .message
                    )
                    .frame(maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(items) { conversation in
                                let name = model.displayName(conversation, userId: auth.user?.id)
                                NavigationLink(value: AppRoute.conversation(id: conversation.id, name: name)) {
                                    ConversationRow(conversation: conversation, name: name)
                                }
                                .buttonStyle(.plain)
                                Hairline()
                            }
                        }
                    }
                    .refreshable { await model.refresh() }
                }
            }
        }
        .background(c.surface)
        .task { await model.load() }
        .task { await model.startRealtime() }
    }

}
