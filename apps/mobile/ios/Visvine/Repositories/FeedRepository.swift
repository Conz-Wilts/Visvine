import Foundation

/// One space's feed — GET /api/feed?spaceId=&cursor= (docs/mobile.md § Home).
struct FeedRepository {
    private let api = APIClient.shared

    func getFeed(spaceId: String, cursor: String? = nil) async -> APIResult<FeedPage> {
        let res: APIResult<FeedPage> = await api.request("/api/feed", query: ["spaceId": spaceId, "cursor": cursor, "limit": "20"])
        switch res {
        case .success(let page):
            var copy = page
            copy.posts = page.posts.map { post in
                var p = post
                p.message.sender.image = MediaURL.resolve(post.message.sender.image)
                return p
            }
            return .success(copy)
        case .failure(let m):
            return .failure(m)
        }
    }
}
