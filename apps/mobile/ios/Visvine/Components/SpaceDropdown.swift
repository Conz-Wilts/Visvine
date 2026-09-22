import SwiftUI

/// The space list, dropped from the header over whatever tab is showing: the
/// current space where the header had it, then every space the person holds,
/// each house with its rooms folded under it on a spine (docs/sub-spaces.md).
struct SpaceDropdown: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @State private var expanded: Set<String> = []

    var body: some View {
        let c = theme.colors
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.25)
                .ignoresSafeArea()
                .onTapGesture(perform: close)
                .transition(.opacity)

            VStack(alignment: .leading, spacing: 0) {
                if let current = space.current {
                    Button(action: close) {
                        SpaceMark(space: current, parent: space.parent(of: current), open: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(height: 64)
                            .padding(.horizontal, 8)
                    }
                    .buttonStyle(.plain)
                }
                Rectangle().fill(c.borderSubtle).frame(height: 0.5).padding(.horizontal, 8)
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(space.tree) { branch in
                            house(branch)
                        }
                    }
                    .padding(.vertical, 6)
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: 440)
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 4)
            .glassEffect(.regular, in: .rect(cornerRadius: 28))
            .padding(.horizontal, 8)
            .transition(.scale(scale: 0.6, anchor: .topLeading).combined(with: .opacity))
            .gesture(DragGesture(minimumDistance: 20).onEnded { if $0.translation.height < -30 { close() } })
        }
        .onAppear {
            if let current = space.current, let parentId = current.parentId { expanded.insert(parentId) }
        }
    }

    @ViewBuilder private func house(_ branch: SpaceStore.Branch) -> some View {
        let c = theme.colors
        let open = expanded.contains(branch.id)
        HStack(spacing: 0) {
            row(branch.house, size: 36)
            if !branch.rooms.isEmpty {
                Button {
                    withAnimation(.snappy(duration: 0.25)) {
                        if open { expanded.remove(branch.id) } else { expanded.insert(branch.id) }
                    }
                } label: {
                    VisvineIcon(.chevronRight, size: 13)
                        .foregroundStyle(c.textMuted)
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .frame(width: 44, height: 52)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(open ? "Hide rooms" : "Show rooms")
            }
        }
        if open {
            HStack(alignment: .top, spacing: 0) {
                // The spine: a hairline from under the house's square.
                Rectangle().fill(c.borderDefault).frame(width: 1)
                    .padding(.leading, 26).padding(.trailing, 13).padding(.vertical, 4)
                VStack(spacing: 2) {
                    ForEach(branch.rooms) { row($0, size: 26) }
                }
            }
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    private func row(_ item: Space, size: CGFloat) -> some View {
        let c = theme.colors
        let active = space.current?.id == item.id
        return Button {
            space.setCurrent(item)
            close()
        } label: {
            HStack(spacing: 12) {
                SpaceAvatar(name: item.name, imageUrl: item.image, size: size)
                Text(item.name)
                    .font(.system(size: size > 30 ? 16 : 15, weight: active ? .semibold : .regular))
                    .foregroundStyle(c.textPrimary)
                    .lineLimit(1)
                if item.visibility == "private" {
                    VisvineIcon(.lock, size: 12).foregroundStyle(c.textMuted)
                }
                Spacer(minLength: 4)
                if active { VisvineIcon(.check, size: 16).foregroundStyle(c.textPrimary) }
            }
            .padding(.horizontal, 10)
            .frame(height: size > 30 ? 52 : 44)
            .background(active ? c.textPrimary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func close() {
        withAnimation(.bouncy(duration: 0.3)) { space.switcherOpen = false }
    }
}
