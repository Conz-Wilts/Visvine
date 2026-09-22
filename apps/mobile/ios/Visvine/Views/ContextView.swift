import SwiftUI

/// The space's context as the web's tree draws it: folders open in place, each
/// level joined to its parent by guide lines — a tick into every row, a rounded
/// elbow into the last. A note opens to read. Search prunes the tree to the
/// notes whose title or path match, with every branch leading to one open.
struct ContextFolderView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SearchStore.self) private var search
    let node: ContextNode

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
            .padding(.top, 4)
            .padding(.bottom, 140)
        }
        .background(c.bgPrimary)
        .navigationTitle(node.path.isEmpty ? "Context" : node.label)
        .navigationBarTitleDisplayMode(.large)
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
            Image(systemName: n.isFolder ? (expanded ? "folder.fill" : "folder") : "doc.text")
                .font(.system(size: 19))
                .foregroundStyle(n.isFolder ? c.accentDark : c.textMuted)
                .frame(width: Self.glyph)
            Text(highlighted(n.label))
                .font(.system(size: 17, weight: n.isFolder ? .semibold : .regular))
                .foregroundStyle(c.textPrimary)
                .lineLimit(1)
                .padding(.leading, 12)
            Spacer(minLength: 8)
            if n.isFolder {
                Text("\(n.noteCount)").font(.system(size: 14)).foregroundStyle(c.textMuted)
                VisvineIcon(.chevronRight, size: 12)
                    .foregroundStyle(c.textLight)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
                    .padding(.leading, 8)
            }
        }
        .padding(.horizontal, 16)
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
        let color = theme.colors.borderDefault
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
        s[r].backgroundColor = theme.colors.accentLight
        s[r].foregroundColor = theme.colors.accentDark
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

/// One note, read: its prose without the frontmatter or the child list.
struct ContextNoteView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    let path: String
    let title: String

    @State private var body_: String?
    @State private var error: String?

    var body: some View {
        let c = theme.colors
        ScrollView {
            Group {
                if let body_ {
                    Text(markdown(body_))
                        .font(.system(size: 17))
                        .foregroundStyle(c.textPrimary)
                        .textSelection(.enabled)
                } else if let error {
                    Text(error).foregroundStyle(c.error)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 48)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .padding(.bottom, 120)
        }
        .background(c.bgPrimary)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.large)
        .task {
            guard let id = space.current?.id else { return }
            switch await ContextRepository().note(spaceId: id, path: path) {
            case .success(let r): body_ = Self.prose(r.content)
            case .failure(let m): error = m
            }
        }
    }

    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }

    static func prose(_ content: String) -> String {
        var text = content
        if text.hasPrefix("---"), let end = text.range(of: "\n---", range: text.index(text.startIndex, offsetBy: 3)..<text.endIndex) {
            text = String(text[end.upperBound...])
        }
        if let marker = text.range(of: "<!-- index:children -->") {
            text = String(text[..<marker.lowerBound])
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
