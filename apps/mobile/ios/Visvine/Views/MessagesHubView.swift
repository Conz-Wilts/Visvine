import SwiftUI
import Observation

@Observable
@MainActor
final class AgentsListModel {
    var agents: [ChatAgentRow] = []
    var loading = true
    var error: String?

    private let repo = AgentsRepository()
    private var loadedFor: String?

    func load(spaceId: String?) async {
        guard let spaceId else { agents = []; loading = false; return }
        loading = loadedFor != spaceId
        loadedFor = spaceId
        switch await repo.listAgents(spaceId: spaceId) {
        case .success(let list): agents = list; error = nil
        case .failure(let m): error = m
        }
        loading = false
    }
}

/// Messages: the space's agents as threads, and the people you talk to
/// (docs/mobile.md § Messages). One header, a segmented nav, one list.
struct MessagesHubView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(AuthManager.self) private var auth
    @Environment(SearchStore.self) private var search
    @State private var agents = AgentsListModel()
    @State private var conversations = ConversationsModel()
    @State private var segment = 0

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(title: "Messages", onProfile: onProfile)
            HStack(spacing: 0) {
                SegmentedNav(items: ["Agents", "Contacts"], selected: $segment)
                if segment == 1 {
                    NavigationLink(value: AppRoute.newMessage) {
                        VisvineIcon(.personAdd, size: 20).foregroundStyle(c.accent)
                            .frame(width: 40, height: 40)
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 12)
                }
            }
            if segment == 0 { agentsList } else { contactsList }
        }
        .background(c.bgPrimary)
        .task(id: space.current?.id) { await agents.load(spaceId: space.current?.id) }
        .task { await conversations.load() }
        .task { await conversations.startRealtime() }
    }

    @ViewBuilder private var agentsList: some View {
        let c = theme.colors
        if let error = agents.error {
            Text(error).foregroundStyle(c.error).font(.system(size: 14))
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 12)
        }
        if agents.loading {
            ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if agents.agents.isEmpty {
            EmptyStateView(text: "No agents in this space", icon: .bot).frame(maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(agents.agents) { agent in
                        if let spaceId = space.current?.id {
                            NavigationLink(value: AppRoute.agentChat(spaceId: spaceId, agentName: agent.name, title: agent.title)) {
                                AgentRow(agent: agent)
                            }
                            .buttonStyle(.plain)
                            Hairline()
                        }
                    }
                    Color.clear.frame(height: 96)
                }
            }
            .refreshable { await agents.load(spaceId: space.current?.id) }
        }
    }

    @ViewBuilder private var contactsList: some View {
        let c = theme.colors
        if let error = conversations.error {
            Text(error).foregroundStyle(c.error).font(.system(size: 14))
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 12)
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

/// One agent as a thread: its mark, its name, the last line, when.
private struct AgentRow: View {
    @Environment(ThemeStore.self) private var theme
    let agent: ChatAgentRow

    var body: some View {
        let c = theme.colors
        let unread = agent.thread?.unread == true
        HStack(spacing: 12) {
            PersonAvatar(name: agent.title, size: 48, glyph: .bot)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(agent.title).font(.system(size: 16, weight: unread ? .bold : .semibold)).foregroundStyle(c.textPrimary).lineLimit(1)
                    if agent.answering {
                        Circle().fill(c.accent).frame(width: 8, height: 8)
                    } else if !agent.ready {
                        Circle().fill(c.textLight).frame(width: 8, height: 8)
                    }
                    Spacer()
                    if let at = agent.thread?.lastMessageAt {
                        Text(DateFormatting.relativeShort(at)).font(.system(size: 12)).foregroundStyle(c.textMuted)
                    }
                }
                Text(agent.thread?.lastPreview ?? agent.description ?? "No messages yet")
                    .font(.system(size: 14)).foregroundStyle(unread ? c.textPrimary : c.textMuted).lineLimit(1)
            }
        }
        .padding(16)
        .contentShape(Rectangle())
    }
}
