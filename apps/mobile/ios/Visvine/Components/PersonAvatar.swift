import SwiftUI

/// A person's (or an agent's) mark: their image, else their initials on the
/// accent tint, else a glyph — the one circle every row and bubble draws.
struct PersonAvatar: View {
    @Environment(ThemeStore.self) private var theme
    let name: String
    var imageUrl: String?
    var size: CGFloat = 40
    /// Drawn instead of initials — an agent is `.bot`.
    var glyph: VisvineIconName?

    var body: some View {
        Group {
            if let imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { fallback }
                }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var fallback: some View {
        let c = theme.colors
        return ZStack {
            Circle().fill(c.accentLight)
            if let glyph {
                VisvineIcon(glyph, size: max(12, size * 0.45)).foregroundStyle(c.accentDark)
            } else {
                Text(name.isEmpty ? "?" : avatarInitials(name))
                    .foregroundStyle(c.accentDark)
                    .font(.system(size: max(10, size * 0.38), weight: .semibold))
            }
        }
    }
}
