import SwiftUI
import Observation

@Observable
@MainActor
final class ActivityModel {
    var upcoming: [ActivityRow] = []
    var items: [ActivityRow] = []
    var nextCursor: String?
    var loading = true
    var loadingMore = false
    var error: String?
    /// What was pressed on a request row: "Approved" / "Declined", by row id.
    var decided: [String: String] = [:]
    var deciding: Set<String> = []

    private let repo = ActivityRepository()

    func load() async {
        switch await repo.list() {
        case .success(let page):
            upcoming = page.upcoming
            items = page.items
            nextCursor = page.nextCursor
            error = nil
        case .failure(let m):
            error = m
        }
        loading = false
    }

    func loadMore() async {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        if case .success(let page) = await repo.list(cursor: cursor) {
            items += page.items
            nextCursor = page.nextCursor
        }
        loadingMore = false
    }

    func decide(_ row: ActivityRow, _ action: ActivityAction) async {
        guard !deciding.contains(row.id) else { return }
        deciding.insert(row.id)
        defer { deciding.remove(row.id) }
        switch await repo.decide(action) {
        case .success: decided[row.id] = action.label == "Approve" ? "Approved" : "Declined"
        case .failure(let m): error = m
        }
    }

    /// Rows grouped by day, newest day first, each day's label once.
    var days: [(label: String, rows: [ActivityRow])] {
        var order: [String] = []
        var byDay: [String: [ActivityRow]] = [:]
        for row in items {
            let key = DateFormatting.longDate(row.at)
            if byDay[key] == nil { order.append(key) }
            byDay[key, default: []].append(row)
        }
        let today = DateFormatting.longDate(ISO8601DateFormatter().string(from: Date()))
        let yesterday = DateFormatting.longDate(ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86_400)))
        return order.map { key in
            (label: key == today ? "Today" : key == yesterday ? "Yesterday" : key, rows: byDay[key] ?? [])
        }
    }
}

/// Everything about you (docs/mobile.md § Activity): what is coming up, then
/// what happened, by day. A request you can answer carries its two doors.
struct ActivityView: View {
    @Environment(ThemeStore.self) private var theme
    @State private var model = ActivityModel()

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(showSpaceSelector: false, onProfile: onProfile)
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        if let error = model.error {
                            Text(error).foregroundStyle(c.error).font(.system(size: 14))
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 12)
                        }
                        if !model.upcoming.isEmpty {
                            sectionLabel("Coming up")
                            Hairline()
                            ForEach(model.upcoming) { row in
                                link(row) { ActivityRowView(row: row, decided: nil, deciding: false, onDecide: { _ in }) }
                                Hairline()
                            }
                        }
                        if model.items.isEmpty && model.upcoming.isEmpty {
                            EmptyStateView(text: "Nothing yet", icon: .bell)
                        }
                        ForEach(model.days, id: \.label) { day in
                            sectionLabel(day.label)
                            Hairline()
                            ForEach(day.rows) { row in
                                link(row) {
                                    ActivityRowView(
                                        row: row,
                                        decided: model.decided[row.id],
                                        deciding: model.deciding.contains(row.id),
                                        onDecide: { action in Task { await model.decide(row, action) } }
                                    )
                                }
                                .onAppear { if row.id == model.items.last?.id { Task { await model.loadMore() } } }
                                Hairline()
                            }
                        }
                        if model.loadingMore {
                            ProgressView().tint(c.accent).frame(maxWidth: .infinity).padding(.vertical, 16)
                        }
                        Color.clear.frame(height: 96)
                    }
                }
                .refreshable { await model.load() }
            }
        }
        .background(c.bgPrimary)
        .task { await model.load() }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.colors.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 6)
    }

    /// A row opens what it is about; a request row is answered in place instead.
    @ViewBuilder private func link<Content: View>(_ row: ActivityRow, @ViewBuilder content: () -> Content) -> some View {
        if let destination = route(for: row) {
            NavigationLink(value: destination) { content() }.buttonStyle(.plain)
        } else {
            content()
        }
    }

    private func route(for row: ActivityRow) -> AppRoute? {
        let t = row.target
        switch t.type {
        case "agent":
            guard let spaceId = t.spaceId, let name = t.agentName else { return nil }
            return .agentChat(spaceId: spaceId, agentName: name, title: row.title)
        case "conversation":
            guard let id = t.conversationId else { return nil }
            return .conversation(id: id, name: nil)
        case "event":
            guard let id = t.eventId else { return nil }
            return .eventDetail(eventId: id, title: row.title)
        default:
            return nil
        }
    }
}

/// One thing that happened: a glyph for its kind, the words, where and when,
/// and — for a request — Approve and Decline.
private struct ActivityRowView: View {
    @Environment(ThemeStore.self) private var theme
    let row: ActivityRow
    let decided: String?
    let deciding: Bool
    let onDecide: (ActivityAction) -> Void

    var body: some View {
        let c = theme.colors
        HStack(alignment: .top, spacing: 12) {
            VisvineIcon(glyph, size: 18).foregroundStyle(c.textMuted).frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.title).font(.system(size: 15, weight: .medium)).foregroundStyle(c.textPrimary)
                if let subtitle = row.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(c.textMuted).lineLimit(2)
                }
                Text(meta).font(.system(size: 12)).foregroundStyle(c.textMuted)
                if let decided {
                    Text(decided)
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(c.textSecondary)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .padding(.top, 4)
                } else if let actions = row.actions, !actions.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(actions) { action in
                            let primary = action.label == "Approve"
                            Button { onDecide(action) } label: {
                                Text(action.label)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(primary ? .white : c.textPrimary)
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .background(primary ? c.accent : c.bgSecondary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .disabled(deciding)
                        }
                        if deciding { ProgressView().tint(c.accent) }
                    }
                    .padding(.top, 6)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private var glyph: VisvineIconName {
        switch row.kind {
        case "run": return .sparkles
        case "mention", "reply": return .message
        case "join_request", "access_request": return .personAdd
        case "event": return .calendar
        default: return .bell
        }
    }

    private var meta: String {
        let when = row.kind == "event" ? DateFormatting.fullDate(row.at) : DateFormatting.relativeShort(row.at)
        return [row.space?.name, when].compactMap { $0 }.joined(separator: " · ")
    }
}
