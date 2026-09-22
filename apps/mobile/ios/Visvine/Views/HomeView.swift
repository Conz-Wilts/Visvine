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

    /// The space's context as the person may read it; nil until read.
    var context: ContextNode?

    private let feed = FeedRepository()
    private var loadedFor: String?

    func load(spaceId: String?) async {
        guard let spaceId else { posts = []; loading = false; return }
        loading = loadedFor != spaceId
        if loadedFor != spaceId { context = nil }
        loadedFor = spaceId
        async let tree = ContextRepository().tree(spaceId: spaceId)
        switch await feed.getFeed(spaceId: spaceId) {
        case .success(let page): posts = page.posts; nextCursor = page.nextCursor; error = nil
        case .failure(let m): error = m
        }
        if case .success(let root) = await tree { context = root }
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
}

/// The space: its switcher in the header, a row of chips into its lists, and
/// the feed (docs/mobile.md § Home). Capture is the bar's +.
struct HomeView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(SearchStore.self) private var search
    @State private var model = HomeModel()

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(onProfile: onProfile)
            ScrollView {
                LazyVStack(spacing: 0) {
                    chips
                    if let error = model.error {
                        Text(error).foregroundStyle(c.error).font(.system(size: 14))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                    }
                    if model.loading {
                        ProgressView().tint(c.accent).frame(maxWidth: .infinity).padding(.vertical, 48)
                    } else if posts.isEmpty {
                        EmptyStateView(text: search.query.isEmpty ? "Nothing in this space's feed yet" : "No posts found", icon: .message)
                    } else {
                        ForEach(posts) { post in
                            FeedPostRow(post: post)
                                .onAppear {
                                    if post.id == model.posts.last?.id { Task { await model.loadMore(spaceId: space.current?.id) } }
                                }
                            Hairline().padding(.horizontal, 16)
                        }
                        if model.loadingMore {
                            ProgressView().tint(c.accent).frame(maxWidth: .infinity).padding(.vertical, 16)
                        }
                    }
                    // Room for the floating bar.
                    Color.clear.frame(height: 160)
                }
            }
            .refreshable { await model.load(spaceId: space.current?.id) }
        }
        .background(c.bgPrimary)
        .searchScope("Search feed")
        .task(id: space.current?.id) { await model.load(spaceId: space.current?.id) }
    }

    /// The feed, narrowed to posts whose words, author or channel match.
    private var posts: [FeedPost] {
        let q = search.query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return model.posts }
        return model.posts.filter {
            "\($0.message.text) \($0.message.sender.name) \($0.channel.name)".lowercased().contains(q)
        }
    }

    /// Feed is this page; Events and Context push theirs. Context is offered to
    /// an admin, or to anyone whose grants reach a note of it.
    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 10) {
                    Chip(label: "Feed", on: true) {}
                    NavigationLink(value: AppRoute.events) { ChipLabel(text: "Events") }.buttonStyle(.plain)
                    if let root = model.context, space.current?.isAdmin == true || root.noteCount > 0 {
                        NavigationLink(value: AppRoute.contextFolder(root)) { ChipLabel(text: "Context") }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
        }
        .scrollClipDisabled()
        .padding(.bottom, 4)
    }
}

/// An unchosen chip that is a link rather than a button.
private struct ChipLabel: View {
    @Environment(ThemeStore.self) private var theme
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.colors.textPrimary)
            .padding(.horizontal, 18)
            .frame(height: 40)
            .glassEffect(.regular.interactive(), in: .capsule)
    }
}

/// One post: who, in which channel, when — then the words, and the comments.
private struct FeedPostRow: View {
    @Environment(ThemeStore.self) private var theme
    let post: FeedPost

    var body: some View {
        let c = theme.colors
        let lines = post.message.text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: true)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                PersonAvatar(name: post.message.sender.name, imageUrl: post.message.sender.image, size: 28)
                (Text(post.message.sender.name).fontWeight(.semibold).foregroundColor(c.textSecondary)
                 + Text(" in ").foregroundColor(c.textMuted)
                 + Text(post.channel.name).fontWeight(.semibold).foregroundColor(c.textSecondary)
                 + Text(" · \(DateFormatting.relativeShort(post.message.createdAt))").foregroundColor(c.textMuted))
                    .font(.system(size: 14))
                    .lineLimit(1)
            }
            if let title = lines.first {
                Text(String(title)).font(.system(size: 20, weight: .bold)).foregroundStyle(c.textPrimary).lineLimit(2)
            }
            if lines.count > 1 {
                Text(String(lines[1])).font(.system(size: 16)).foregroundStyle(c.textSecondary).lineLimit(2)
            }
            HStack(spacing: 6) {
                VisvineIcon(.message, size: 20)
                if !post.comments.isEmpty { Text("\(post.comments.count)").font(.system(size: 15)) }
            }
            .foregroundStyle(c.textSecondary)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }
}
