import SwiftUI
import Observation

@Observable
@MainActor
final class ConversationModel {
    var messages: [Message] = []
    var loading = true
    var sending = false
    var error: String?

    let conversationId: String
    private let repo = MessagesRepository()

    init(conversationId: String) { self.conversationId = conversationId }

    func load() async {
        switch await repo.getMessages(conversationId: conversationId) {
        case .success(let page): messages = page.messages.reversed(); error = nil
        case .failure(let m): error = m
        }
        loading = false
    }

    /// Optimistic-send parity: the view clears the field, restoring it on failure.
    func send(_ text: String) async -> Bool {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty, !sending else { return true }
        sending = true
        defer { sending = false }
        switch await repo.sendMessage(conversationId: conversationId, text: text.trimmingCharacters(in: .whitespaces)) {
        case .success(let message): messages.append(message); return true
        case .failure(let m): error = m; return false
        }
    }

    func startRealtime() async {
        for await event in repo.realtimeEvents() {
            guard event.conversationId == conversationId else { continue }
            if event.type.hasPrefix("message.") {
                if case .success(let page) = await repo.getMessages(conversationId: conversationId) {
                    messages = page.messages.reversed()
                }
            }
        }
    }
}

/// One conversation: its messages, newest at the bottom, and the composer.
struct ConversationView: View {
    @Environment(ThemeStore.self) private var theme
    @State private var model: ConversationModel
    @State private var input = ""

    let conversationName: String?

    init(conversationId: String, conversationName: String?) {
        _model = State(initialValue: ConversationModel(conversationId: conversationId))
        self.conversationName = conversationName
    }

    var body: some View {
        let c = theme.colors
        Group {
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.messages.isEmpty {
                VStack(spacing: 4) {
                    VisvineIcon(.message, size: 32).foregroundStyle(c.textMuted)
                        .frame(width: 64, height: 64).background(c.bgTertiary, in: Circle()).padding(.bottom, 8)
                    Text("No messages yet").font(.system(size: 16, weight: .medium)).foregroundStyle(c.textMuted)
                    Text("Start the conversation!").font(.system(size: 14)).foregroundStyle(c.textLight)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(model.messages) { message in bubble(message).id(message.id) }
                        }
                        .padding(16)
                    }
                    .onChange(of: model.messages.count) {
                        if let last = model.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }
            }
        }
        .background(c.bgSecondary)
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle(conversationName ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .task { await model.startRealtime() }
        .overlay(alignment: .top) {
            if let error = model.error {
                Text(error).foregroundStyle(c.error).padding(12).frame(maxWidth: .infinity, alignment: .leading).background(c.bgTertiary)
            }
        }
    }

    private var composer: some View {
        let c = theme.colors
        return HStack(alignment: .bottom, spacing: 8) {
            TextField("Type a message...", text: $input, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 22))
                .foregroundStyle(c.textPrimary)
            Button { send() } label: {
                Group {
                    if model.sending { ProgressView().tint(.white) }
                    else { VisvineIcon(.arrowUp, size: 18).foregroundStyle(.white) }
                }
                .frame(width: 40, height: 40)
                .background(input.trimmingCharacters(in: .whitespaces).isEmpty ? c.borderDefault : c.accent, in: Circle())
            }
            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || model.sending)
        }
        .padding(12)
        .background(c.bgPrimary)
    }

    private func send() {
        let text = input
        input = ""
        Task {
            let ok = await model.send(text)
            if !ok { input = text }
        }
    }

    private func bubble(_ message: Message) -> some View {
        let isOwn = message.isOwn
        return HStack(alignment: .bottom, spacing: 8) {
            if !isOwn {
                PersonAvatar(name: message.sender.name, imageUrl: message.sender.image, size: 32)
            }
            MessageBubble(
                text: message.text,
                isOwn: isOwn,
                time: DateFormatting.time(message.createdAt),
                senderName: isOwn ? nil : message.sender.name
            )
        }
    }
}
