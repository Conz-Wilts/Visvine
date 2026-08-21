import SwiftUI

/// The bespoke glass pill tab bar: one row of tabs, selected by tap, with a
/// search circle sitting to the right of the pill.
struct GlassTabBar: View {
    @Environment(ThemeStore.self) private var theme
    @Binding var selected: MainTab
    var onSearch: () -> Void

    // One icon per tab, not a filled/outline pair: our glyphs are stroke-only
    // (see docs/icons.md), and focus is already carried by the accent colour on
    // the whole cell — which was doing most of the work anyway.
    private struct Item { let tab: MainTab; let label: String; let icon: VisvineIconName }
    private let items: [Item] = [
        Item(tab: .directory, label: "Directory", icon: .people),
        Item(tab: .messages, label: "Messages", icon: .message),
        Item(tab: .events, label: "Events", icon: .calendar),
    ]

    var body: some View {
        let c = theme.colors
        let neutral: Color = .black
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                ForEach(items, id: \.tab) { item in
                    let focused = selected == item.tab
                    Button { selected = item.tab } label: {
                        VStack(spacing: 2) {
                            VisvineIcon(item.icon, size: 20)
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
                VisvineIcon(.search, size: 24)
                    .foregroundStyle(neutral)
                    .frame(width: 64, height: 64)
                    .glass(cornerRadius: 32)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}
