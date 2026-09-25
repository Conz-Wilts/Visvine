import Foundation

/// Activity — everything about the caller (docs/mobile.md § Activity). A
/// decision goes to whatever route the row named (`actions[].href` + `method`
/// + `body`), which the API client carries like any other request.
struct ActivityRepository {
    private let api = APIClient.shared

    func list(cursor: String? = nil) async -> APIResult<ActivityPage> {
        let res: APIResult<ActivityPage> = await api.request("/api/activity", query: ["cursor": cursor])
        switch res {
        case .success(let page):
            var copy = page
            copy.items = page.items.map { row in
                var r = row
                r.actor?.image = MediaURL.resolve(row.actor?.image)
                return r
            }
            return .success(copy)
        case .failure(let m):
            return .failure(m)
        }
    }

    /// Approve or decline through the door the row named. Any 2xx is a yes.
    func decide(_ action: ActivityAction) async -> APIResult<EmptyResponse> {
        let method = action.method.isEmpty ? "PUT" : action.method.uppercased()
        let body: Data?
        if let payload = action.body {
            body = try? JSONEncoder().encode(payload)
        } else {
            body = (method == "DELETE" || method == "GET") ? nil : Data("{}".utf8)
        }
        return await api.request(action.href, method: method, body: body)
    }
}
