import Foundation

/// Reads through the actions layer: the space's installed Tools.
struct ActionsRepository {
    private let api = APIClient.shared

    func listTools(spaceId: String) async -> APIResult<[InstalledTool]> {
        let body = try? JSONEncoder().encode(["space_id": spaceId])
        let res: APIResult<ActionEnvelope<ListToolsResult>> = await api.request("/api/actions/list_tools", method: "POST", body: body)
        switch res {
        case .success(let r): return .success(r.result.installed)
        case .failure(let m): return .failure(m)
        }
    }
}
