import Foundation

/// POST /api/actions/edit_context — the action's Zod input, so snake_case
/// (lib/actions/defs/context.ts). Home's quick capture writes a note with it.
struct EditContextRequest: Codable {
    let spaceId: String
    let path: String
    let content: String

    enum CodingKeys: String, CodingKey {
        case spaceId = "space_id"
        case path, content
    }
}

/// POST /api/actions/add_context — a Person / Space / Resource record.
struct AddContextRequest: Codable {
    let spaceId: String
    /// "person" | "space" | "resource"
    let type: String
    let name: String
    var body: String?

    enum CodingKeys: String, CodingKey {
        case spaceId = "space_id"
        case type, name, body
    }
}

/// Every action answers `{ result }`.
struct ActionEnvelope<T: Decodable>: Decodable {
    let result: T
}

struct EditContextResult: Decodable {
    var status: String?
    var path: String?
}

struct AddContextResult: Decodable {
    var id: String?
    var name: String?
    var path: String?
}

/// POST /api/actions/list_tools — the installed half is what a member opens.
struct ListToolsResult: Decodable {
    var installed: [InstalledTool]
}

struct InstalledTool: Decodable, Identifiable {
    let slug: String
    let title: String
    let enabled: Bool
    var id: String { slug }
}
