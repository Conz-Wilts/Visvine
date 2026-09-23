import SwiftUI

/// The space's installed Tools (`list_tools`). A Tool renders on the web, so a
/// row opens `/s/<space>/t/<slug>` in the browser.
struct ToolsView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(\.openURL) private var openURL
    @State private var tools: [InstalledTool] = []
    @State private var loading = true
    @State private var error: String?

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(onProfile: onProfile)
            if let error {
                Text(error).foregroundStyle(c.danger).font(.system(size: VVFontSize.s14))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x2)
            }
            if loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        if tools.isEmpty {
                            EmptyStateView(text: "No tools", icon: .compass)
                        }
                        ForEach(tools.filter(\.enabled)) { tool in
                            Button { open(tool) } label: { row(tool) }.buttonStyle(.plain)
                            Hairline()
                        }
                    }
                }
                .refreshable { await load() }
            }
        }
        .background(c.surface)
        .task(id: space.current?.id) { await load() }
    }

    private func row(_ tool: InstalledTool) -> some View {
        let c = theme.colors
        return HStack {
            Text(tool.title).font(.system(size: VVFontSize.s16, weight: .semibold)).foregroundStyle(c.fg).lineLimit(1)
            Spacer()
            VisvineIcon(.chevronRight, size: 16).foregroundStyle(c.fgMuted)
        }
        .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x3_5)
        .contentShape(Rectangle())
    }

    private func open(_ tool: InstalledTool) {
        guard let id = space.current?.id,
              let url = URL(string: "\(AppConfig.apiBase)/s/\(id)/t/\(tool.slug)") else { return }
        openURL(url)
    }

    private func load() async {
        guard let id = space.current?.id else { tools = []; loading = false; return }
        switch await ActionsRepository().listTools(spaceId: id) {
        case .success(let list): tools = list; error = nil
        case .failure(let m): error = m
        }
        loading = false
    }
}
