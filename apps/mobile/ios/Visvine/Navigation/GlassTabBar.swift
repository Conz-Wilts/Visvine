import SwiftUI

/// The floating Liquid Glass bar: three tabs in one capsule, and beside it a
/// column of two circles — create over search. Search opens in place: the
/// circle grows into the field and the capsule gives way to it.
struct GlassTabBar: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SearchStore.self) private var searchStore
    @Binding var selected: MainTab
    var onCreate: () -> Void

    @Namespace private var glass
    @FocusState private var focused: Bool

    // One stroke glyph per tab (docs/icons.md).
    private struct Item { let tab: MainTab; let label: String; let icon: VisvineIconName }
    private let items: [Item] = [
        Item(tab: .home, label: "Home", icon: .home),
        Item(tab: .messages, label: "Messages", icon: .message),
        Item(tab: .discover, label: "Discover", icon: .compass),
    ]

    var body: some View {
        @Bindable var search = searchStore
        GlassEffectContainer(spacing: 12) {
            HStack(alignment: .bottom, spacing: 12) {
                if search.isOpen {
                    field(query: $search.query)
                    circle(.xmark, label: "Close search", id: "search") { search.close() }
                } else {
                    tabs
                    VStack(spacing: 12) {
                        circle(.plus, label: "Create", id: "create", action: onCreate)
                        circle(.search, label: "Search", id: "search") { search.open() }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, bottomGap(searching: search.isOpen))
        // Measured from the screen's edge, as the system tab bar is; the
        // keyboard's inset still lifts it while search is typing.
        .ignoresSafeArea(.container, edges: .bottom)
        .animation(.bouncy(duration: 0.35), value: search.isOpen)
        .animation(.snappy(duration: 0.2), value: selected)
        .onChange(of: search.isOpen) { _, open in focused = open }
    }

    /// 20pt off the edge on a home-indicator phone, where the system's own tab
    /// bar sits; 8pt over the keyboard.
    private func bottomGap(searching: Bool) -> CGFloat {
        if searching { return 8 }
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

    private func field(query: Binding<String>) -> some View {
        let c = theme.colors
        return HStack(spacing: 10) {
            VisvineIcon(.search).foregroundStyle(c.textPrimary)
            TextField(searchStore.placeholder, text: query)
                .focused($focused)
                .submitLabel(.search)
                .onSubmit { focused = false }
                .foregroundStyle(c.textPrimary)
        }
        .padding(.horizontal, 20)
        .frame(height: 64)
        .frame(maxWidth: .infinity)
        .glassEffect(.regular.interactive(), in: .capsule)
        .glassEffectID("tabs", in: glass)
    }

    private func circle(_ icon: VisvineIconName, label: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VisvineIcon(icon, size: 22)
                .foregroundStyle(theme.colors.textPrimary)
                .frame(width: 64, height: 64)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .glassEffectID(id, in: glass)
        .accessibilityLabel(label)
    }
}
