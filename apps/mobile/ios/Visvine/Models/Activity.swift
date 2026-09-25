import Foundation

/// Activity — everything about the caller, in one row shape. Mirrors
/// lib/activity/shared/rows.ts `ActivityRow` and lib/activity/service.ts
/// `ActivityPage`. The `target` union is flattened: every key is optional and
/// `type` says which are set.
struct ActivityActor: Codable, Hashable {
    let id: String
    var name: String = ""
    var image: String?
}

struct ActivityTarget: Codable, Hashable {
    /// `agent` | `conversation` | `members` | `accessRequests` | `event`.
    var type: String = ""
    var spaceId: String?
    var agentName: String?
    var runId: String?
    var conversationId: String?
    var messageId: String?
    var userId: String?
    var requestId: String?
    var eventId: String?
}

/// Any JSON value — a row's decision body is passed back exactly as it came.
enum JSONValue: Codable, Hashable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }
}

/// A door that already exists — approve or decline through the member and access-request routes.
struct ActivityAction: Codable, Hashable {
    /// `Approve` | `Decline`.
    var label: String = ""
    /// `PUT` | `DELETE`.
    var method: String = "PUT"
    /// Absolute path under the API origin, e.g. `/api/notes/access-requests`.
    var href: String = ""
    var body: JSONValue?
}

struct ActivityRow: Codable, Hashable, Identifiable {
    /// `<kind>:<source row id>` — stable, so a page never repeats one.
    let id: String
    /// `run` | `mention` | `reply` | `join_request` | `access_request` | `event`.
    var kind: String = ""
    var at: String = ""
    var title: String = ""
    var subtitle: String?
    var space: NamedRef?
    var actor: ActivityActor?
    var href: String = ""
    var target: ActivityTarget = ActivityTarget()
    var actions: [ActivityAction] = []
}

/// GET /api/activity → `upcoming` on the first page only, `items` newest first.
struct ActivityPage: Codable {
    var upcoming: [ActivityRow] = []
    var items: [ActivityRow] = []
    var nextCursor: String?
}
