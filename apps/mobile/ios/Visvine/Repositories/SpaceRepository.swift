import Foundation

struct SpaceRepository {
    private let api = APIClient.shared

    /// The spaces the person has joined — what the switcher lists.
    func getJoined() async -> APIResult<[Space]> {
        let res: APIResult<UserSpacesResponse> = await api.request("/api/user/spaces")
        switch res {
        case .success(let r): return .success(r.spaces.map(resolve))
        case .failure(let m): return .failure(m)
        }
    }

    /// Every space the person can see, joined or not — Discover filters it.
    func getVisible() async -> APIResult<[Space]> {
        let res: APIResult<SpacesResponse> = await api.request("/api/data/spaces")
        switch res {
        case .success(let r): return .success(r.spaces.map(resolve))
        case .failure(let m): return .failure(m)
        }
    }

    func discoverEvents() async -> APIResult<[DiscoverEvent]> {
        let res: APIResult<DiscoverEventsResponse> = await api.request("/api/events/discover")
        switch res {
        case .success(let r):
            return .success(r.events.map { e in
                var copy = e
                copy.coverImageUrl = MediaURL.resolve(e.coverImageUrl)
                copy.spaceImageUrl = MediaURL.resolve(e.spaceImageUrl)
                return copy
            })
        case .failure(let m): return .failure(m)
        }
    }

    /// Self-join through the space's door; `pending` when the door is `ask`.
    func join(spaceId: String) async -> APIResult<JoinResponse> {
        await api.request("/api/spaces/\(spaceId)/join", method: "POST", body: Data("{}".utf8))
    }

    // Mirrors resolveSpace: image = resolveMediaUrl(imageUrl ?? image)
    private func resolve(_ c: Space) -> Space {
        var copy = c
        copy.image = MediaURL.resolve(c.imageUrl ?? c.image)
        return copy
    }
}
