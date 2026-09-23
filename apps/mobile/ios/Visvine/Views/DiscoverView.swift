import SwiftUI
import Observation

@Observable
@MainActor
final class DiscoverModel {
    var spaces: [Space] = []
    var events: [DiscoverEvent] = []
    var loading = true
    var error: String?
    /// Spaces whose door was `ask` and has been pressed, until an admin answers.
    var asked: Set<String> = []
    var joining: String?

    private let repo = SpaceRepository()

    func load() async {
        async let visible = repo.getVisible()
        async let upcoming = repo.discoverEvents()
        let (s, e) = await (visible, upcoming)
        switch s {
        case .success(let list): spaces = list.filter { $0.visibility == "public" && $0.id != "visvine" }; error = nil
        case .failure(let m): error = m
        }
        if case .success(let list) = e { events = list }
        loading = false
    }

    func join(_ space: Space, store: SpaceStore) async {
        joining = space.id
        defer { joining = nil }
        switch await repo.join(spaceId: space.id) {
        case .success(let r):
            if r.membership?.status == "pending" { asked.insert(space.id); return }
            await store.refresh()
            if let joined = store.spaces.first(where: { $0.id == space.id }) { store.setCurrent(joined) }
            error = nil
        case .failure(let m):
            error = m
        }
    }
}

/// Discover: the open spaces beyond the ones you are in, and what is on
/// anywhere — the native mirror of the web's /discover.
struct DiscoverView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(SearchStore.self) private var search
    @Environment(\.openURL) private var openURL
    @State private var model = DiscoverModel()
    @State private var segment = 0

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(onProfile: onProfile)
            SegmentedNav(items: ["Spaces", "Events"], selected: $segment)
            if let error = model.error {
                Text(error).foregroundStyle(c.danger).font(.system(size: VVFontSize.s14))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x2)
            }
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        if segment == 0 { spacesList } else { eventsList }
                        Color.clear.frame(height: 96)
                    }
                }
                .refreshable { await model.load() }
            }
        }
        .background(c.surface)
        .searchScope("Search Discover")
        .task { await model.load() }
    }

    private var shownSpaces: [Space] {
        rankByQuery(model.spaces, query: search.query) { $0.name }
    }

    private var shownEvents: [DiscoverEvent] {
        rankByQuery(model.events, query: search.query) { $0.title }
    }

    @ViewBuilder private var spacesList: some View {
        if shownSpaces.isEmpty {
            EmptyStateView(text: search.query.isEmpty ? "No open spaces" : "No spaces by that name", icon: .compass)
        } else {
            ForEach(shownSpaces) { item in
                SpaceDiscoverRow(
                    space: item,
                    state: state(of: item),
                    onJoin: { Task { await model.join(item, store: space) } },
                    onOpen: { space.setCurrent(space.spaces.first { $0.id == item.id } ?? item) }
                )
                Hairline()
            }
        }
    }

    @ViewBuilder private var eventsList: some View {
        if shownEvents.isEmpty {
            EmptyStateView(text: search.query.isEmpty ? "Nothing coming up" : "No events by that name", icon: .calendar)
        } else {
            ForEach(shownEvents) { event in
                Button {
                    if let url = URL(string: AppConfig.apiBase + "/e/" + event.slug) { openURL(url) }
                } label: { DiscoverEventRow(event: event) }
                .buttonStyle(.plain)
                Hairline()
            }
        }
    }

    private func state(of item: Space) -> SpaceDiscoverRow.JoinState {
        if space.isJoined(item.id) { return space.current?.id == item.id ? .current : .joined }
        if model.joining == item.id { return .joining }
        if model.asked.contains(item.id) { return .asked }
        return .open
    }
}

/// One open space: its mark, name and line, and the door.
private struct SpaceDiscoverRow: View {
    enum JoinState { case open, joining, asked, joined, current }

    @Environment(ThemeStore.self) private var theme
    let space: Space
    let state: JoinState
    var onJoin: () -> Void
    var onOpen: () -> Void

    var body: some View {
        let c = theme.colors
        HStack(spacing: VVSpace.x3) {
            SpaceAvatar(name: space.name, imageUrl: space.image, size: 44)
            VStack(alignment: .leading, spacing: VVSpace.x0_5) {
                Text(space.name).font(.system(size: VVFontSize.s16, weight: .semibold)).foregroundStyle(c.fg).lineLimit(1)
                if let line = space.description, !line.isEmpty {
                    Text(line).font(.system(size: VVFontSize.s13)).foregroundStyle(c.fgMuted).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            door
        }
        .padding(.horizontal, VVSpace.x4)
        .padding(.vertical, VVSpace.x3)
    }

    @ViewBuilder private var door: some View {
        let c = theme.colors
        switch state {
        case .open:
            Button(action: onJoin) {
                Text("Join").font(.system(size: VVFontSize.s14, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, VVSpace.x4).frame(height: 32)
                    .background(c.accentStrong, in: Capsule())
            }
            .buttonStyle(.plain)
        case .joining:
            ProgressView().tint(c.accent).frame(width: 64, height: 32)
        case .asked:
            Text("Asked").font(.system(size: VVFontSize.s14, weight: .medium)).foregroundStyle(c.fgMuted)
        case .joined:
            Button(action: onOpen) {
                Text("Open").font(.system(size: VVFontSize.s14, weight: .semibold)).foregroundStyle(c.fg)
                    .padding(.horizontal, VVSpace.x4).frame(height: 32)
                    .background(c.surfaceMuted, in: Capsule())
            }
            .buttonStyle(.plain)
        case .current:
            VisvineIcon(.check, size: 18).foregroundStyle(c.accentStrong)
        }
    }
}

/// One upcoming public event: a date block, its name, where and who hosts it.
private struct DiscoverEventRow: View {
    @Environment(ThemeStore.self) private var theme
    let event: DiscoverEvent

    var body: some View {
        let c = theme.colors
        HStack(spacing: VVSpace.x3_5) {
            VStack(spacing: 0) {
                Text(DateFormatting.monthShort(event.startAt).uppercased())
                    .font(.system(size: VVFontSize.s11, weight: .bold)).foregroundStyle(c.accentStrong)
                Text(DateFormatting.dayOfMonth(event.startAt))
                    .font(.system(size: VVFontSize.s20, weight: .bold)).foregroundStyle(c.fg)
            }
            .frame(width: 48, height: 52)
            .background(c.accentSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(event.title).font(.system(size: VVFontSize.s16, weight: .semibold)).foregroundStyle(c.fg).lineLimit(2)
                Text(detail).font(.system(size: VVFontSize.s13)).foregroundStyle(c.fgMuted).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, VVSpace.x4)
        .padding(.vertical, VVSpace.x3)
        .contentShape(Rectangle())
    }

    private var detail: String {
        let place = event.eventType == "virtual" ? "Online" : event.locationLabel
        return [DateFormatting.time(event.startAt), place, event.spaceName]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}
