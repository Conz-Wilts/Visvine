import SwiftUI

/// The property rows a type shows on its note — the mirror of the web's
/// `lib/create/typeFields.ts`, read from the note's frontmatter.
enum NoteFields {
    enum Kind { case text, email, url, date }

    struct Field {
        let keys: [String]
        let label: String
        let kind: Kind
    }

    static func fields(for type: String?) -> [Field] {
        switch type?.lowercased() {
        case "person":
            return [
                Field(keys: ["subtitle", "role"], label: "Role", kind: .text),
                Field(keys: ["email"], label: "Email", kind: .email),
                Field(keys: ["companyName", "company"], label: "Company", kind: .text),
                Field(keys: ["linkedinUrl", "linkedin"], label: "LinkedIn", kind: .url),
                Field(keys: ["location"], label: "Location", kind: .text),
            ]
        case "space", "company":
            return [
                Field(keys: ["subtitle", "tagline"], label: "Tagline", kind: .text),
                Field(keys: ["url", "website"], label: "Website", kind: .url),
                Field(keys: ["location"], label: "HQ", kind: .text),
                Field(keys: ["founded"], label: "Founded", kind: .text),
                Field(keys: ["memberCount"], label: "Members", kind: .text),
            ]
        case "resource":
            return [
                Field(keys: ["url"], label: "Link", kind: .url),
            ]
        case "event":
            return [
                Field(keys: ["start_at"], label: "Date", kind: .date),
                Field(keys: ["end_at"], label: "Ends", kind: .date),
                Field(keys: ["location"], label: "Location", kind: .text),
                Field(keys: ["capacity"], label: "Capacity", kind: .text),
                Field(keys: ["organizerEmail"], label: "Organizer", kind: .email),
            ]
        default:
            return []
        }
    }
}

/// Type, the type's own fields, then tags — label over value, hairline-split.
struct NotePropertyRows: View {
    @Environment(ThemeStore.self) private var theme
    let doc: NoteDocument

    private struct Row: Identifiable {
        let label: String
        let value: String
        let kind: NoteFields.Kind
        var id: String { label }
    }

    private var rows: [Row] {
        NoteFields.fields(for: doc.type).compactMap { f in
            guard let v = f.keys.lazy.compactMap({ doc.frontmatter[$0]?.string }).first else { return nil }
            return Row(label: f.label, value: v, kind: f.kind)
        }
    }

    var body: some View {
        let c = theme.colors
        let rows = rows
        if doc.type != nil || !rows.isEmpty || !doc.tags.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Hairline()
                if let type = doc.type {
                    entry("Type") {
                        let swatch = VVTypeColor.named(type)
                        chip(type, swatch.wash, swatch.fg)
                    }
                }
                ForEach(rows) { row in
                    entry(row.label) { value(row) }
                }
                if !doc.tags.isEmpty {
                    entry("Tags") {
                        FlowRow(spacing: VVSpace.x1_5) {
                            ForEach(doc.tags, id: \.self) { chip("#" + $0, c.surfaceMuted, c.fgSecondary) }
                        }
                    }
                }
                Hairline()
            }
        }
    }

    private func entry(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: VVSpace.x1) {
            Text(label.uppercased())
                .font(.system(size: VVFontSize.s11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(theme.colors.fgMuted)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, VVSpace.x2)
    }

    @ViewBuilder private func value(_ row: Row) -> some View {
        let c = theme.colors
        let text = Text(display(row)).font(.system(size: VVFontSize.s16))
        if let url = link(row) {
            Link(destination: url) { text.foregroundStyle(c.accentStrong) }
        } else {
            text.foregroundStyle(c.fg).textSelection(.enabled)
        }
    }

    private func display(_ row: Row) -> String {
        switch row.kind {
        case .url:
            return row.value.replacingOccurrences(of: "https://", with: "")
                .replacingOccurrences(of: "http://", with: "")
                .replacingOccurrences(of: "www.", with: "")
        case .date:
            guard let d = Self.parseDate(row.value) else { return row.value }
            return d.formatted(date: .abbreviated, time: row.value.contains("T") ? .shortened : .omitted)
        default:
            return row.value
        }
    }

    private func link(_ row: Row) -> URL? {
        switch row.kind {
        case .email: return URL(string: "mailto:" + row.value)
        case .url: return URL(string: row.value.contains("://") ? row.value : "https://" + row.value)
        default: return nil
        }
    }

    private static func parseDate(_ s: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: s) { return d }
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: s) { return d }
        iso.formatOptions = [.withFullDate]
        return iso.date(from: String(s.prefix(10)))
    }

    private func chip(_ text: String, _ bg: Color, _ fg: Color) -> some View {
        Text(text)
            .font(.system(size: VVFontSize.s13, weight: .medium))
            .foregroundStyle(fg)
            .padding(.horizontal, VVSpace.x2)
            .padding(.vertical, 3)
            .background(bg, in: RoundedRectangle(cornerRadius: VVRadius.md, style: .continuous))
    }
}

/// Chips that wrap onto as many lines as they need.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += line + spacing; line = 0 }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            line = max(line, size.height)
        }
        return CGSize(width: widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += line + spacing; line = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
