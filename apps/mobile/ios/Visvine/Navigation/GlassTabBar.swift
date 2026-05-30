import SwiftUI

/// Port of navigation/TabNavigator.tsx's bespoke glass pill bar (the RN swipe
/// PanResponder is dropped for standard taps per the B2 custom-UI decision).
/// A search circle sits to the right of the pill.
struct GlassTabBar: View {
    @Environment(ThemeStore.self) private var theme
    @Binding var selected: MainTab
    var onSearch: () -> Void

    private struct Item { let tab: MainTab; let label: String; let filled: String; let outline: String }
    private let items: [Item] = [
        Item(tab: .directory, label: "Directory", filled: "person.2.fill", outline: "person.2"),
        Item(tab: .messages, label: "Messages", filled: "bubble.left.and.bubble.right.fill", outline: "bubble.left.and.bubble.right"),
        Item(tab: .events, label: "Events", filled: "calendar", outline: "calendar"),
    ]

    var body: some View {
        let c = theme.colors
        let neutral: Color = theme.isDark ? .white : .black
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                ForEach(items, id: \.tab) { item in
                    let focused = selected == item.tab
                    Button { selected = item.tab } label: {
                        VStack(spacing: 2) {
                            Image(systemName: focused ? item.filled : item.outline)
                                .font(.system(size: 20))
                            Text(item.label).font(.system(size: 11, weight: .bold))
                        }
                        .foregroundStyle(focused ? c.accent : neutral)
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .frame(height: 64)
            .glass(cornerRadius: 32)

            Button(action: onSearch) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 24))
                    .foregroundStyle(neutral)
                    .frame(width: 64, height: 64)
                    .glass(cornerRadius: 32)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}
