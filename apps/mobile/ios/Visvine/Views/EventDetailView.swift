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

/// Port of screens/Events/EventDetailScreen.tsx.
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
        .background(c.bgSecondary)
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
                // Header
                VStack(alignment: .leading, spacing: 0) {
                    VStack(spacing: 0) {
                        Text(DateFormatting.monthShort(event.startAt).uppercased()).font(.system(size: 12, weight: .semibold)).foregroundStyle(c.accentDark)
                        Text(DateFormatting.dayOfMonth(event.startAt)).font(.system(size: 28, weight: .bold)).foregroundStyle(c.textPrimary)
                    }
                    .frame(width: 56).padding(.vertical, 8).background(c.accentLight, in: RoundedRectangle(cornerRadius: 12))
                    Text(event.title).font(.system(size: 24, weight: .bold)).foregroundStyle(c.textPrimary).padding(.top, 16)
                    if let description = event.description { Text(description).font(.system(size: 15)).foregroundStyle(c.textMuted).padding(.top, 8) }
                }
                .padding(20).frame(maxWidth: .infinity, alignment: .leading).background(c.bgPrimary)

                // Info
                VStack(spacing: 16) {
                    infoRow("calendar", "Date", DateFormatting.longDate(event.startAt))
                    infoRow("clock", "Time", DateFormatting.time(event.startAt) + (event.endAt.map { " - \(DateFormatting.time($0))" } ?? ""))
                    if let tz = event.timezone { infoRow("globe", "Timezone", tz) }
                    if let location = event.location { infoRow("mappin.and.ellipse", "Location", location.label, subtext: location.address) }
                }
                .padding(20).background(c.bgPrimary, in: RoundedRectangle(cornerRadius: 16)).padding(16)

                // Attendance
                VStack(alignment: .leading, spacing: 16) {
                    Text("Attendance").font(.system(size: 18, weight: .semibold)).foregroundStyle(c.textPrimary)
                    HStack(spacing: 10) {
                        stat("RSVPs", "\(analytics.rsvpCount)", c.accentDark)
                        stat("Checked In", "\(analytics.checkinCount)", c.accentDark)
                        if let capacity = event.capacity { stat("Spots Left", "\(capacity - analytics.rsvpCount)", c.success) }
                    }
                    if event.capacity != nil {
                        VStack(spacing: 8) {
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(c.bgTertiary).frame(height: 8)
                                    Capsule().fill(c.accent).frame(width: geo.size.width * CGFloat(min(rsvpPct, 100)) / 100, height: 8)
                                }
                            }
                            .frame(height: 8)
                            Text("\(rsvpPct)% capacity").font(.system(size: 12)).foregroundStyle(c.textMuted)
                        }
                    }
                }
                .padding(20).frame(maxWidth: .infinity, alignment: .leading).background(c.bgPrimary, in: RoundedRectangle(cornerRadius: 16)).padding(.horizontal, 16)

                if (event.visibility ?? "community") != "public" {
                    HStack(spacing: 8) {
                        Image(systemName: event.visibility == "private" ? "lock.fill" : "person.2.fill").font(.system(size: 14))
                        Text(event.visibility == "private" ? "Private event" : "Space members only").font(.system(size: 14))
                    }
                    .foregroundStyle(c.textMuted).padding(.horizontal, 16).padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading).background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 12)).padding(16)
                }

                Button { } label: {
                    Text("RSVP to Event").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 16).background(c.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .padding(20)
            }
            .padding(.bottom, 24)
        }
    }

    private func infoRow(_ icon: String, _ label: String, _ value: String, subtext: String? = nil) -> some View {
        let c = theme.colors
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 16)).foregroundStyle(c.accentDark)
                .frame(width: 36, height: 36).background(c.accentLight, in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12)).foregroundStyle(c.textMuted)
                Text(value).font(.system(size: 15, weight: .medium)).foregroundStyle(c.textPrimary)
                if let subtext { Text(subtext).font(.system(size: 14)).foregroundStyle(c.textMuted) }
            }
            Spacer()
        }
    }

    private func stat(_ label: String, _ value: String, _ valueColor: Color) -> some View {
        let c = theme.colors
        return VStack(spacing: 4) {
            Text(value).font(.system(size: 26, weight: .bold)).foregroundStyle(valueColor)
            Text(label).font(.system(size: 12)).foregroundStyle(c.textMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 16).background(c.bgSecondary, in: RoundedRectangle(cornerRadius: 12))
    }
}
