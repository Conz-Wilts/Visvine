import Foundation

/// GET /api/activity — mirrors lib/activity/shared/rows.ts `ActivityRow` and
/// lib/activity/service.ts `ActivityPage`. `kind` and `target.type` stay
/// strings so a kind this build does not know still decodes and draws as a
/// plain row.
struct ActivityActor: Codable, Hashable {
    let id: String
    var name: String
    var image: String?
}

/// The server's `target` union, flattened: `type` says which fields are set.
struct ActivityTarget: Codable, Hashable {
    var type: String
    var spaceId: String?
    var agentName: String?
    var runId: String?
    var conversationId: String?
    var messageId: String?
    var userId: String?
    var requestId: String?
    var eventId: String?
}

/// A door an admin may press on a request row — the existing route, not a new one.
struct ActivityAction: Codable, Hashable, Identifiable {
    var id: String { "\(method) \(href) \(label)" }
    var label: String
    var method: String
    var href: String
    /// Kept as raw JSON: the body is whatever the route wants.
    var body: JSONValue?
}

struct ActivityRow: Codable, Identifiable, Hashable {
    let id: String
    var kind: String
    var at: String
    var title: String
    var subtitle: String?
    var space: NamedRef?
    var actor: ActivityActor?
    var href: String
    var target: ActivityTarget
    var actions: [ActivityAction]?
}

struct ActivityPage: Codable {
    var upcoming: [ActivityRow]
    var items: [ActivityRow]
    var nextCursor: String?
}

/// Any JSON, kept as data so an action body round-trips untouched.
indirect enum JSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not JSON")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}
