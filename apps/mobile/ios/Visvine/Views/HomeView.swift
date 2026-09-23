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
/// the feed (docs/mobile.md § Home).
struct HomeView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(SearchStore.self) private var search
    @State private var model = HomeModel()
    @State private var section: HomeSection = .feed

    var onProfile: () -> Void

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(onProfile: onProfile)
            chips
            switch section {
            case .feed: feed
            case .events: EventsListView(onProfile: onProfile, embedded: true)
            case .context:
                if let root = model.context {
                    ContextFolderView(node: root, embedded: true)
                } else {
                    ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .background(c.surface)
        .task(id: space.current?.id) {
            section = .feed
            await model.load(spaceId: space.current?.id)
        }
    }

    private var feed: some View {
        let c = theme.colors
        return ScrollView {
                LazyVStack(spacing: 0) {
                    if let error = model.error {
                        Text(error).foregroundStyle(c.danger).font(.system(size: VVFontSize.s14))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x3)
                    }
                    if model.loading {
                        ProgressView().tint(c.accent).frame(maxWidth: .infinity).padding(.vertical, VVSpace.x12)
                    } else if posts.isEmpty {
                        EmptyStateView(text: search.query.isEmpty ? "Nothing in this space's feed yet" : "No posts found", icon: .message)
                    } else {
                        ForEach(posts) { post in
                            FeedPostRow(post: post)
                                .onAppear {
                                    if post.id == model.posts.last?.id { Task { await model.loadMore(spaceId: space.current?.id) } }
                                }
                            Hairline().padding(.horizontal, VVSpace.x4)
                        }
                        if model.loadingMore {
                            ProgressView().tint(c.accent).frame(maxWidth: .infinity).padding(.vertical, VVSpace.x4)
                        }
                    }
                    // Room for the floating bar.
                    Color.clear.frame(height: 160)
                }
            }
            .refreshable { await model.load(spaceId: space.current?.id) }
            .searchScope("Search feed")
    }

    /// The feed, narrowed to posts whose words, author or channel match.
    private var posts: [FeedPost] {
        let q = search.query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return model.posts }
        return model.posts.filter {
            "\($0.message.text) \($0.message.sender.name) \($0.channel.name)".lowercased().contains(q)
        }
    }

    /// Feed, Events and Context swap in place under the chips. Context is
    /// offered to an admin, or to anyone whose grants reach a note of it.
    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: VVSpace.x2_5) {
                HStack(spacing: VVSpace.x2_5) {
                    Chip(label: "Feed", on: section == .feed) { section = .feed }
                    Chip(label: "Events", on: section == .events) { section = .events }
                    if let root = model.context, space.current?.isAdmin == true || root.noteCount > 0 {
                        Chip(label: "Context", on: section == .context) { section = .context }
                    }
                }
                .padding(.horizontal, VVSpace.x4)
                .padding(.vertical, VVSpace.x2)
            }
        }
        .scrollClipDisabled()
        .padding(.bottom, VVSpace.x1)
    }
}

private enum HomeSection { case feed, events, context }

/// One post: who, in which channel, when — then the words, and the comments.
private struct FeedPostRow: View {
    @Environment(ThemeStore.self) private var theme
    let post: FeedPost

    var body: some View {
        let c = theme.colors
        let lines = post.message.text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: true)
        VStack(alignment: .leading, spacing: VVSpace.x2) {
            HStack(spacing: VVSpace.x2) {
                PersonAvatar(name: post.message.sender.name, imageUrl: post.message.sender.image, size: 28)
                Text("\(Text(post.message.sender.name).fontWeight(.semibold).foregroundStyle(c.fgSecondary))\(Text(" in ").foregroundStyle(c.fgMuted))\(Text(post.channel.name).fontWeight(.semibold).foregroundStyle(c.fgSecondary))\(Text(" · \(DateFormatting.relativeShort(post.message.createdAt))").foregroundStyle(c.fgMuted))")
                    .font(.system(size: VVFontSize.s14))
                    .lineLimit(1)
            }
            if let title = lines.first {
                Text(String(title)).font(.system(size: VVFontSize.s20, weight: .bold)).foregroundStyle(c.fg).lineLimit(2)
            }
            if lines.count > 1 {
                Text(String(lines[1])).font(.system(size: VVFontSize.s16)).foregroundStyle(c.fgSecondary).lineLimit(2)
            }
            HStack(spacing: VVSpace.x1_5) {
                VisvineIcon(.message, size: 20)
                if !post.comments.isEmpty { Text("\(post.comments.count)").font(.system(size: VVFontSize.s15)) }
            }
            .foregroundStyle(c.fgSecondary)
            .padding(.top, VVSpace.x1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, VVSpace.x4)
        .padding(.vertical, VVSpace.x4)
    }
}
