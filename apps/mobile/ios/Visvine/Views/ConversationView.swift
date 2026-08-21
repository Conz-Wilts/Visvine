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
        let c = theme.colors
        let isOwn = message.isOwn
        return HStack(alignment: .bottom, spacing: 8) {
            if isOwn { Spacer(minLength: 40) }
            if !isOwn {
                ZStack {
                    Circle().fill(c.accentLight)
                    Text(message.sender.name.prefix(1).uppercased()).font(.system(size: 14, weight: .semibold)).foregroundStyle(c.accentDark)
                }
                .frame(width: 32, height: 32)
            }
            VStack(alignment: .leading, spacing: 4) {
                if !isOwn { Text(message.sender.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(c.textMuted) }
                Text(message.text).font(.system(size: 15)).foregroundStyle(isOwn ? .white : c.textPrimary)
                Text(DateFormatting.time(message.createdAt)).font(.system(size: 10)).foregroundStyle(isOwn ? Color.white.opacity(0.7) : c.textLight)
            }
            .padding(12)
            .background(isOwn ? c.accent : c.bgPrimary, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            if !isOwn { Spacer(minLength: 40) }
        }
    }
}
