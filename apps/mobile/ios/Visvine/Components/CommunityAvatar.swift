import SwiftUI

func avatarInitials(_ name: String) -> String {
    name.split(whereSeparator: { $0.isWhitespace })
        .prefix(2)
        .compactMap { $0.first.map { String($0).uppercased() } }
        .joined()
}

/// A community's avatar: its image, or its initials when there is none.
struct CommunityAvatar: View {
    @Environment(ThemeStore.self) private var theme
    let name: String
    let imageUrl: String?
    var size: CGFloat = 28

    var body: some View {
        Group {
            if let imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        fallback
                    }
                }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var fallback: some View {
        ZStack {
            theme.colors.accent
            Text(avatarInitials(name))
                .foregroundStyle(.white)
                .font(.system(size: max(10, size * 0.4), weight: .semibold))
        }
    }
}
