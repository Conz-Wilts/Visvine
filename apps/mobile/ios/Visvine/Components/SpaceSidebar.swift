import SwiftUI

/// Every space the person holds, in a panel that slides in from the left over
/// whatever tab is showing. A house with rooms opens them in place, on a spine
/// under its square (docs/sub-spaces.md). Drag left or tap outside to close.
struct SpaceSidebar: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    var onDiscover: () -> Void
    var onSettings: () -> Void

    @State private var expanded: Set<String> = []
    @State private var drag: CGFloat = 0
    @State private var shown = false

    var body: some View {
        GeometryReader { geo in
            let width = min(geo.size.width * 0.85, 360)
            ZStack(alignment: .leading) {
                Color.black.opacity(shown ? 0.35 * (1 - min(1, -drag / width)) : 0)
                    .ignoresSafeArea()
                    .onTapGesture(perform: close)
                panel
                    .frame(width: width)
                    .frame(maxHeight: .infinity)
                    .background(theme.colors.surface, in: UnevenRoundedRectangle(bottomTrailingRadius: 36, topTrailingRadius: 36, style: .continuous))
                    .ignoresSafeArea(edges: .vertical)
                    .offset(x: shown ? min(0, drag) : -width - 20)
                    .gesture(
                        DragGesture()
                            .onChanged { drag = min(0, $0.translation.width) }
                            .onEnded { v in
                                if v.predictedEndTranslation.width < -width / 3 { close() }
                                else { withAnimation(.smooth(duration: 0.25)) { drag = 0 } }
                            }
                    )
            }
        }
        .onAppear {
            if let parentId = space.current?.parentId { expanded.insert(parentId) }
            withAnimation(.smooth(duration: 0.3)) { shown = true }
        }
    }

    private var panel: some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: 0) {
            Text("Spaces")
                .font(.system(size: VVFontSize.s30, weight: .bold))
                .tracking(-0.4)
                .foregroundStyle(c.fg)
                .padding(.horizontal, 22)
                .padding(.top, 72)
                .padding(.bottom, VVSpace.x3_5)
            ScrollView {
                VStack(spacing: VVSpace.x1) {
                    ForEach(space.tree) { house($0) }
                }
                .padding(.horizontal, VVSpace.x2)
            }
            .scrollBounceBehavior(.basedOnSize)
            Rectangle().fill(c.lineSubtle).frame(height: 0.5)
            VStack(spacing: 0) {
                footer(.compass, "Discover spaces") { close(); onDiscover() }
                footer(.settings, "Settings") { close(); onSettings() }
            }
            .padding(.top, VVSpace.x2)
            .padding(.bottom, 34)
        }
    }

    @ViewBuilder private func house(_ branch: SpaceStore.Branch) -> some View {
        let c = theme.colors
        let open = expanded.contains(branch.id)
        row(branch.house, size: 52, rooms: branch.rooms.count) {
            if !branch.rooms.isEmpty {
                Button {
                    withAnimation(.snappy(duration: 0.25)) {
                        if open { expanded.remove(branch.id) } else { expanded.insert(branch.id) }
                    }
                } label: {
                    VisvineIcon(.chevronRight, size: 20)
                        .foregroundStyle(c.fgMuted)
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(open ? "Hide rooms" : "Show rooms")
            }
        }
        if open {
            HStack(alignment: .top, spacing: 0) {
                // The spine: a hairline down from under the house's square.
                Rectangle().fill(c.line).frame(width: 1)
                    .padding(.leading, 38).padding(.trailing, VVSpace.x2_5).padding(.vertical, VVSpace.x1_5)
                VStack(spacing: VVSpace.x0_5) {
                    ForEach(branch.rooms) { row($0, size: 34, rooms: 0) { EmptyView() } }
                }
            }
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    private func row<Trailing: View>(_ item: Space, size: CGFloat, rooms: Int, @ViewBuilder trailing: () -> Trailing) -> some View {
        let c = theme.colors
        let active = space.current?.id == item.id
        return HStack(spacing: 0) {
            Button {
                space.setCurrent(item)
                close()
            } label: {
                HStack(spacing: VVSpace.x3_5) {
                    SpaceAvatar(name: item.name, imageUrl: item.image, size: size)
                        .padding(3)
                    VStack(alignment: .leading, spacing: VVSpace.x0_5) {
                        Text(item.name)
                            .font(.system(size: size > 40 ? 18 : 16, weight: .semibold))
                            .foregroundStyle(c.fg)
                            .lineLimit(1)
                        if let line = subtitle(item, rooms: rooms) {
                            Text(line).font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 4)
                    if active {
                        VisvineIcon(.check, size: 22).foregroundStyle(c.accentStrong)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            trailing()
        }
        .padding(.horizontal, VVSpace.x2_5)
        .padding(.vertical, VVSpace.x1_5)
        .background(active ? c.fg.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    /// State is data, joined by `·`: private, and how many rooms.
    private func subtitle(_ item: Space, rooms: Int) -> String? {
        var parts: [String] = []
        if item.visibility == "private" { parts.append("Private") }
        if rooms > 0 { parts.append(rooms == 1 ? "1 room" : "\(rooms) rooms") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func footer(_ icon: VisvineIconName, _ label: String, action: @escaping () -> Void) -> some View {
        let c = theme.colors
        return Button(action: action) {
            HStack(spacing: VVSpace.x4) {
                VisvineIcon(icon, size: 22).foregroundStyle(c.fgSecondary).frame(width: 26)
                Text(label).font(.system(size: VVFontSize.s18)).foregroundStyle(c.fg)
                Spacer()
            }
            .padding(.horizontal, 22)
            .frame(height: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func close() {
        withAnimation(.smooth(duration: 0.25)) { shown = false; drag = 0 }
        Task {
            try? await Task.sleep(for: .milliseconds(250))
            space.switcherOpen = false
        }
    }
}
