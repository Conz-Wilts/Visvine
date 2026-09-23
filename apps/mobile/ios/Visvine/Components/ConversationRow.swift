import SwiftUI

/// One conversation in a list: the other person's mark, their name, the last
/// line, when, and an unread count as a rounded square.
struct ConversationRow: View {
    @Environment(ThemeStore.self) private var theme
    let conversation: Conversation
    let name: String

    var body: some View {
        let c = theme.colors
        HStack(spacing: VVSpace.x3) {
            PersonAvatar(name: name, imageUrl: conversation.avatarUrl, size: 48)
            VStack(alignment: .leading, spacing: VVSpace.x0_5) {
                HStack {
                    Text(name).font(.system(size: VVFontSize.s16, weight: .semibold)).foregroundStyle(c.fg).lineLimit(1)
                    Spacer()
                    if let last = conversation.lastMessage {
                        Text(DateFormatting.relativeShort(last.createdAt)).font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgMuted)
                    }
                }
                HStack {
                    let preview = conversation.lastMessage.map { "\($0.sender.name): \($0.text)" } ?? "No messages yet"
                    Text(preview).font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted).lineLimit(1)
                    Spacer()
                    if conversation.unreadCount > 0 {
                        Text("\(conversation.unreadCount)").font(.system(size: VVFontSize.s12, weight: .semibold)).foregroundStyle(c.surface)
                            .padding(.horizontal, VVSpace.x2).padding(.vertical, VVSpace.x0_5).background(c.accent, in: RoundedRectangle(cornerRadius: VVRadius.md))
                    }
                }
            }
        }
        .padding(VVSpace.x4)
        .contentShape(Rectangle())
    }
}
