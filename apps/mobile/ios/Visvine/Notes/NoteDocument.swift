import Foundation

/// A note's markdown taken apart for reading: frontmatter, prose blocks and
/// the machine-maintained child list. Pure — no SwiftUI — so it is tested.
struct NoteDocument: Equatable {
    var frontmatter: [String: FMValue]
    var blocks: [NoteBlock]
    var children: [ChildSection]

    init(_ content: String) {
        let (fm, body) = Self.splitFrontmatter(content)
        let (prose, children) = Self.splitChildren(body)
        frontmatter = fm
        self.children = children
        var blocks = Self.parseBlocks(prose)
        // A leading `# Title` repeating the title is the title, drawn once.
        if case .heading(1, let text)? = blocks.first,
           let title = fm["title"]?.string, text.caseInsensitiveCompare(title) == .orderedSame {
            blocks.removeFirst()
        }
        self.blocks = blocks
    }

    var title: String? { frontmatter["title"]?.string }
    var type: String? { frontmatter["type"]?.string }
    var description: String? { frontmatter["description"]?.string }
    var tags: [String] { frontmatter["tags"]?.list ?? [] }

    // MARK: frontmatter

    enum FMValue: Equatable {
        case scalar(String)
        case list([String])

        var string: String? {
            if case .scalar(let s) = self, !s.isEmpty { return s }
            return nil
        }
        var list: [String] {
            switch self {
            case .list(let l): return l
            case .scalar(let s): return s.isEmpty ? [] : [s]
            }
        }
    }

