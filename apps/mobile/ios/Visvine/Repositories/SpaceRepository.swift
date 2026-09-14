import Foundation

struct SpaceRepository {
    private let api = APIClient.shared

    func getSpaces() async -> APIResult<[Space]> {
        let res: APIResult<SpacesResponse> = await api.request("/api/data/spaces")
        switch res {
        case .success(let r): return .success(r.spaces.map(resolve))
        case .failure(let m): return .failure(m)
        }
    }

    // Mirrors resolveSpace: image = resolveMediaUrl(imageUrl ?? image)
    private func resolve(_ c: Space) -> Space {
        var copy = c
        copy.image = MediaURL.resolve(c.imageUrl ?? c.image)
        return copy
    }
}
