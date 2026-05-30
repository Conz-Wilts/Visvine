import Foundation

struct DirectoryRepository {
    private let api = APIClient.shared

    func getMembers(communityId: String) async -> APIResult<[DirectoryMember]> {
        let res: APIResult<NodesResponse> = await api.request(
            "/api/data/nodes", query: ["community_id": communityId]
        )
        switch res {
        case .success(let r):
            return .success(r.nodes.map { member in
                var copy = member
                copy.imageUrl = MediaURL.resolve(member.imageUrl)
                return copy
            })
        case .failure(let m):
            return .failure(m)
        }
    }
}
