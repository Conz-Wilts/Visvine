import SwiftUI

/// The space's context as the web's tree draws it: folders open in place, each
/// level joined to its parent by guide lines — a tick into every row, a rounded
/// elbow into the last. A note opens to read. Search prunes the tree to the
/// notes whose title or path match, with every branch leading to one open.
struct ContextFolderView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SearchStore.self) private var search
    let node: ContextNode
    /// Drawn under Home's chips rather than pushed with a title.
    var embedded = false

    @State private var open: Set<String> = []

    /// One drawn row: the node, its depth, and for each level above it
    /// whether that ancestor was the last of its siblings (no line continues).
    private struct Row: Identifiable {
        let node: ContextNode
        let lastAt: [Bool]
        var id: String { node.path }
    }

    var body: some View {
        let c = theme.colors
        let rows = flatten()
        ScrollView {
            LazyVStack(spacing: 0) {
                if rows.isEmpty {
                    EmptyStateView(text: search.query.isEmpty ? "Nothing here yet" : "No notes found", icon: .search)
                }
                ForEach(rows) { row in
                    line(row)
                }
            }
            .padding(.top, VVSpace.x1)
            .padding(.bottom, 140)
        }
        .background(c.surface)
        .navigationTitle(embedded ? "" : (node.path.isEmpty ? "Context" : node.label))
        .navigationBarTitleDisplayMode(embedded ? .inline : .large)
        .searchScope("Search context")
        .animation(.snappy(duration: 0.22), value: open)
        .animation(.snappy(duration: 0.22), value: search.query)
    }

    // MARK: rows

    @ViewBuilder private func line(_ row: Row) -> some View {
        let c = theme.colors
        let n = row.node
        let expanded = isOpen(n)
        let content = HStack(spacing: 0) {
            guides(row)
            VisvineIcon(n.isFolder ? (expanded ? .folderOpen : .folder) : .fileText, size: 19)
                .foregroundStyle(n.isFolder ? c.accentStrong : c.fgMuted)
                .frame(width: Self.glyph)
            Text(highlighted(n.label))
                .font(.system(size: 17, weight: n.isFolder ? .semibold : .regular))
                .foregroundStyle(c.fg)
                .lineLimit(1)
                .padding(.leading, VVSpace.x3)
            Spacer(minLength: 8)
            if n.isFolder {
                Text("\(n.noteCount)").font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted)
                VisvineIcon(.chevronRight, size: 12)
                    .foregroundStyle(c.fgSubtle)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
                    .padding(.leading, VVSpace.x2)
            }
        }
        .padding(.horizontal, VVSpace.x4)
        .frame(height: Self.rowHeight)
        .contentShape(Rectangle())

        if n.isFolder {
            Button {
                if open.contains(n.path) { open.remove(n.path) } else { open.insert(n.path) }
            } label: { content }
                .buttonStyle(TreeRowStyle())
        } else {
            NavigationLink(value: AppRoute.contextNote(path: n.path, title: n.label)) { content }
                .buttonStyle(TreeRowStyle())
        }
    }

    /// The guide columns: a continuing line for every ancestor that has
    /// siblings below it, then this row's own tick or elbow.
    private func guides(_ row: Row) -> some View {
        let color = theme.colors.line
        return HStack(spacing: 0) {
            ForEach(Array(row.lastAt.enumerated()), id: \.offset) { i, last in
                let own = i == row.lastAt.count - 1
                ZStack(alignment: .topLeading) {
                    if own {
                        GuideJoin(last: last).stroke(color, lineWidth: 1)
                    } else if !last {
                        Rectangle().fill(color).frame(width: 1).frame(maxHeight: .infinity)
                            .padding(.leading, Self.glyph / 2)
                    }
                }
                .frame(width: Self.column, height: Self.rowHeight, alignment: .leading)
            }
        }
    }

    // MARK: tree

    private static let rowHeight: CGFloat = 52
    private static let glyph: CGFloat = 24
    private static let column: CGFloat = 26

    private var query: String { search.query.trimmingCharacters(in: .whitespaces).lowercased() }

    private func isOpen(_ n: ContextNode) -> Bool { !query.isEmpty || open.contains(n.path) }

    /// The rows as drawn, top to bottom. The root's own rows carry no guide
    /// column; each level below adds one.
    private func flatten() -> [Row] {
        var out: [Row] = []
        func walk(_ nodes: [ContextNode], _ trail: [Bool]?) {
            for (i, child) in nodes.enumerated() {
                let mine = trail.map { $0 + [i == nodes.count - 1] } ?? []
                out.append(Row(node: child, lastAt: mine))
                if child.isFolder && isOpen(child) { walk(visible(child.children ?? []), mine) }
            }
        }
        walk(visible(node.children ?? []), nil)
        return out
    }

    /// What a level shows: no empty folders, no index (the folder IS it), and
    /// under a search only what matches or leads to a match.
    private func visible(_ nodes: [ContextNode]) -> [ContextNode] {
        nodes.filter { n in
            if n.isFolder { return n.noteCount > 0 && (query.isEmpty || matches(n)) }
            if n.name == "index.md" { return false }
            return query.isEmpty || matches(n)
        }
    }

    private func matches(_ n: ContextNode) -> Bool {
        if n.label.lowercased().contains(query) || n.path.lowercased().contains(query) { return true }
        return (n.children ?? []).contains { $0.name != "index.md" && matches($0) }
    }

    private func highlighted(_ label: String) -> AttributedString {
        var s = AttributedString(label)
        guard !query.isEmpty, let r = s.range(of: query, options: .caseInsensitive) else { return s }
        s[r].backgroundColor = theme.colors.accentSoft
        s[r].foregroundColor = theme.colors.accentStrong
        return s
    }
}

