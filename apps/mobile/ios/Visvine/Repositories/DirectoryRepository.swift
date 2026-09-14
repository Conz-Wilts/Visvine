import Foundation

struct DirectoryRepository {
    private let api = APIClient.shared

    func getMembers(spaceId: String) async -> APIResult<[DirectoryMember]> {
        let res: APIResult<NodesResponse> = await api.request(
            "/api/data/nodes", query: ["space_id": spaceId]
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
