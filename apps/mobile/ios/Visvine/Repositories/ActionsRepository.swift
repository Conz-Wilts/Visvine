import Foundation

/// Home's quick capture, through the actions layer (docs/mobile.md § Quick capture).
struct ActionsRepository {
    private let api = APIClient.shared

    enum CaptureKind: String, CaseIterable, Identifiable {
        case note, person, space, resource
        var id: String { rawValue }
        var label: String {
            switch self {
            case .note: return "Note"
            case .person: return "Person"
            case .space: return "Space"
            case .resource: return "Resource"
            }
        }
    }

    /// What a capture became, said in one line for the composer.
    struct Captured {
        let line: String
    }

    func capture(spaceId: String, kind: CaptureKind, text: String, now: Date = Date()) async -> APIResult<Captured> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let firstLine = trimmed.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: true).first.map(String.init) ?? trimmed
        let title = String(firstLine.prefix(80))
        switch kind {
        case .note:
            let path = "inbox/\(Self.stamp(now))-\(Self.slug(title)).md"
            let content = "---\ntitle: \(Self.yaml(title))\ntags: [capture]\n---\n\n\(trimmed)\n"
            let body = try? JSONEncoder().encode(EditContextRequest(spaceId: spaceId, path: path, content: content))
            let res: APIResult<ActionEnvelope<EditContextResult>> = await api.request("/api/actions/edit_context", method: "POST", body: body)
            switch res {
            case .success(let r): return .success(Captured(line: "Saved to \(r.result.path ?? path)"))
            case .failure(let m): return .failure(m)
            }
        case .person, .space, .resource:
            let rest = trimmed.dropFirst(firstLine.count).trimmingCharacters(in: .whitespacesAndNewlines)
            let body = try? JSONEncoder().encode(AddContextRequest(spaceId: spaceId, type: kind.rawValue, name: title, body: rest.isEmpty ? nil : rest))
            let res: APIResult<ActionEnvelope<AddContextResult>> = await api.request("/api/actions/add_context", method: "POST", body: body)
            switch res {
            case .success(let r): return .success(Captured(line: "Added \(r.result.name ?? title)"))
            case .failure(let m): return .failure(m)
            }
        }
    }

    /// `2026-09-22-1432`
    static func stamp(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd-HHmm"
        return f.string(from: date)
    }

    /// A file-safe slug from a line of text, at most 40 chars; `note` when nothing survives.
    static func slug(_ text: String) -> String {
        let lowered = text.lowercased()
        var out = ""
        var lastDash = true
        for ch in lowered {
            if ch.isLetter || ch.isNumber {
                out.append(ch)
                lastDash = false
            } else if !lastDash {
                out.append("-")
                lastDash = true
            }
            if out.count >= 40 { break }
        }
        while out.hasSuffix("-") { out.removeLast() }
        return out.isEmpty ? "note" : out
    }

    /// A YAML scalar that survives a colon or a quote in the title.
    static func yaml(_ text: String) -> String {
        let escaped = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }
}
