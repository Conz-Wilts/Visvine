import SwiftUI

/// One folder of the space's context: its folders, then its notes.
struct ContextFolderView: View {
    @Environment(ThemeStore.self) private var theme
    let node: ContextNode

    var body: some View {
        let c = theme.colors
        List {
            ForEach(rows) { child in
                NavigationLink(value: child.isFolder
                               ? AppRoute.contextFolder(child)
                               : AppRoute.contextNote(path: child.path, title: child.label)) {
                    HStack(spacing: 12) {
                        Image(systemName: child.isFolder ? "folder" : "doc.text")
                            .foregroundStyle(c.textMuted)
                            .frame(width: 22)
                        Text(child.label).foregroundStyle(c.textPrimary).lineLimit(1)
                        Spacer()
                        if child.isFolder {
                            Text("\(child.noteCount)").font(.system(size: 13)).foregroundStyle(c.textMuted)
                        }
                    }
                }
                .listRowBackground(c.bgPrimary)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(c.bgPrimary)
        .navigationTitle(node.path.isEmpty ? "Context" : node.label)
        .navigationBarTitleDisplayMode(.large)
    }

    /// Empty folders are not drawn; the folder's own index is the folder.
    private var rows: [ContextNode] {
        (node.children ?? []).filter { child in
            child.isFolder ? child.noteCount > 0 : !child.name.hasSuffix("index.md")
        }
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
