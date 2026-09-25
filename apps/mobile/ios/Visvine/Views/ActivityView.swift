import SwiftUI

/// Everything about you (docs/mobile.md § Activity): what is coming up, then
/// the runs, mentions, replies and requests, newest first, filed by day. A
/// request an admin can answer carries its two doors on the row.
struct ActivityView: View {
    @Environment(ThemeStore.self) private var theme
    @State private var model = ActivityModel()

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(showSpaceSelector: false, onProfile: onProfile)
            if let error = model.error {
                Text(error).foregroundStyle(c.danger).font(.system(size: VVFontSize.s14))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x3)
            }
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.upcoming.isEmpty && model.items.isEmpty {
                EmptyStateView(text: "Nothing yet", icon: .bell).frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        if !model.upcoming.isEmpty {
                            Section {
                                ForEach(Array(model.upcoming.enumerated()), id: \.element.id) { index, row in
                                    if index > 0 { Hairline() }
                                    rowLink(row) { UpcomingRow(row: row) }
                                }
                            } header: { SectionLabel(text: "Coming up") }
                        }
                        ForEach(model.days, id: \.label) { day in
                            Section {
                                ForEach(Array(day.rows.enumerated()), id: \.element.id) { index, row in
                                    if index > 0 { Hairline() }
                                    rowLink(row) {
                                        ActivityItemRow(
                                            row: row,
                                            decided: model.decided[row.id],
                                            deciding: model.deciding.contains(row.id),
                                            onDecide: { action in Task { await model.decide(row, action) } }
                                        )
                                    }
                                    .task {
                                        if row.id == model.items.last?.id { await model.loadMore() }
                                    }
                                }
                            } header: { SectionLabel(text: day.label) }
                        }
                        if model.loadingMore {
                            ProgressView().tint(c.accent).frame(maxWidth: .infinity).padding(VVSpace.x4)
                        }
                        Color.clear.frame(height: 96)
                    }
                }
                .refreshable { await model.load() }
            }
        }
        .background(c.surface)
        .task { await model.load() }
    }

    /// A row that opens what it is about — an agent's chat, a conversation, an
    /// event — or stays put when it is only a request to answer.
    @ViewBuilder private func rowLink<Content: View>(_ row: ActivityRow, @ViewBuilder content: () -> Content) -> some View {
        if let route = route(for: row) {
            NavigationLink(value: route) { content() }.buttonStyle(.plain)
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

/// The list and its doors, loaded a page at a time.
@MainActor
@Observable
final class ActivityModel {
    var loading = true
    var loadingMore = false
    var upcoming: [ActivityRow] = []
    var items: [ActivityRow] = []
    var nextCursor: String?
    var error: String?
    /// Row id → "Approved" | "Declined", once its door has been answered.
    var decided: [String: String] = [:]
    /// Row ids whose decision is in flight.
    var deciding: Set<String> = []

    private let repo = ActivityRepository()

    /// The items filed by day, newest day first, in the order they arrived.
    var days: [(label: String, rows: [ActivityRow])] {
        var out: [(label: String, rows: [ActivityRow])] = []
        for row in items {
            let label = DateFormatting.dayLabel(row.at)
            if let i = out.firstIndex(where: { $0.label == label }) {
                out[i].rows.append(row)
            } else {
                out.append((label, [row]))
            }
        }
        return out
    }

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
        guard let cursor = nextCursor, !loadingMore, !loading else { return }
        loadingMore = true
        switch await repo.list(cursor: cursor) {
        case .success(let page):
            let seen = Set(items.map(\.id))
            items += page.items.filter { !seen.contains($0.id) }
            nextCursor = page.nextCursor
        case .failure(let m):
            error = m
        }
        loadingMore = false
    }

    /// Answer a request through the door the row named; the row then says which.
    func decide(_ row: ActivityRow, _ action: ActivityAction) async {
        if deciding.contains(row.id) || decided[row.id] != nil { return }
        deciding.insert(row.id)
        error = nil
        let verdict = action.label.lowercased() == "decline" ? "Declined" : "Approved"
        switch await repo.decide(action) {
        case .success:
            decided[row.id] = verdict
        case .failure(let m):
            error = m
        }
        deciding.remove(row.id)
    }
}

private struct SectionLabel: View {
    @Environment(ThemeStore.self) private var theme
    let text: String

    var body: some View {
        let c = theme.colors
        Text(text)
            .font(.system(size: VVFontSize.s13, weight: .semibold))
            .foregroundStyle(c.fgMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, VVSpace.x4).padding(.top, VVSpace.x3).padding(.bottom, VVSpace.x1_5)
            .background(c.surface)
    }
}

private func glyph(for kind: String) -> VisvineIconName {
    switch kind {
    case "run": return .sparkles
    case "mention", "reply": return .message
    case "join_request", "access_request": return .personAdd
    case "event": return .calendar
    default: return .bell
    }
}

private struct UpcomingRow: View {
    @Environment(ThemeStore.self) private var theme
    let row: ActivityRow

    var body: some View {
        let c = theme.colors
        HStack(spacing: 0) {
            VisvineIcon(.calendar, size: 20).foregroundStyle(c.fgMuted).frame(width: 36, alignment: .leading)
            VStack(alignment: .leading, spacing: VVSpace.x0_5) {
                Text(row.title).font(.system(size: VVFontSize.s15, weight: .medium)).foregroundStyle(c.fg).lineLimit(1)
                Text([row.space?.name, DateFormatting.fullDate(row.at)].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgMuted).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x3)
        .contentShape(Rectangle())
    }
}

private struct ActivityItemRow: View {
    @Environment(ThemeStore.self) private var theme
    let row: ActivityRow
    let decided: String?
    let deciding: Bool
    let onDecide: (ActivityAction) -> Void

    var body: some View {
        let c = theme.colors
        HStack(spacing: 0) {
            VisvineIcon(glyph(for: row.kind), size: 20).foregroundStyle(c.fgMuted).frame(width: 36, alignment: .leading)
            VStack(alignment: .leading, spacing: VVSpace.x0_5) {
                Text(row.title).font(.system(size: VVFontSize.s15, weight: .medium)).foregroundStyle(c.fg).lineLimit(2)
                if let subtitle = row.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.system(size: VVFontSize.s13)).foregroundStyle(c.fgMuted).lineLimit(1)
                }
                Text([row.space?.name, DateFormatting.relativeShort(row.at)].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgMuted).lineLimit(1)
            }
            Spacer(minLength: VVSpace.x2)
            if let decided {
                Text(decided).font(.system(size: VVFontSize.s12, weight: .semibold)).foregroundStyle(c.fgMuted)
                    .padding(.horizontal, VVSpace.x2).padding(.vertical, VVSpace.x1)
                    .background(c.surfaceMuted, in: RoundedRectangle(cornerRadius: VVRadius.md))
            } else if deciding {
                ProgressView().tint(c.accent)
            } else if !row.actions.isEmpty {
                HStack(spacing: VVSpace.x1_5) {
                    ForEach(Array(row.actions.enumerated()), id: \.offset) { index, action in
                        let primary = index == 0
                        Button { onDecide(action) } label: {
                            Text(action.label)
                                .font(.system(size: VVFontSize.s13, weight: .semibold))
                                .foregroundStyle(primary ? Color.white : c.fg)
                                .padding(.horizontal, VVSpace.x3).padding(.vertical, 7)
                                .background(primary ? c.accent : c.surfaceSubtle, in: RoundedRectangle(cornerRadius: VVRadius.lg))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x3)
        .contentShape(Rectangle())
    }
}
