import Foundation

struct CommunityRepository {
    private let api = APIClient.shared

    func getCommunities() async -> APIResult<[Community]> {
        let res: APIResult<CommunitiesResponse> = await api.request("/api/data/communities")
        switch res {
        case .success(let r): return .success(r.communities.map(resolve))
        case .failure(let m): return .failure(m)
        }
    }

    // Mirrors resolveCommunity: image = resolveMediaUrl(imageUrl ?? image)
    private func resolve(_ c: Community) -> Community {
        var copy = c
        copy.image = MediaURL.resolve(c.imageUrl ?? c.image)
        return copy
    }
}
