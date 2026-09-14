import Foundation

struct EventsRepository {
    private let api = APIClient.shared

    func getEvents(spaceId: String) async -> APIResult<[Event]> {
        let res: APIResult<EventsResponse> = await api.request(
            "/api/events", query: ["spaceId": spaceId]
        )
        switch res {
        case .success(let r): return .success(r.events)
        case .failure(let m): return .failure(m)
        }
    }

    func getEvent(eventId: String) async -> APIResult<Event> {
        await api.request("/api/events/\(eventId)")
    }
}
