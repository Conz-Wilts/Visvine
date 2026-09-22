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

    func load(spaceId: String?) async {
        guard let spaceId else { events = []; loading = false; return }
        loading = true
        await fetch(spaceId)
        loading = false
    }
    func refresh(spaceId: String?) async {
        guard let spaceId else { return }
        await fetch(spaceId)
    }
    private func fetch(_ spaceId: String) async {
        switch await repo.getEvents(spaceId: spaceId) {
        case .success(let list): events = list; error = nil
        case .failure(let m): error = m
        }
    }
    func filtered(query: String) -> [Event] { rankByQuery(events, query: query) { $0.title } }
}

/// One section of the feed, in the order EventsFeedView files them: undated
/// first (an event nobody can see is an event nobody dates), then the next one
/// up on its own, then the rest by month, then what has already happened.
private struct EventSection: Identifiable {
    let id: String
    let title: String
    let events: [Event]
    var featured = false
    var past = false
}

private func sections(for events: [Event]) -> [EventSection] {
    let undated = events.filter { $0.startAt.isEmpty }
    let dated = events.filter { !$0.startAt.isEmpty }
    let upcoming = dated.filter { DateFormatting.isUpcoming($0.startAt) }.sorted { $0.startAt < $1.startAt }
    let past = dated.filter { !DateFormatting.isUpcoming($0.startAt) }.sorted { $0.startAt > $1.startAt }

    var result: [EventSection] = []
    if !undated.isEmpty {
        result.append(EventSection(id: "undated", title: "Date to be set", events: undated))
    }
    if let next = upcoming.first {
        result.append(EventSection(id: "next", title: "Next event", events: [next], featured: true))
    }
    // Month order follows the sorted list, so the keys cannot be gathered with
    // a plain dictionary — the first appearance of each month sets its place.
    var months: [String] = []
    var byMonth: [String: [Event]] = [:]
    for event in upcoming.dropFirst() {
        let key = DateFormatting.monthKey(event.startAt)
        if byMonth[key] == nil { months.append(key) }
        byMonth[key, default: []].append(event)
    }
    for month in months {
        result.append(EventSection(id: month, title: month, events: byMonth[month] ?? []))
    }
    if !past.isEmpty {
        result.append(EventSection(id: "past", title: "Past events", events: past, past: true))
    }
    return result
}

/// The events feed — the mobile face of EventsFeedView: rows on hairlines under
/// a section heading, each one a title over a single line of facts.
struct EventsListView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(SearchStore.self) private var search
    @State private var model = EventsListModel()

    var onProfile: () -> Void
    /// Drawn under Home's chips, which already carry the header.
    var embedded = false

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            if !embedded {
                ScreenHeader(title: "Events", showSpaceSelector: false, onProfile: onProfile)
            }
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if space.current == nil {
                EmptyStateView(text: "Select a space to view events", icon: .calendar)
                    .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    if let error = model.error {
                        Text(error).foregroundStyle(c.error).font(.system(size: 14))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                    }
                    let items = model.filtered(query: search.query)
                    if items.isEmpty {
                        EmptyStateView(text: "No events found", icon: .calendar)
                    } else {
                        LazyVStack(alignment: .leading, spacing: 32) {
                            ForEach(sections(for: items)) { section in
                                sectionView(section)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 120)
                    }
                }
                .refreshable { await model.refresh(spaceId: space.current?.id) }
            }
        }
        .background(c.bgPrimary)
        .task(id: space.current?.id) { await model.load(spaceId: space.current?.id) }
        .searchScope("Search events")
    }

    @ViewBuilder private func sectionView(_ section: EventSection) -> some View {
        let c = theme.colors
        VStack(alignment: .leading, spacing: 0) {
            Text(section.title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .kerning(0.9)
                .foregroundStyle(c.textMuted)
            ForEach(Array(section.events.enumerated()), id: \.element.id) { index, event in
                if index > 0 {
                    Rectangle().fill(c.borderSubtle).frame(height: 1)
                }
                NavigationLink(value: AppRoute.eventDetail(eventId: event.id, title: event.title)) {
                    EventRow(event: event, featured: section.featured, past: section.past)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct EventRow: View {
    @Environment(ThemeStore.self) private var theme
    let event: Event
    var featured = false
    var past = false

    var body: some View {
        let c = theme.colors
        // Everything the old badges said, as one line of text under the title:
        // when · where · how many. The countdown leads it in the accent when
        // there is one; a past event just dims.
        let countdown = past ? nil : DateFormatting.startsInLabel(event.startAt)
        let attendees = event.analytics?.rsvpCount ?? 0
        // A location without coordinates is an online event, the same test
        // EventsFeedView makes.
        let isVirtual = event.location?.lat == nil
        let facts = [
            DateFormatting.fullDate(event.startAt, endAt: event.endAt),
            isVirtual ? "Virtual" : event.location?.label,
            attendees > 0 ? "\(attendees) going" : nil,
        ].compactMap { $0 }.joined(separator: " · ")

        return VStack(alignment: .leading, spacing: 4) {
            Text(event.title)
                .font(.system(size: featured ? 20 : 17, weight: .semibold))
                .foregroundStyle(c.textPrimary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)

            Group {
                if let countdown {
                    Text("\(Text(countdown).font(.system(size: 14, weight: .semibold)).foregroundStyle(c.accentDark))\(Text(" · \(facts)").font(.system(size: 14)).foregroundStyle(c.textSecondary))")
                } else {
                    Text(facts).font(.system(size: 14)).foregroundStyle(c.textSecondary)
                }
            }
            .lineLimit(2)
            .multilineTextAlignment(.leading)

            if let description = event.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 14))
                    .foregroundStyle(c.textSecondary)
                    .lineLimit(featured ? 3 : 2)
                    .multilineTextAlignment(.leading)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 20)
        .opacity(past ? 0.7 : 1)
    }
}
