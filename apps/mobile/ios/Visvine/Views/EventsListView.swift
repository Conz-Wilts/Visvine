import SwiftUI
import Observation

@Observable
@MainActor
final class EventsListModel {
    var events: [Event] = []
    var loading = true
    var refreshing = false
    var error: String?

    private let repo = EventsRepository()

    func load(communityId: String?) async {
        guard let communityId else { events = []; loading = false; return }
        loading = true
        await fetch(communityId)
        loading = false
    }
    func refresh(communityId: String?) async {
        guard let communityId else { return }
        await fetch(communityId)
    }
    private func fetch(_ communityId: String) async {
        switch await repo.getEvents(communityId: communityId) {
        case .success(let list): events = list; error = nil
        case .failure(let m): error = m
        }
    }
    func filtered(query: String) -> [Event] { rankByQuery(events, query: query) { $0.title } }
}

/// Port of screens/Events/EventsListScreen.tsx.
struct EventsListView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(CommunityStore.self) private var community
    @Environment(SearchStore.self) private var search
    @State private var model = EventsListModel()

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(showCommunitySelector: true, onProfile: onProfile)
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if community.current == nil {
                emptyState("Select a space to view events")
            } else {
                ScrollView {
                    if let error = model.error {
                        Text(error).foregroundStyle(c.error).padding().frame(maxWidth: .infinity, alignment: .leading)
                            .background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 12)).padding(16)
                    }
                    let items = model.filtered(query: search.query)
                    if items.isEmpty {
                        emptyState("No events found")
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(items) { event in
                                NavigationLink(value: AppRoute.eventDetail(eventId: event.id, title: event.title)) {
                                    EventCard(event: event)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(16)
                    }
                }
                .refreshable { await model.refresh(communityId: community.current?.id) }
            }
        }
        .background(c.bgSecondary)
        .task(id: community.current?.id) { await model.load(communityId: community.current?.id) }
        .onAppear { search.placeholder = "Search events" }
    }

    private func emptyState(_ text: String) -> some View {
        let c = theme.colors
        return VStack(spacing: 12) {
            ZStack {
                Circle().fill(c.bgTertiary).frame(width: 72, height: 72)
                Image(systemName: "calendar").font(.system(size: 32)).foregroundStyle(c.textMuted)
            }
            Text(text).font(.system(size: 16, weight: .medium)).foregroundStyle(c.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(.vertical, 48)
    }
}

private struct EventCard: View {
    @Environment(ThemeStore.self) private var theme
    let event: Event

    var body: some View {
        let c = theme.colors
        let upcoming = DateFormatting.isUpcoming(event.startAt)
        let analytics = event.analytics ?? EventAnalytics(views: 0, rsvpCount: 0, checkinCount: 0)
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Text(DateFormatting.monthShort(event.startAt).uppercased()).font(.system(size: 11, weight: .semibold)).foregroundStyle(c.accentDark)
                Text(DateFormatting.dayOfMonth(event.startAt)).font(.system(size: 22, weight: .bold)).foregroundStyle(c.textPrimary)
            }
            .frame(width: 52).padding(.vertical, 8).background(c.accentLight, in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top) {
                    Text(event.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(c.textPrimary).lineLimit(2)
                    Spacer()
                    if upcoming {
                        Text("Upcoming").font(.system(size: 11, weight: .semibold)).foregroundStyle(c.accentDark)
                            .padding(.horizontal, 10).padding(.vertical, 3).background(c.accentLight, in: Capsule())
                    }
                }
                if let location = event.location {
                    meta("mappin.and.ellipse", location.label)
                }
                meta("clock", "\(DateFormatting.shortDate(event.startAt)) at \(DateFormatting.time(event.startAt))")
                HStack(spacing: 10) {
                    HStack(spacing: 4) {
                        Image(systemName: "person.2").font(.system(size: 12))
                        Text("\(analytics.rsvpCount) RSVPs").font(.system(size: 12))
                    }.foregroundStyle(c.textMuted)
                    if let capacity = event.capacity {
                        Text("\(capacity - analytics.rsvpCount) spots left").font(.system(size: 11, weight: .medium))
                            .foregroundStyle(c.accentDark).padding(.horizontal, 8).padding(.vertical, 2).background(c.accentLight, in: Capsule())
                    }
                }
                .padding(.top, 6)
            }
        }
        .padding(16).background(c.bgPrimary, in: RoundedRectangle(cornerRadius: 16))
    }

    private func meta(_ icon: String, _ text: String) -> some View {
        let c = theme.colors
        return HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 12))
            Text(text).font(.system(size: 13)).lineLimit(1)
        }.foregroundStyle(c.textMuted)
    }
}
