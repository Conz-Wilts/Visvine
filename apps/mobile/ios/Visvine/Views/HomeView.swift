import SwiftUI
import Observation

@Observable
@MainActor
final class HomeModel {
    var posts: [FeedPost] = []
    var nextCursor: String?
    var loading = true
    var loadingMore = false
    var error: String?
    /// The one line the composer says after a capture, for a moment.
    var captured: String?
    var capturing = false

    private let feed = FeedRepository()
    private let actions = ActionsRepository()
    private var loadedFor: String?

    func load(spaceId: String?) async {
        guard let spaceId else { posts = []; loading = false; return }
        loading = loadedFor != spaceId
        loadedFor = spaceId
        switch await feed.getFeed(spaceId: spaceId) {
        case .success(let page): posts = page.posts; nextCursor = page.nextCursor; error = nil
        case .failure(let m): error = m
        }
        loading = false
    }

    func loadMore(spaceId: String?) async {
        guard let spaceId, let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        if case .success(let page) = await feed.getFeed(spaceId: spaceId, cursor: cursor) {
            posts += page.posts
            nextCursor = page.nextCursor
        }
        loadingMore = false
    }

    func capture(spaceId: String?, kind: ActionsRepository.CaptureKind, text: String) async -> Bool {
        guard let spaceId, !capturing else { return false }
        capturing = true
        defer { capturing = false }
        switch await actions.capture(spaceId: spaceId, kind: kind, text: text) {
        case .success(let done):
            captured = done.line
            error = nil
            return true
        case .failure(let m):
            error = m
            return false
        }
    }
}

/// The space: its switcher, two rows into People and Events, the feed, and a
/// composer that captures a note (docs/mobile.md § Home).
struct HomeView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @State private var model = HomeModel()
    @State private var draft = ""
    @State private var kind: ActionsRepository.CaptureKind = .note
    @FocusState private var composing: Bool

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(showSpaceSelector: true, onProfile: onProfile)
            ScrollView {
                LazyVStack(spacing: 0) {
                    if let error = model.error {
                        Text(error).foregroundStyle(c.error).font(.system(size: 14))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                    }
                    Hairline()
                    NavigationLink(value: AppRoute.people) { LinkRow(icon: .people, label: "People") }.buttonStyle(.plain)
                    Hairline()
                    NavigationLink(value: AppRoute.events) { LinkRow(icon: .calendar, label: "Events") }.buttonStyle(.plain)
                    Hairline()

                    if model.loading {
                        ProgressView().tint(c.accent).frame(maxWidth: .infinity).padding(.vertical, 48)
                    } else if model.posts.isEmpty {
                        EmptyStateView(text: "Nothing in this space's feed yet", icon: .message)
                    } else {
                        Text("Feed")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(c.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 4)
                        ForEach(model.posts) { post in
                            FeedPostRow(post: post)
                                .onAppear {
                                    if post.id == model.posts.last?.id { Task { await model.loadMore(spaceId: space.current?.id) } }
                                }
                            Hairline()
                        }
                        if model.loadingMore {
                            ProgressView().tint(c.accent).frame(maxWidth: .infinity).padding(.vertical, 16)
                        }
                    }
                    // Room for the composer and the floating bar.
                    Color.clear.frame(height: 160)
                }
            }
            .refreshable { await model.load(spaceId: space.current?.id) }
        }
        .background(c.bgPrimary)
        .safeAreaInset(edge: .bottom) { composer }
        .task(id: space.current?.id) { await model.load(spaceId: space.current?.id) }
        .onChange(of: model.captured) { _, line in
            guard line != nil else { return }
            Task {
                try? await Task.sleep(for: .seconds(2))
                if model.captured == line { model.captured = nil }
            }
        }
    }

    /// The capture box: what kind, the words, a send. Sits above the tab bar.
    private var composer: some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: 8) {
            if let line = model.captured {
                Text(line).font(.system(size: 12)).foregroundStyle(c.textMuted).padding(.horizontal, 4)
            }
            HStack(spacing: 6) {
                ForEach(ActionsRepository.CaptureKind.allCases) { k in
                    let on = k == kind
                    Button { kind = k } label: {
                        Text(k.label)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(on ? .white : c.textSecondary)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(on ? c.accent : c.bgTertiary, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(placeholder, text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($composing)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .foregroundStyle(c.textPrimary)
                Button { send() } label: {
                    Group {
                        if model.capturing { ProgressView().tint(.white) }
                        else { VisvineIcon(kind == .note ? .plus : .send, size: 18).foregroundStyle(.white) }
                    }
                    .frame(width: 40, height: 40)
                    .background(canSend ? c.accent : c.borderDefault, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 84)
        .background(c.bgPrimary)
    }

    private var placeholder: String {
        switch kind {
        case .note: return "Capture a note…"
        case .person: return "A person's name, then what you know"
        case .space: return "An organisation's name, then what you know"
        case .resource: return "A resource's name, then a line about it"
        }
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.capturing && space.current != nil
    }

    private func send() {
        let text = draft
        draft = ""
        Task {
            let ok = await model.capture(spaceId: space.current?.id, kind: kind, text: text)
            if !ok { draft = text }
        }
    }
}

/// One post: who, where and when, the words, how many comments.
private struct FeedPostRow: View {
    @Environment(ThemeStore.self) private var theme
    let post: FeedPost

    var body: some View {
        let c = theme.colors
        HStack(alignment: .top, spacing: 12) {
            PersonAvatar(name: post.message.sender.name, imageUrl: post.message.sender.image, size: 36)
            VStack(alignment: .leading, spacing: 4) {
                Text(post.message.sender.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(c.textPrimary)
                Text("\(post.channel.name) · \(DateFormatting.relativeShort(post.message.createdAt))")
                    .font(.system(size: 12)).foregroundStyle(c.textMuted)
                if !post.message.text.isEmpty {
                    Text(post.message.text).font(.system(size: 15)).foregroundStyle(c.textPrimary).lineLimit(6)
                        .padding(.top, 2)
                }
                if !post.comments.isEmpty {
                    Text("\(post.comments.count) \(post.comments.count == 1 ? "comment" : "comments")")
                        .font(.system(size: 12)).foregroundStyle(c.textMuted).padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
