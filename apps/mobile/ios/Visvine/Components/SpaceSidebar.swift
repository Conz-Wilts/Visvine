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
                    .glassEffect(.regular, in: UnevenRoundedRectangle(bottomTrailingRadius: 36, topTrailingRadius: 36, style: .continuous))
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
                .font(.system(size: 30, weight: .bold))
                .tracking(-0.4)
                .foregroundStyle(c.textPrimary)
                .padding(.horizontal, 22)
                .padding(.top, 72)
                .padding(.bottom, 14)
            ScrollView {
                VStack(spacing: 4) {
                    ForEach(space.tree) { house($0) }
                }
                .padding(.horizontal, 8)
            }
            .scrollBounceBehavior(.basedOnSize)
            Rectangle().fill(c.borderSubtle).frame(height: 0.5)
            VStack(spacing: 0) {
                footer(.compass, "Discover spaces") { close(); onDiscover() }
                footer(.settings, "Settings") { close(); onSettings() }
            }
            .padding(.top, 8)
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
                    VisvineIcon(.chevronRight, size: 14)
                        .foregroundStyle(c.textMuted)
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
                Rectangle().fill(c.borderDefault).frame(width: 1)
                    .padding(.leading, 38).padding(.trailing, 10).padding(.vertical, 6)
                VStack(spacing: 2) {
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
                HStack(spacing: 14) {
                    SpaceAvatar(name: item.name, imageUrl: item.image, size: size)
                        .padding(3)
                        .overlay {
                            if active {
                                RoundedRectangle(cornerRadius: (size + 6) * 0.26, style: .continuous)
                                    .strokeBorder(c.textPrimary, lineWidth: 2.5)
                            }
                        }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name)
                            .font(.system(size: size > 40 ? 18 : 16, weight: .semibold))
                            .foregroundStyle(c.textPrimary)
                            .lineLimit(1)
                        if let line = subtitle(item, rooms: rooms) {
                            Text(line).font(.system(size: 14)).foregroundStyle(c.textMuted).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 4)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            trailing()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(active ? c.textPrimary.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
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
            HStack(spacing: 16) {
                VisvineIcon(icon, size: 22).foregroundStyle(c.textSecondary).frame(width: 26)
                Text(label).font(.system(size: 18)).foregroundStyle(c.textPrimary)
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
