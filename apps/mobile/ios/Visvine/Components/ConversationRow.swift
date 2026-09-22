import SwiftUI

/// One conversation in a list: the other person's mark, their name, the last
/// line, when, and an unread count as a rounded square.
struct ConversationRow: View {
    @Environment(ThemeStore.self) private var theme
    let conversation: Conversation
    let name: String

    var body: some View {
        let c = theme.colors
        HStack(spacing: 12) {
            PersonAvatar(name: name, imageUrl: conversation.avatarUrl, size: 48)
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
                            .padding(.horizontal, 8).padding(.vertical, 2).background(c.accent, in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
        }
        .padding(16)
        .contentShape(Rectangle())
    }
}