    /// The YAML a note carries: `key: value`, `key: [a, b]`, and `key:` over
    /// `- item` lines. A nested map is skipped — nothing here draws one.
    static func splitFrontmatter(_ content: String) -> ([String: FMValue], String) {
        let lines = content.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---",
              let end = lines.dropFirst().firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == "---" })
        else { return ([:], content) }
        var fm: [String: FMValue] = [:]
        var pendingKey: String?
        var pendingList: [String] = []
        func flush() {
            if let k = pendingKey { fm[k] = .list(pendingList) }
            pendingKey = nil
            pendingList = []
        }
        for raw in lines[1..<end] {
            if raw.hasPrefix(" ") || raw.hasPrefix("\t") || raw.hasPrefix("-") {
                let t = raw.trimmingCharacters(in: .whitespaces)
                if pendingKey != nil, t.hasPrefix("- ") {
                    pendingList.append(unquote(String(t.dropFirst(2))))
                } else if pendingKey != nil, !t.isEmpty {
                    pendingKey = nil  // a nested map, not a list
                    pendingList = []
                }
                continue
            }
            flush()
            guard let colon = raw.firstIndex(of: ":") else { continue }
            let key = raw[..<colon].trimmingCharacters(in: .whitespaces)
            let value = raw[raw.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if value.isEmpty {
                pendingKey = key
            } else if value.hasPrefix("[") && value.hasSuffix("]") {
                let inner = value.dropFirst().dropLast()
                fm[key] = .list(inner.split(separator: ",").map { unquote($0.trimmingCharacters(in: .whitespaces)) }.filter { !$0.isEmpty })
            } else {
                fm[key] = .scalar(unquote(value))
            }
        }
        flush()
        let body = lines[(end + 1)...].joined(separator: "\n")
        return (fm, body)
    }

    private static func unquote(_ s: String) -> String {
        guard s.count >= 2, let f = s.first, f == s.last, f == "\"" || f == "'" else { return s }
        return String(s.dropFirst().dropLast())
    }

    // MARK: child list

    struct ChildSection: Equatable {
        var title: String
        var rows: [Child]
    }

    struct Child: Equatable {
        var title: String
        var href: String
        var description: String?
    }

    static let childrenMarker = "<!-- index:children -->"

    /// The index block (OKF §8): `## Section` over `* [Title](href) - description`.
    static func splitChildren(_ body: String) -> (String, [ChildSection]) {
        guard let marker = body.range(of: childrenMarker) else { return (body, []) }
        let prose = String(body[..<marker.lowerBound])
        var block = String(body[marker.upperBound...])
        if let close = block.range(of: "<!-- /index:children -->") { block = String(block[..<close.lowerBound]) }
        var sections: [ChildSection] = []
        for raw in block.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("## ") {
                sections.append(ChildSection(title: String(line.dropFirst(3)), rows: []))
            } else if line.hasPrefix("* [") || line.hasPrefix("- [") {
                guard let close = line.range(of: "]("),
                      let paren = line[close.upperBound...].firstIndex(of: ")") else { continue }
                let title = String(line[line.index(line.startIndex, offsetBy: 3)..<close.lowerBound])
                let href = String(line[close.upperBound..<paren])
                var rest = line[line.index(after: paren)...].trimmingCharacters(in: .whitespaces)
                if rest.hasPrefix("- ") { rest = String(rest.dropFirst(2)) }
                if sections.isEmpty { sections.append(ChildSection(title: "Notes", rows: [])) }
                sections[sections.count - 1].rows.append(Child(title: title, href: href, description: rest.isEmpty ? nil : rest))
            }
        }
        return (prose, sections.filter { !$0.rows.isEmpty })
    }

    // MARK: blocks

    static func parseBlocks(_ prose: String) -> [NoteBlock] {
        let lines = prose.components(separatedBy: "\n")
        var out: [NoteBlock] = []
        var para: [String] = []
        var i = 0
        func flushPara() {
            if !para.isEmpty { out.append(.paragraph(para.joined(separator: "\n"))) }
            para = []
        }
        while i < lines.count {
            let line = lines[i]
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { flushPara(); i += 1; continue }

            if t.hasPrefix("```") || t.hasPrefix("~~~") {
                flushPara()
                let fence = String(t.prefix(3))
                let lang = t.dropFirst(3).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
                    code.append(lines[i]); i += 1
                }
                i += 1
                out.append(.code(lang.isEmpty ? nil : lang, code.joined(separator: "\n")))
                continue
            }
            if let (level, text) = heading(t) {
                flushPara(); out.append(.heading(level, text)); i += 1; continue
            }
            if isRule(t) {
                flushPara(); out.append(.rule); i += 1; continue
            }
            if t.hasPrefix(">") {
                flushPara()
                var quote: [String] = []
                while i < lines.count {
                    let q = lines[i].trimmingCharacters(in: .whitespaces)
                    guard q.hasPrefix(">") else { break }
                    quote.append(q.dropFirst().trimmingCharacters(in: .whitespaces)); i += 1
                }
                out.append(.quote(parseBlocks(quote.joined(separator: "\n"))))
                continue
            }
            if t.hasPrefix("|"), i + 1 < lines.count, isTableRule(lines[i + 1]) {
                flushPara()
                let header = cells(t)
                i += 2
                var rows: [[String]] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    rows.append(cells(lines[i])); i += 1
                }
                out.append(.table(header: header, rows: rows))
                continue
            }
            if listMarker(line) != nil {
                flushPara()
                var items: [ListItem] = []
                while i < lines.count, let m = listMarker(lines[i]) {
                    items.append(m); i += 1
                    // A wrapped continuation line joins the item above.
                    while i < lines.count {
                        let next = lines[i]
                        let nt = next.trimmingCharacters(in: .whitespaces)
                        guard !nt.isEmpty, listMarker(next) == nil, next.hasPrefix("  ") else { break }
                        items[items.count - 1].text += " " + nt; i += 1
                    }
                }
                out.append(.list(items))
                continue
            }
            if let img = image(t) {
                flushPara(); out.append(img); i += 1; continue
            }
            para.append(t)
            i += 1
        }
        flushPara()
        return out
    }

    private static func heading(_ t: String) -> (Int, String)? {
        let hashes = t.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes), t.dropFirst(hashes).first == " " else { return nil }
        return (min(hashes, 4), t.dropFirst(hashes + 1).trimmingCharacters(in: .whitespaces))
    }

    private static func isRule(_ t: String) -> Bool {
        let s = t.replacingOccurrences(of: " ", with: "")
        guard s.count >= 3, let f = s.first, "-*_".contains(f) else { return false }
        return s.allSatisfy { $0 == f }
    }

    private static func isTableRule(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        return t.hasPrefix("|") && t.contains("-") && t.allSatisfy { "|-: ".contains($0) }
    }

    private static func cells(_ line: String) -> [String] {
        var t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") { t.removeLast() }
        return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func image(_ t: String) -> NoteBlock? {
        guard t.hasPrefix("!["), t.hasSuffix(")"), let mid = t.range(of: "](") else { return nil }
        let alt = String(t[t.index(t.startIndex, offsetBy: 2)..<mid.lowerBound])
        let src = String(t[mid.upperBound..<t.index(before: t.endIndex)])
        return .image(alt: alt, src: src)
    }

    struct ListItem: Equatable {
        var depth: Int
        var marker: Marker
        var text: String
    }

    enum Marker: Equatable {
        case bullet
        case number(Int)
        case task(done: Bool)
    }

    static func listMarker(_ line: String) -> ListItem? {
        let indent = line.prefix { $0 == " " || $0 == "\t" }.reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }
        let t = line.trimmingCharacters(in: .whitespaces)
        let depth = indent / 2
        if t.hasPrefix("- ") || t.hasPrefix("* ") || t.hasPrefix("+ ") {
            let rest = String(t.dropFirst(2))
            for (box, done) in [("[ ] ", false), ("[x] ", true), ("[X] ", true)] where rest.hasPrefix(box) {
                return ListItem(depth: depth, marker: .task(done: done), text: String(rest.dropFirst(4)))
            }
            return ListItem(depth: depth, marker: .bullet, text: rest)
        }
        let digits = t.prefix { $0.isNumber }
        if !digits.isEmpty, digits.count <= 9 {
            let after = t.dropFirst(digits.count)
            if after.hasPrefix(". ") || after.hasPrefix(") ") {
                return ListItem(depth: depth, marker: .number(Int(digits) ?? 1), text: String(after.dropFirst(2)))
            }
        }
        return nil
    }

    // MARK: links

    /// A note-relative href resolved to a context path (the web's
    /// `resolveOkfLink`): `../craig/index.md` from `people/ana/index.md` →
    /// `people/craig/index.md`. Nil for anything that leaves the context.
    static func resolve(_ href: String, from notePath: String) -> String? {
        var h = href.removingPercentEncoding ?? href
        if let hash = h.firstIndex(of: "#") { h = String(h[..<hash]) }
        guard !h.isEmpty, !h.contains("://"), !h.hasPrefix("mailto:") else { return nil }
        var parts: [String]
        if h.hasPrefix("/") {
            parts = []
            h.removeFirst()
        } else {
            parts = notePath.split(separator: "/").map(String.init)
            parts.removeLast()
        }
        for seg in h.split(separator: "/") {
            switch seg {
            case ".": continue
            case "..": if !parts.isEmpty { parts.removeLast() }
            default: parts.append(String(seg))
            }
        }
        let path = parts.joined(separator: "/")
        return path.hasSuffix(".md") ? path : nil
    }
}

indirect enum NoteBlock: Equatable {
    case heading(Int, String)
    case paragraph(String)
    case list([NoteDocument.ListItem])
    case quote([NoteBlock])
    case code(String?, String)
    case table(header: [String], rows: [[String]])
    case image(alt: String, src: String)
    case rule
}