/// A row's join to its parent's line: a T (line through, tick out) or, on the
/// last child, a rounded elbow that ends the line.
private struct GuideJoin: Shape {
    let last: Bool
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let x = rect.minX + 12, mid = rect.midY, end = rect.maxX - 2
        if last {
            p.move(to: CGPoint(x: x, y: rect.minY))
            p.addLine(to: CGPoint(x: x, y: mid - 7))
            p.addQuadCurve(to: CGPoint(x: x + 7, y: mid), control: CGPoint(x: x, y: mid))
            p.addLine(to: CGPoint(x: end, y: mid))
        } else {
            p.move(to: CGPoint(x: x, y: rect.minY))
            p.addLine(to: CGPoint(x: x, y: rect.maxY))
            p.move(to: CGPoint(x: x, y: mid))
            p.addLine(to: CGPoint(x: end, y: mid))
        }
        return p
    }
}

/// The full-width band a pressed row takes, as on the web tree.
private struct TreeRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Color.primary.opacity(configuration.isPressed ? 0.06 : 0))
    }
}

/// One note, read as the web's Context tab draws it — title, property rows,
/// prose, the folder's children, what links here — or as the raw file.
struct ContextNoteView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    let path: String
    let title: String

    @AppStorage("noteMode") private var mode = 0
    @State private var content: String?
    @State private var doc: NoteDocument?
    @State private var references: NoteReferences?
    @State private var error: String?
    /// A note a link in the prose opened.
    @State private var linked: String?

    var body: some View {
        let c = theme.colors
        ScrollView {
            Group {
                if let content, let doc {
                    if mode == 0 { context(doc) } else { raw(content) }
                } else if let error {
                    Text(error).foregroundStyle(c.danger)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, VVSpace.x12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, VVSpace.x4)
            .padding(.bottom, 120)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            SegmentedNav(items: ["Context", "Raw"], selected: $mode).background(c.surface)
        }
        .background(c.surface)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .environment(\.openURL, OpenURLAction(handler: open))
        .navigationDestination(item: $linked) { target in
            ContextNoteView(path: target, title: Self.fallbackTitle(target))
        }
        .task {
            guard let id = space.current?.id else { return }
            switch await ContextRepository().note(spaceId: id, path: path) {
            case .success(let r):
                content = r.content
                doc = NoteDocument(r.content)
            case .failure(let m): error = m
            }
            if case .success(let refs) = await ContextRepository().references(spaceId: id, path: path) {
                references = refs
            }
        }
    }

    // MARK: context

    @ViewBuilder private func context(_ doc: NoteDocument) -> some View {
        let c = theme.colors
        VStack(alignment: .leading, spacing: VVSpace.x4) {
            VStack(alignment: .leading, spacing: VVSpace.x1_5) {
                Text(doc.title ?? title)
                    .font(.custom("Visvine-Medium", size: 30, relativeTo: .largeTitle))
                    .foregroundStyle(c.fg)
                if let d = doc.description {
                    Text(d).font(.system(size: VVFontSize.s16)).foregroundStyle(c.fgMuted)
                }
            }
            .padding(.top, VVSpace.x2)
            NotePropertyRows(doc: doc)
            if !doc.blocks.isEmpty { NoteBlocksView(blocks: doc.blocks) }
            ForEach(Array(doc.children.enumerated()), id: \.offset) { _, section in
                children(section)
            }
            if let refs = references, !(refs.linked.isEmpty && refs.unlinked.isEmpty) {
                backlinks(refs)
            }
        }
    }

    private func children(_ section: NoteDocument.ChildSection) -> some View {
        group(section.title) {
            ForEach(Array(section.rows.enumerated()), id: \.offset) { _, child in
                if let target = NoteDocument.resolve(child.href, from: path) {
                    NavigationLink(value: AppRoute.contextNote(path: target, title: child.title)) {
                        row(child.title, child.description, icon: child.href.hasSuffix("index.md") ? .folder : .fileText)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func backlinks(_ refs: NoteReferences) -> some View {
        group("Linked from") {
            ForEach(refs.linked + refs.unlinked, id: \.self) { ref in
                NavigationLink(value: AppRoute.contextNote(path: ref.fromPath, title: ref.fromTitle)) {
                    row(ref.fromTitle, ref.excerpt, icon: .link)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func group(_ heading: String, @ViewBuilder _ rows: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(heading.uppercased())
                .font(.system(size: VVFontSize.s11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(theme.colors.fgMuted)
                .padding(.top, VVSpace.x3)
                .padding(.bottom, VVSpace.x1_5)
            Hairline()
            rows()
        }
    }

    private func row(_ title: String, _ detail: String?, icon: VisvineIconName) -> some View {
        let c = theme.colors
        return HStack(alignment: .top, spacing: VVSpace.x3) {
            VisvineIcon(icon, size: 17).foregroundStyle(c.fgMuted).padding(.top, VVSpace.x0_5)
            VStack(alignment: .leading, spacing: VVSpace.x0_5) {
                Text(title).font(.system(size: VVFontSize.s16, weight: .medium)).foregroundStyle(c.fg)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            VisvineIcon(.chevronRight, size: 12).foregroundStyle(c.fgSubtle).padding(.top, VVSpace.x1)
        }
        .padding(.vertical, VVSpace.x2_5)
        .contentShape(Rectangle())
    }

    // MARK: raw

    private func raw(_ content: String) -> some View {
        Text(content)
            .font(.system(size: VVFontSize.s14, design: .monospaced))
            .foregroundStyle(theme.colors.fg)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(VVSpace.x3)
            .background(theme.colors.surfaceSubtle, in: RoundedRectangle(cornerRadius: VVRadius.lg, style: .continuous))
            .padding(.top, VVSpace.x2)
    }

    // MARK: links

    /// A link to another note opens it here; anything else leaves the app.
    private func open(_ url: URL) -> OpenURLAction.Result {
        if url.scheme == nil, let target = NoteDocument.resolve(url.relativeString, from: path) {
            linked = target
            return .handled
        }
        return .systemAction
    }

    private static func fallbackTitle(_ path: String) -> String {
        let parts = path.split(separator: "/")
        let name = parts.last == "index.md" && parts.count > 1 ? parts[parts.count - 2] : parts.last ?? ""
        return name.replacingOccurrences(of: ".md", with: "")
    }
}
