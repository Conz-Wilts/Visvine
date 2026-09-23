import SwiftUI
import Observation

@Observable
@MainActor
final class AgentChatModel {
    var messages: [ChatMessage] = []
    var nextCursor: String?
    var loading = true
    var loadingOlder = false
    var sending = false
    /// The muted line under the thread while a turn works: "Working… search_context sso".
    var working: String?
    /// The agent's answer as it arrives, before `done` stores it.
    var live: String?
    var error: String?

    let spaceId: String
    let agentName: String
    private let repo = AgentsRepository()
    private var stream: Task<Void, Never>?

    init(spaceId: String, agentName: String) {
        self.spaceId = spaceId
        self.agentName = agentName
    }

    func load() async {
        switch await repo.getMessages(spaceId: spaceId, name: agentName) {
        case .success(let page):
            messages = page.messages.reversed()
            nextCursor = page.nextCursor
            error = nil
        case .failure(let m):
            error = m
        }
        loading = false
    }

    func loadOlder() async {
        guard let cursor = nextCursor, !loadingOlder else { return }
        loadingOlder = true
        if case .success(let page) = await repo.getMessages(spaceId: spaceId, name: agentName, cursor: cursor) {
            messages = page.messages.reversed() + messages
            nextCursor = page.nextCursor
        }
        loadingOlder = false
    }

    /// One message: shown at once as mine, answered as the stream says.
    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !sending else { return }
        sending = true
        error = nil
        working = "Working…"
        live = nil
        let optimisticId = "local-\(UUID().uuidString)"
        messages.append(ChatMessage(id: optimisticId, role: "user", text: trimmed, status: "done", reason: nil, trace: [], createdAt: ISO8601DateFormatter().string(from: Date())))
        stream = Task { [weak self] in
            guard let self else { return }
            do {
                for try await event in repo.send(spaceId: spaceId, name: agentName, text: trimmed) {
                    switch event {
                    case .user(let stored):
                        if let i = messages.firstIndex(where: { $0.id == optimisticId }) { messages[i] = stored }
                    case .tool(let name, let detail):
                        working = "Working… \(name) \(detail)".trimmingCharacters(in: .whitespaces)
                    case .toolResult:
                        break
                    case .assistant(let text):
                        live = text
                    case .done(let message):
                        messages.append(message)
                        live = nil
                        working = nil
                    case .error(_, let message):
                        error = message
                        live = nil
                        working = nil
                    }
                }
            } catch {
                self.error = "Lost the connection — the answer will be here when you come back."
            }
            // Whatever the stream said, the thread is the truth.
            if working != nil || live != nil { await load() }
            working = nil
            live = nil
            sending = false
        }
    }

    func cancel() { stream?.cancel() }
}

/// A standing conversation with one of the space's agents — the Messages
/// thread look: the agent's mark at the top, its bubbles on the left, mine
/// on the right, a line saying what it is doing while it works.
struct AgentChatView: View {
    @Environment(ThemeStore.self) private var theme
    @State private var model: AgentChatModel
    @State private var input = ""
    @FocusState private var focused: Bool

    let title: String

    init(spaceId: String, agentName: String, title: String) {
        _model = State(initialValue: AgentChatModel(spaceId: spaceId, agentName: agentName))
        self.title = title
    }

    var body: some View {
        let c = theme.colors
        Group {
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: VVSpace.x2_5) {
                            header
                            if model.nextCursor != nil {
                                Button { Task { await model.loadOlder() } } label: {
                                    if model.loadingOlder { ProgressView().tint(c.accent) }
                                    else { Text("Earlier").font(.system(size: VVFontSize.s13, weight: .medium)).foregroundStyle(c.accentStrong) }
                                }
                                .buttonStyle(.plain)
                            }
                            ForEach(Array(model.messages.enumerated()), id: \.element.id) { index, message in
                                if index == 0 || !sameDay(model.messages[index - 1].createdAt, message.createdAt) {
                                    DateSeparator(label: dayLabel(message.createdAt))
                                }
                                MessageBubble(
                                    text: message.text,
                                    isOwn: message.isOwn,
                                    time: DateFormatting.time(message.createdAt),
                                    agent: !message.isOwn,
                                    failed: message.failed
                                )
                                .id(message.id)
                            }
                            if let live = model.live {
                                MessageBubble(text: live, isOwn: false, agent: true).id("live")
                            } else if let working = model.working {
                                Text(working)
                                    .font(.system(size: VVFontSize.s13)).foregroundStyle(c.fgMuted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .lineLimit(1)
                                    .id("working")
                            }
                            Color.clear.frame(height: 8).id("bottom")
                        }
                        .padding(VVSpace.x4)
                    }
                    .onChange(of: model.messages.count) { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                    .onChange(of: model.live) { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                    .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
        }
        .background(c.surfaceSubtle)
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .onDisappear { model.cancel() }
        .overlay(alignment: .top) {
            if let error = model.error {
                Text(error).font(.system(size: VVFontSize.s13)).foregroundStyle(c.danger)
                    .padding(VVSpace.x3).frame(maxWidth: .infinity, alignment: .leading).background(c.surfaceMuted)
            }
        }
    }

    private var header: some View {
        let c = theme.colors
        return VStack(spacing: VVSpace.x1_5) {
            PersonAvatar(name: title, size: 56, glyph: .bot)
            Text(title).font(.system(size: VVFontSize.s13, weight: .semibold)).foregroundStyle(c.fg)
        }
        .padding(.vertical, VVSpace.x3)
    }

    private var composer: some View {
        let c = theme.colors
        let canSend = !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.sending
        return HStack(alignment: .bottom, spacing: VVSpace.x2) {
            HStack(alignment: .bottom, spacing: VVSpace.x1_5) {
                TextField("Message", text: $input, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .foregroundStyle(c.fg)
                Button { focused = true } label: {
                    VisvineIcon(.mic, size: 18).foregroundStyle(c.fgMuted)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 1)
            }
            .padding(.horizontal, VVSpace.x3_5).padding(.vertical, 9)
            .background(c.surfaceMuted, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            if canSend {
                Button { send() } label: {
                    VisvineIcon(.arrowUp, size: 18).foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(c.accent, in: Circle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(VVSpace.x3)
        .background(c.surface)
    }

    private func send() {
        let text = input
        input = ""
        model.send(text)
    }

    private func sameDay(_ a: String, _ b: String) -> Bool {
        DateFormatting.shortDate(a) == DateFormatting.shortDate(b)
    }

    private func dayLabel(_ value: String) -> String {
        let today = DateFormatting.shortDate(ISO8601DateFormatter().string(from: Date()))
        let label = DateFormatting.shortDate(value)
        return label == today ? "Today" : label
    }
}
