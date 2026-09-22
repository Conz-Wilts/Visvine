import SwiftUI

/// The floating Liquid Glass bar: three tabs in one capsule, and beside it
/// the create circle in the accent.
struct GlassTabBar: View {
    @Environment(ThemeStore.self) private var theme
    @Binding var selected: MainTab
    var onCreate: () -> Void

    @Namespace private var glass

    // One stroke glyph per tab (docs/icons.md).
    private struct Item { let tab: MainTab; let label: String; let icon: VisvineIconName }
    private let items: [Item] = [
        Item(tab: .home, label: "Home", icon: .home),
        Item(tab: .messages, label: "Messages", icon: .message),
        Item(tab: .discover, label: "Discover", icon: .compass),
    ]

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(alignment: .bottom, spacing: 12) {
                tabs
                create
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, bottomGap)
        // Measured from the screen's edge, as the system tab bar is.
        .ignoresSafeArea(.container, edges: .bottom)
        .animation(.snappy(duration: 0.2), value: selected)
    }

    /// 20pt off the edge on a home-indicator phone, where the system's own tab
    /// bar sits.
    private var bottomGap: CGFloat {
        let window = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
        return (window?.safeAreaInsets.bottom ?? 0) > 0 ? 20 : 12
    }

    private var tabs: some View {
        let c = theme.colors
        return HStack(spacing: 2) {
            ForEach(items, id: \.tab) { item in
                let focused = selected == item.tab
                Button { selected = item.tab } label: {
                    VStack(spacing: 3) {
                        VisvineIcon(item.icon, size: 22)
                        Text(item.label).font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(c.textPrimary.opacity(focused ? 1 : 0.75))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background {
                        if focused {
                            Capsule().fill(c.textPrimary.opacity(0.12))
                                .matchedGeometryEffect(id: "selection", in: glass)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(focused ? .isSelected : [])
            }
        }
        .padding(5)
        .frame(height: 64)
        .glassEffect(.regular.interactive(), in: .capsule)
        .glassEffectID("tabs", in: glass)
    }

    private var create: some View {
        Button(action: onCreate) {
            VisvineIcon(.plus, size: 24)
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(theme.colors.accent).interactive(), in: .circle)
        .glassEffectID("create", in: glass)
        .accessibilityLabel("Create")
    }
}
