import SwiftUI

/// A note's prose, drawn block by block. Inline styling (bold, italic, code,
/// links) is the system markdown parser's; the blocks are `NoteDocument`'s.
struct NoteBlocksView: View {
    @Environment(ThemeStore.self) private var theme
    let blocks: [NoteBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                view(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func view(_ block: NoteBlock) -> some View {
        let c = theme.colors
        switch block {
        case let .heading(level, text):
            Text(inline(text))
                .font(.system(size: [0, 26, 21, 18, 16][level], weight: level <= 2 ? .bold : .semibold))
                .foregroundStyle(c.textPrimary)
                .padding(.top, level <= 2 ? 8 : 4)
        case let .paragraph(text):
            Text(inline(text))
                .font(.system(size: 17))
                .foregroundStyle(c.textPrimary)
                .lineSpacing(3)
        case let .list(items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    listRow(item)
                }
            }
        case let .quote(inner):
            HStack(alignment: .top, spacing: 12) {
                Rectangle().fill(c.borderDefault).frame(width: 3)
                NoteBlocksView(blocks: inner).foregroundStyle(c.textSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case let .code(_, code):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(c.textPrimary)
                    .padding(12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        case let .table(header, rows):
            table(header, rows)
        case let .image(alt, src):
            if let url = URL(string: MediaURL.resolve(src) ?? src) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    } else {
                        Text(alt).font(.system(size: 14)).foregroundStyle(c.textMuted)
                    }
                }
            }
        case .rule:
            Hairline().padding(.vertical, 4)
        }
    }

    private func listRow(_ item: NoteDocument.ListItem) -> some View {
        let c = theme.colors
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            switch item.marker {
            case .bullet:
                Text("•").foregroundStyle(c.textMuted).frame(width: 14)
            case .number(let n):
                Text("\(n).").font(.system(size: 17).monospacedDigit()).foregroundStyle(c.textMuted)
                    .frame(minWidth: 20, alignment: .trailing)
            case .task(let done):
                VisvineIcon(done ? .checkSquare : .square, size: 16)
                    .foregroundStyle(done ? c.accentDark : c.textMuted)
                    .frame(width: 18)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
            }
            Text(inline(item.text))
                .font(.system(size: 17))
                .foregroundStyle(done(item) ? c.textMuted : c.textPrimary)
                .strikethrough(done(item), color: c.textMuted)
        }
        .padding(.leading, CGFloat(item.depth) * 20)
    }

    private func done(_ item: NoteDocument.ListItem) -> Bool {
        if case .task(true) = item.marker { return true }
        return false
    }

    private func table(_ header: [String], _ rows: [[String]]) -> some View {
        let c = theme.colors
        let width = max(header.count, rows.map(\.count).max() ?? 0)
        return ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(0..<width, id: \.self) { i in
                        cell(i < header.count ? header[i] : "", head: true)
                    }
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Divider().overlay(c.borderSubtle)
                    GridRow {
                        ForEach(0..<width, id: \.self) { i in
                            cell(i < row.count ? row[i] : "", head: false)
                        }
                    }
                }
            }
        }
    }

    private func cell(_ text: String, head: Bool) -> some View {
        Text(inline(text))
            .font(.system(size: 15, weight: head ? .semibold : .regular))
            .foregroundStyle(head ? theme.colors.textSecondary : theme.colors.textPrimary)
            .frame(minWidth: 80, maxWidth: 260, alignment: .leading)
            .padding(.vertical, 8)
            .padding(.trailing, 16)
    }

    private func inline(_ s: String) -> AttributedString {
        var out = (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
        for run in out.runs where run.link != nil {
            out[run.range].foregroundColor = theme.colors.accentDark
        }
        return out
    }
}
