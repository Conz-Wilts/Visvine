import SwiftUI
import Observation

@Observable
@MainActor
final class NewMessageModel {
    var people: [MessageSender] = []
    var loading = false
    var opening: String?
    var error: String?

    private let repo = MessagesRepository()

    func search(_ query: String) async {
        loading = true
        switch await repo.searchUsers(query: query) {
        case .success(let list): people = list; error = nil
        case .failure(let m): error = m
        }
        loading = false
    }

    func open(_ person: MessageSender) async -> Conversation? {
        opening = person.id
        defer { opening = nil }
        switch await repo.createDm(userId: person.id) {
        case .success(let conversation): return conversation
        case .failure(let m): error = m; return nil
        }
    }
}

/// Who to message: the people you share a space with, by name. Tapping one
/// opens (or makes) the DM.
struct NewMessageView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @State private var model = NewMessageModel()
    @State private var query = ""
    @State private var opened: Conversation?

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            HStack(spacing: VVSpace.x2_5) {
                VisvineIcon(.search, size: 16).foregroundStyle(c.fgMuted)
                TextField("Search people", text: $query)
                    .foregroundStyle(c.fg)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, VVSpace.x3_5).frame(height: 40)
            .background(c.surfaceMuted, in: RoundedRectangle(cornerRadius: VVRadius.xl, style: .continuous))
            .padding(VVSpace.x4)

            if let error = model.error {
                Text(error).foregroundStyle(c.danger).font(.system(size: VVFontSize.s14))
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, VVSpace.x4).padding(.bottom, VVSpace.x2)
            }
            if model.loading && model.people.isEmpty {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.people.isEmpty {
                EmptyStateView(text: query.isEmpty ? "Nobody to message yet" : "No one by that name", icon: .people)
                    .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        Hairline()
                        ForEach(model.people, id: \.id) { person in
                            Button {
                                Task { if let conversation = await model.open(person) { opened = conversation } }
                            } label: {
                                HStack(spacing: VVSpace.x3) {
                                    PersonAvatar(name: person.name, imageUrl: person.image, size: 40)
                                    Text(person.name).font(.system(size: VVFontSize.s16, weight: .medium)).foregroundStyle(c.fg)
                                    Spacer()
                                    if model.opening == person.id { ProgressView().tint(c.accent) }
                                }
                                .padding(.horizontal, VVSpace.x4).frame(height: 56)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Hairline()
                        }
                    }
                }
            }
        }
        .background(c.surface)
        .navigationTitle("New message")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await model.search(query)
        }
        .navigationDestination(item: $opened) { conversation in
            ConversationView(
                conversationId: conversation.id,
                conversationName: conversation.participants.first { $0.id != auth.user?.id }?.name ?? conversation.name
            )
        }
    }
}

extension Conversation: Hashable {
    static func == (lhs: Conversation, rhs: Conversation) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
