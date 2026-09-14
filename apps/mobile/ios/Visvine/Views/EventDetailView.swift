import SwiftUI
import Observation

@Observable
@MainActor
final class EventDetailModel {
    var loading = true
    var event: Event?
    var error: String?

    private let repo = EventsRepository()

    func load(eventId: String) async {
        loading = true
        switch await repo.getEvent(eventId: eventId) {
        case .success(let e): event = e
        case .failure(let m): error = m
        }
        loading = false
    }
}

/// One event, in full: title and description, then the facts, attendance and
/// the RSVP action as blocks on the flat surface, divided by hairlines.
struct EventDetailView: View {
    @Environment(ThemeStore.self) private var theme
    @State private var model = EventDetailModel()

    let eventId: String
    let title: String?

    var body: some View {
        let c = theme.colors
        Group {
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let event = model.event {
                body(for: event)
            } else {
                Text(model.error ?? "Event not found").foregroundStyle(c.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(c.bgPrimary)
        .navigationTitle(model.event?.title ?? title ?? "Event")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(eventId: eventId) }
    }

    private func body(for event: Event) -> some View {
        let c = theme.colors
        let analytics = event.analytics ?? EventAnalytics(views: 0, rsvpCount: 0, checkinCount: 0)
        let rsvpPct = event.capacity.map { Int((Double(analytics.rsvpCount) / Double($0)) * 100) } ?? 0
        return ScrollView {
            VStack(spacing: 0) {
                // Header — the countdown leads the facts line, exactly as the
                // feed row this page opened from renders it.
                VStack(alignment: .leading, spacing: 6) {
                    Text(event.title).font(.system(size: 24, weight: .bold)).foregroundStyle(c.textPrimary)
                    if let countdown = DateFormatting.startsInLabel(event.startAt) {
                        Text(countdown).font(.system(size: 14, weight: .semibold)).foregroundStyle(c.accentDark)
                    }
                    if let description = event.description, !description.isEmpty {
                        Text(description).font(.system(size: 15)).foregroundStyle(c.textSecondary).padding(.top, 6)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 20)
                .frame(maxWidth: .infinity, alignment: .leading)

                // Facts
                section {
                    infoRow(.calendar, "Date", DateFormatting.longDate(event.startAt))
                    infoRow(.clock, "Time", DateFormatting.time(event.startAt) + (event.endAt.map { " - \(DateFormatting.time($0))" } ?? ""))
                    if let tz = event.timezone { infoRow(.globe, "Timezone", tz) }
                    if let location = event.location { infoRow(.location, "Location", location.label, subtext: location.address) }
                }

                // Attendance
                section {
                    sectionTitle("Attendance")
                    HStack(alignment: .top, spacing: 24) {
                        stat("RSVPs", "\(analytics.rsvpCount)")
                        stat("Checked in", "\(analytics.checkinCount)")
                        if let capacity = event.capacity { stat("Spots left", "\(capacity - analytics.rsvpCount)") }
                    }
                    .padding(.top, 4)
                    if event.capacity != nil {
                        Text("\(rsvpPct)% capacity").font(.system(size: 13)).foregroundStyle(c.textMuted).padding(.top, 8)
                    }
                }

                if (event.visibility ?? "space") != "public" {
                    HStack(spacing: 8) {
                        VisvineIcon(event.visibility == "private" ? .lock : .people, size: 14)
                        Text(event.visibility == "private" ? "Private event" : "Space members only").font(.system(size: 14))
                    }
                    .foregroundStyle(c.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.top, 16)
                }

                Button { } label: {
                    Text("RSVP to Event").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(c.accent, in: RoundedRectangle(cornerRadius: 8))
                }
                .padding(.horizontal, 16).padding(.top, 24)
            }
            .padding(.bottom, 24)
        }
    }

    /// A block of rows on the flat surface, opened by a hairline.
    private func section(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Rectangle().fill(theme.colors.borderSubtle).frame(height: 1)
            VStack(alignment: .leading, spacing: 12) { content() }
                .padding(.horizontal, 16)
        }
        .padding(.top, 4).padding(.bottom, 16)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .kerning(0.9)
            .foregroundStyle(theme.colors.textMuted)
    }

    private func infoRow(_ icon: VisvineIconName, _ label: String, _ value: String, subtext: String? = nil) -> some View {
        let c = theme.colors
        return HStack(alignment: .top, spacing: 12) {
            VisvineIcon(icon, size: 16).foregroundStyle(c.textMuted).padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12)).foregroundStyle(c.textMuted)
                Text(value).font(.system(size: 15, weight: .medium)).foregroundStyle(c.textPrimary)
                if let subtext { Text(subtext).font(.system(size: 14)).foregroundStyle(c.textMuted) }
            }
            Spacer()
        }
    }

    /// A number and what it counts. No tile behind it — the figure is the mark.
    private func stat(_ label: String, _ value: String) -> some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: 24, weight: .bold)).foregroundStyle(c.textPrimary)
            Text(label).font(.system(size: 12)).foregroundStyle(c.textMuted)
        }
    }
}
