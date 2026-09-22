import SwiftUI

/// The header every main screen carries: the current space on the left — its
/// square, its name, a chevron that drops the space list — and the profile
/// avatar on the right. A screen without the switcher shows its title there.
struct ScreenHeader: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(AuthManager.self) private var auth

    var title: String? = nil
    var showSpaceSelector: Bool = true
    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        HStack(spacing: 10) {
            if showSpaceSelector, let current = space.current {
                Button {
                    withAnimation(.smooth(duration: 0.3)) { space.switcherOpen = true }
                } label: { SpaceMark(space: current, parent: space.parent(of: current)) }
                    .buttonStyle(.plain)
            } else if let title {
                Text(title)
                    .font(.system(size: 28, weight: .bold))
                    .tracking(-0.4)
                    .foregroundStyle(c.textPrimary)
                    .lineLimit(1)
            } else {
                Wordmark(size: 18)
            }
            Spacer(minLength: 8)
            Button(action: onProfile) {
                PersonAvatar(name: auth.user?.name ?? "", imageUrl: auth.user?.image, size: 38)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .frame(height: 64)
        .background(c.bgPrimary)
    }
}

/// The current space as the header draws it; pressing it opens the sidebar.
struct SpaceMark: View {
    @Environment(ThemeStore.self) private var theme
    let space: Space
    let parent: Space?

    var body: some View {
        let c = theme.colors
        HStack(spacing: 10) {
            SpaceAvatar(name: space.name, imageUrl: space.image, size: 40)
            VStack(alignment: .leading, spacing: 0) {
                if let parent {
                    Text(parent.name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(c.textMuted)
                        .lineLimit(1)
                }
                Text(space.name)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(c.textPrimary)
                    .lineLimit(1)
            }
            .frame(maxWidth: 200, alignment: .leading)
            .fixedSize(horizontal: true, vertical: false)
            VisvineIcon(.chevronRight, size: 12)
                .foregroundStyle(c.textMuted)
        }
        .contentShape(Rectangle())
        .accessibilityLabel("Space: \(space.name)")
    }
}
