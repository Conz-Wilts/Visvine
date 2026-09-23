import Foundation

/// Every action answers `{ result }`.
struct ActionEnvelope<T: Decodable>: Decodable {
    let result: T
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
