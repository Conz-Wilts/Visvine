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
                Text(model.error ?? "Event not found").foregroundStyle(c.fgSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(c.surface)
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
                VStack(alignment: .leading, spacing: VVSpace.x1_5) {
                    Text(event.title).font(.system(size: VVFontSize.s24, weight: .bold)).foregroundStyle(c.fg)
                    if let countdown = DateFormatting.startsInLabel(event.startAt) {
                        Text(countdown).font(.system(size: VVFontSize.s14, weight: .semibold)).foregroundStyle(c.accentStrong)
                    }
                    if let description = event.description, !description.isEmpty {
                        Text(description).font(.system(size: VVFontSize.s15)).foregroundStyle(c.fgSecondary).padding(.top, VVSpace.x1_5)
                    }
                }
                .padding(.horizontal, VVSpace.x4).padding(.top, VVSpace.x2).padding(.bottom, VVSpace.x5)
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
                    HStack(alignment: .top, spacing: VVSpace.x6) {
                        stat("RSVPs", "\(analytics.rsvpCount)")
                        stat("Checked in", "\(analytics.checkinCount)")
                        if let capacity = event.capacity { stat("Spots left", "\(capacity - analytics.rsvpCount)") }
                    }
                    .padding(.top, VVSpace.x1)
                    if event.capacity != nil {
                        Text("\(rsvpPct)% capacity").font(.system(size: VVFontSize.s13)).foregroundStyle(c.fgMuted).padding(.top, VVSpace.x2)
                    }
                }

                if (event.visibility ?? "space") != "public" {
                    HStack(spacing: VVSpace.x2) {
                        VisvineIcon(event.visibility == "private" ? .lock : .people, size: 14)
                        Text(event.visibility == "private" ? "Private event" : "Space members only").font(.system(size: VVFontSize.s14))
                    }
                    .foregroundStyle(c.fgMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, VVSpace.x4).padding(.top, VVSpace.x4)
                }

                Button { } label: {
                    Text("RSVP to Event").font(.system(size: VVFontSize.s15, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, VVSpace.x3_5)
                        .background(c.accent, in: RoundedRectangle(cornerRadius: VVRadius.lg))
                }
                .padding(.horizontal, VVSpace.x4).padding(.top, VVSpace.x6)
            }
            .padding(.bottom, VVSpace.x6)
        }
    }

    /// A block of rows on the flat surface, opened by a hairline.
    private func section(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: VVSpace.x3) {
            Rectangle().fill(theme.colors.lineSubtle).frame(height: 1)
            VStack(alignment: .leading, spacing: VVSpace.x3) { content() }
                .padding(.horizontal, VVSpace.x4)
        }
        .padding(.top, VVSpace.x1).padding(.bottom, VVSpace.x4)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: VVFontSize.s11, weight: .semibold))
            .kerning(0.9)
            .foregroundStyle(theme.colors.fgMuted)
    }

    private func infoRow(_ icon: VisvineIconName, _ label: String, _ value: String, subtext: String? = nil) -> some View {
        let c = theme.colors
        return HStack(alignment: .top, spacing: VVSpace.x3) {
            VisvineIcon(icon, size: 16).foregroundStyle(c.fgMuted).padding(.top, VVSpace.x0_5)
            VStack(alignment: .leading, spacing: VVSpace.x0_5) {
                Text(label).font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgMuted)
                Text(value).font(.system(size: VVFontSize.s15, weight: .medium)).foregroundStyle(c.fg)
                if let subtext { Text(subtext).font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted) }
            }
            Spacer()
        }
    }

    /// A number and what it counts. No tile behind it — the figure is the mark.
    private func stat(_ label: String, _ value: String) -> some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: VVSpace.x0_5) {
            Text(value).font(.system(size: VVFontSize.s24, weight: .bold)).foregroundStyle(c.fg)
            Text(label).font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgMuted)
        }
    }
}
