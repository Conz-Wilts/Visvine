import SwiftUI

/// The floating glass tab bar: three tabs in one pill, with a search circle
/// beside it.
struct GlassTabBar: View {
    @Environment(ThemeStore.self) private var theme
    @Binding var selected: MainTab
    var onSearch: () -> Void

    // One stroke glyph per tab (docs/icons.md); focus is the accent on the cell.
    private struct Item { let tab: MainTab; let label: String; let icon: VisvineIconName }
    private let items: [Item] = [
        Item(tab: .home, label: "Home", icon: .home),
        Item(tab: .messages, label: "Messages", icon: .message),
        Item(tab: .discover, label: "Discover", icon: .compass),
    ]

    var body: some View {
        let c = theme.colors
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                ForEach(items, id: \.tab) { item in
                    let focused = selected == item.tab
                    Button { selected = item.tab } label: {
                        VStack(spacing: 3) {
                            VisvineIcon(item.icon, size: 21)
                            Text(item.label).font(.system(size: 10, weight: .semibold))
                        }
                        .foregroundStyle(focused ? c.accentDark : c.textMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(focused ? c.accentLight.opacity(0.9) : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(focused ? .isSelected : [])
                }
            }
            .padding(5)
            .frame(height: 62)
            .glass(cornerRadius: 31)

            Button(action: onSearch) {
                VisvineIcon(.search, size: 22)
                    .foregroundStyle(c.textSecondary)
                    .frame(width: 62, height: 62)
                    .glass(cornerRadius: 31)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Search")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
        .animation(.snappy(duration: 0.2), value: selected)
    }
}
