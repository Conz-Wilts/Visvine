import SwiftUI

/// A note's prose, drawn block by block. Inline styling (bold, italic, code,
/// links) is the system markdown parser's; the blocks are `NoteDocument`'s.
struct NoteBlocksView: View {
    @Environment(ThemeStore.self) private var theme
    let blocks: [NoteBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: VVSpace.x3_5) {
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
                .foregroundStyle(c.fg)
                .padding(.top, level <= 2 ? 8 : 4)
        case let .paragraph(text):
            Text(inline(text))
                .font(.system(size: 17))
                .foregroundStyle(c.fg)
                .lineSpacing(3)
        case let .list(items):
            VStack(alignment: .leading, spacing: VVSpace.x1_5) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    listRow(item)
                }
            }
        case let .quote(inner):
            HStack(alignment: .top, spacing: VVSpace.x3) {
                Rectangle().fill(c.line).frame(width: 3)
                NoteBlocksView(blocks: inner).foregroundStyle(c.fgSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case let .code(_, code):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: VVFontSize.s14, design: .monospaced))
                    .foregroundStyle(c.fg)
                    .padding(VVSpace.x3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(c.surfaceMuted, in: RoundedRectangle(cornerRadius: VVRadius.lg, style: .continuous))
        case let .table(header, rows):
            table(header, rows)
        case let .image(alt, src):
            if let url = URL(string: MediaURL.resolve(src) ?? src) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: VVRadius.lg, style: .continuous))
                    } else {
                        Text(alt).font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted)
                    }
                }
            }
        case .rule:
            Hairline().padding(.vertical, VVSpace.x1)
        }
    }

    private func listRow(_ item: NoteDocument.ListItem) -> some View {
        let c = theme.colors
        return HStack(alignment: .firstTextBaseline, spacing: VVSpace.x2) {
            switch item.marker {
            case .bullet:
                Text("•").foregroundStyle(c.fgMuted).frame(width: 14)
            case .number(let n):
                Text("\(n).").font(.system(size: 17).monospacedDigit()).foregroundStyle(c.fgMuted)
                    .frame(minWidth: 20, alignment: .trailing)
            case .task(let done):
                VisvineIcon(done ? .checkSquare : .square, size: 16)
                    .foregroundStyle(done ? c.accentStrong : c.fgMuted)
                    .frame(width: 18)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
            }
            Text(inline(item.text))
                .font(.system(size: 17))
                .foregroundStyle(done(item) ? c.fgMuted : c.fg)
                .strikethrough(done(item), color: c.fgMuted)
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
                    Divider().overlay(c.lineSubtle)
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
            .font(.system(size: VVFontSize.s15, weight: head ? .semibold : .regular))
            .foregroundStyle(head ? theme.colors.fgSecondary : theme.colors.fg)
            .frame(minWidth: 80, maxWidth: 260, alignment: .leading)
            .padding(.vertical, VVSpace.x2)
            .padding(.trailing, VVSpace.x4)
    }

    private func inline(_ s: String) -> AttributedString {
        var out = (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
        for run in out.runs where run.link != nil {
            out[run.range].foregroundColor = theme.colors.accentStrong
        }
        return out
    }
}
