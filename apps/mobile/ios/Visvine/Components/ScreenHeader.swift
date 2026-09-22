import SwiftUI

/// The header every main screen carries: the screen's name on the left, the
/// space switcher and the profile avatar on the right.
struct ScreenHeader: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(AuthManager.self) private var auth

    var title: String? = nil
    var showSpaceSelector: Bool = true
    var onProfile: () -> Void

    @State private var pickerVisible = false

    var body: some View {
        let c = theme.colors
        HStack(spacing: 10) {
            if let title {
                Text(title)
                    .font(.system(size: 28, weight: .bold))
                    .tracking(-0.4)
                    .foregroundStyle(c.textPrimary)
                    .lineLimit(1)
            } else {
                Wordmark(size: 18)
            }
            Spacer(minLength: 8)
            if showSpaceSelector, let current = space.current {
                Button { pickerVisible = true } label: { switcher(current) }
                    .buttonStyle(.plain)
            }
            Button(action: onProfile) {
                PersonAvatar(name: auth.user?.name ?? "", imageUrl: auth.user?.image, size: 34)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .frame(height: 60)
        .background(c.bgPrimary)
        .sheet(isPresented: $pickerVisible) {
            SpacePickerSheet(onDone: { pickerVisible = false })
                .environment(theme)
                .environment(space)
        }
    }

    /// The current space as a compact pill: its mark, its name, a chevron.
    private func switcher(_ current: Space) -> some View {
        let c = theme.colors
        return HStack(spacing: 6) {
            SpaceAvatar(name: current.name, imageUrl: current.image, size: 24)
            Text(current.name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(c.textPrimary)
                .lineLimit(1)
                .frame(maxWidth: 120, alignment: .leading)
                .fixedSize(horizontal: true, vertical: false)
            VisvineIcon(.chevronDown, size: 12).foregroundStyle(c.textMuted)
        }
        .padding(.leading, 4)
        .padding(.trailing, 10)
        .frame(height: 34)
        .background(c.bgTertiary, in: Capsule())
        .accessibilityLabel("Space: \(current.name)")
    }
}

/// The joined spaces, one row each, the current one ticked.
private struct SpacePickerSheet: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    var onDone: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            Text("Spaces")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(c.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.top, 20).padding(.bottom, 12)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(space.spaces) { item in
                        let active = space.current?.id == item.id
                        Button {
                            space.setCurrent(item)
                            onDone()
                        } label: {
                            HStack(spacing: 12) {
                                SpaceAvatar(name: item.name, imageUrl: item.image, size: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.name)
                                        .font(.system(size: 16, weight: active ? .semibold : .regular))
                                        .foregroundStyle(c.textPrimary)
                                        .lineLimit(1)
                                    if item.visibility == "private" {
                                        Text("Private").font(.system(size: 12)).foregroundStyle(c.textMuted)
                                    }
                                }
                                Spacer()
                                if active { VisvineIcon(.check, size: 18).foregroundStyle(c.accentDark) }
                            }
                            .padding(.horizontal, 20)
                            .frame(height: 60)
                            .background(active ? c.accentLight : Color.clear)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .background(c.bgPrimary)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
