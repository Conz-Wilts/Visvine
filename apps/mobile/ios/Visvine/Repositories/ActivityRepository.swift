import Foundation

/// Everything about you — GET /api/activity (docs/mobile.md § Activity).
struct ActivityRepository {
    private let api = APIClient.shared

    func list(cursor: String? = nil) async -> APIResult<ActivityPage> {
        let res: APIResult<ActivityPage> = await api.request("/api/activity", query: ["cursor": cursor, "limit": "30"])
        switch res {
        case .success(let page):
            var copy = page
            copy.items = page.items.map(resolve)
            copy.upcoming = page.upcoming.map(resolve)
            return .success(copy)
        case .failure(let m):
            return .failure(m)
        }
    }

    /// Press one of a request row's doors — the existing route the row names.
    func decide(_ action: ActivityAction) async -> APIResult<EmptyResponse> {
        let body = action.body.flatMap { try? JSONEncoder().encode($0) }
        return await api.request(action.href, method: action.method, body: body)
    }

    private func resolve(_ row: ActivityRow) -> ActivityRow {
        var copy = row
        if var actor = row.actor {
            actor.image = MediaURL.resolve(actor.image)
            copy.actor = actor
        }
        return copy
    }
}
