import Foundation

/// A space's context, read under the caller's own grants.
struct ContextRepository {
    private let api = APIClient.shared

    func tree(spaceId: String) async -> APIResult<ContextNode> {
        let res: APIResult<ContextTreeResponse> = await api.request("/api/notes/tree", query: ["spaceId": spaceId])
        switch res {
        case .success(let r): return .success(r.tree)
        case .failure(let m): return .failure(m)
        }
    }

    func note(spaceId: String, path: String) async -> APIResult<ContextNoteResponse> {
        await api.request("/api/notes/item", query: ["spaceId": spaceId, "path": path])
    }

    func references(spaceId: String, path: String) async -> APIResult<NoteReferences> {
        let res: APIResult<NoteReferencesResponse> = await api.request("/api/notes/references", query: ["spaceId": spaceId, "path": path])
        switch res {
        case .success(let r): return .success(r.references)
        case .failure(let m): return .failure(m)
        }
    }
}
