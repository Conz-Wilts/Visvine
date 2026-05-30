import Foundation

/// Community event — mirrors src/types/index.ts `Event`.
struct Event: Codable, Identifiable {
    let id: String
    var communityId: String?
    let title: String
    var description: String?
    let startAt: String
    var endAt: String?
    var timezone: String?
    var location: EventLocation?
    var hosts: [String]?
    var capacity: Int?
    var visibility: String?
    var analytics: EventAnalytics?
}

struct EventLocation: Codable {
    var label: String
    var address: String?
    var lat: Double?
    var lon: Double?
}

struct EventAnalytics: Codable {
    var views: Int
    var rsvpCount: Int
    var checkinCount: Int
}

struct EventsResponse: Codable {
    let events: [Event]
}
