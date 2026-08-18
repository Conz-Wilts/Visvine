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

/// Port of screens/Messaging/ConversationsListScreen.tsx.
struct ConversationsListView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(SearchStore.self) private var search
    @State private var model = ConversationsModel()

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(showCommunitySelector: false, onProfile: onProfile)
            if let error = model.error {
                Text(error).foregroundStyle(c.error).padding().frame(maxWidth: .infinity, alignment: .leading)
                    .background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 8)).padding(.horizontal, 16)
            }
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                let items = model.filtered(query: search.query, userId: auth.user?.id)
                if items.isEmpty {
                    VStack(spacing: 12) {
                        VisvineIcon(.message, size: 44).foregroundStyle(c.borderDefault)
                        Text(search.query.isEmpty ? "No messages yet" : "No conversations found").foregroundStyle(c.textMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(items) { conversation in
                                let name = model.displayName(conversation, userId: auth.user?.id)
                                NavigationLink(value: AppRoute.conversation(id: conversation.id, name: name)) {
                                    row(conversation, name: name)
                                }
                                .buttonStyle(.plain)
                                Divider().overlay(c.borderLight)
                            }
                        }
                    }
                    .refreshable { await model.refresh() }
                }
            }
        }
        .background(c.bgPrimary)
        .task { await model.load() }
        .task { await model.startRealtime() }
    }

    private func row(_ conversation: Conversation, name: String) -> some View {
        let c = theme.colors
        return HStack(spacing: 12) {
            ZStack {
                Circle().fill(c.accentLight)
                Text(name.prefix(1).uppercased()).font(.system(size: 18, weight: .semibold)).foregroundStyle(c.accentDark)
            }
            .frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(name).font(.system(size: 16, weight: .semibold)).foregroundStyle(c.textPrimary).lineLimit(1)
                    Spacer()
                    if let last = conversation.lastMessage {
                        Text(DateFormatting.relativeShort(last.createdAt)).font(.system(size: 12)).foregroundStyle(c.textMuted)
                    }
                }
                HStack {
                    let preview = conversation.lastMessage.map { "\($0.sender.name): \($0.text)" } ?? "No messages yet"
                    Text(preview).font(.system(size: 14)).foregroundStyle(c.textMuted).lineLimit(1)
                    Spacer()
                    if conversation.unreadCount > 0 {
                        Text("\(conversation.unreadCount)").font(.system(size: 12, weight: .semibold)).foregroundStyle(c.bgPrimary)
                            .padding(.horizontal, 8).padding(.vertical, 2).background(c.accent, in: Capsule())
                    }
                }
            }
        }
        .padding(16)
    }
}
