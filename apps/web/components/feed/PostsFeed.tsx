'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useSession } from '@/lib/auth-client';
import FeedComposer from '@/components/feed/FeedComposer';
import FeedPost, { type FeedPostData, type PostComment } from '@/components/feed/FeedPost';
import { Loader2 } from 'lucide-react';

/**
 * The community posts feed — a "view" within the Channels page, laid out like
 * a Slack channel: posts run oldest → newest top-to-bottom, the view opens
 * pinned to the bottom (latest post), and scrolling up loads older posts.
 * The composer is a chat-style bar fixed at the bottom.
 *
 * Posts are held in ascending (chronological) order in state; the API returns
 * them newest-first, so each fetched page is reversed before it lands.
 *
 * `embedded` fills the parent column; standalone keeps a page chrome wrapper.
 */
export default function PostsFeed({ embedded = false }: { embedded?: boolean }) {
  const { currentCommunity } = useCommunity();
  const { data: session, isPending: sessionPending } = useSession();
  const [posts, setPosts] = useState<FeedPostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // When prepending older posts, remember the scroll height so we can restore
  // the viewport to the same post instead of jumping to the top.
  const prependAnchorRef = useRef<number | null>(null);
  // Whether the view should stick to the bottom on the next render. True while
  // the user is at/near the latest post; false once they scroll up to read
  // history (so loading older posts or background updates don't yank them down).
  const stickRef = useRef(true);
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => { nextCursorRef.current = nextCursor; }, [nextCursor]);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);

  const fetchPosts = useCallback(
    async (cursor?: string) => {
      if (!currentCommunity) return;
      const isInitial = !cursor;
      if (isInitial) setLoading(true);
      else setLoadingMore(true);

      try {
        const url = `/api/feed?communityId=${currentCommunity.id}${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          // API returns newest-first; reverse so the page reads oldest → newest.
          const page: FeedPostData[] = [...data.posts].reverse();
          if (isInitial) {
            setPosts(page);
          } else {
            // Older posts belong above what's already shown.
            setPosts((prev) => [...page, ...prev]);
          }
          setNextCursor(data.nextCursor);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [currentCommunity]
  );

  // Reset + load when the community changes.
  useEffect(() => {
    setPosts([]);
    setNextCursor(null);
    fetchPosts();
  }, [fetchPosts]);

  // Keep the viewport positioned correctly whenever the post list changes:
  // a pending prepend restores the prior anchor (no jump while reading older
  // posts); otherwise, while stuck to the bottom, snap to the latest post.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependAnchorRef.current !== null) {
      el.scrollTop = el.scrollHeight - prependAnchorRef.current;
      prependAnchorRef.current = null;
      return;
    }
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [posts, loading]);

  // Re-pin to the bottom as content settles after a commit — post heights,
  // web fonts and images often finish laying out a frame or two later, so the
  // single synchronous measurement above lands short. A ResizeObserver on the
  // content snaps to the latest post on each growth while the view is stuck
  // there (never while the user has scrolled up to read history). It's wired
  // through a callback ref because the content node only mounts once a
  // community is selected — a one-shot effect would miss it.
  const contentRoRef = useRef<ResizeObserver | null>(null);
  const setContentRef = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    contentRoRef.current?.disconnect();
    contentRoRef.current = null;
    if (node && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        const el = scrollRef.current;
        if (el && prependAnchorRef.current === null && stickRef.current) {
          el.scrollTop = el.scrollHeight;
        }
      });
      ro.observe(node);
      contentRoRef.current = ro;
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Re-evaluate stickiness from the live scroll position.
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop <= 80 && nextCursorRef.current && !loadingMoreRef.current) {
      prependAnchorRef.current = el.scrollHeight;
      void fetchPosts(nextCursorRef.current);
    }
  }, [fetchPosts]);

  const handlePostCreated = useCallback((post: FeedPostData) => {
    // Posting always returns the user to the latest message.
    stickRef.current = true;
    setPosts((prev) => [...prev, post]);
  }, []);

  const handleCommentAdded = useCallback((postId: string, comment: PostComment) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        if (comment.parentId) {
          return {
            ...p,
            _count: { ...p._count, comments: p._count.comments + 1 },
            comments: p.comments.map((c) =>
              c.id === comment.parentId ? { ...c, replies: [...(c.replies || []), comment] } : c
            ),
          };
        }
        return {
          ...p,
          _count: { ...p._count, comments: p._count.comments + 1 },
          comments: [...p.comments, comment],
        };
      })
    );
  }, []);

  const handleReactionToggle = async (postId: string, emoji: string) => {
    if (!session) return;
    const userId = session.user.id;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const existing = p.reactions.find((r) => r.userId === userId && r.emoji === emoji);
        return {
          ...p,
          reactions: existing
            ? p.reactions.filter((r) => !(r.userId === userId && r.emoji === emoji))
            : [...p.reactions, { userId, emoji }],
          _count: {
            ...p._count,
            reactions: existing ? p._count.reactions - 1 : p._count.reactions + 1,
          },
        };
      })
    );

    await fetch(`/api/feed/${postId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
  };

  const handleCommentReaction = async (postId: string, commentId: string, emoji: string) => {
    if (!session) return;
    const userId = session.user.id;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          comments: p.comments.map((c) => {
            if (c.id === commentId) {
              const existing = (c.reactions || []).find((r) => r.userId === userId && r.emoji === emoji);
              return {
                ...c,
                reactions: existing
                  ? (c.reactions || []).filter((r) => !(r.userId === userId && r.emoji === emoji))
                  : [...(c.reactions || []), { userId, emoji }],
              };
            }
            if (c.replies) {
              return {
                ...c,
                replies: c.replies.map((r) => {
                  if (r.id !== commentId) return r;
                  const existing = (r.reactions || []).find((rx) => rx.userId === userId && rx.emoji === emoji);
                  return {
                    ...r,
                    reactions: existing
                      ? (r.reactions || []).filter((rx) => !(rx.userId === userId && rx.emoji === emoji))
                      : [...(r.reactions || []), { userId, emoji }],
                  };
                }),
              };
            }
            return c;
          }),
        };
      })
    );

    await fetch(`/api/feed/${postId}/comments/${commentId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
  };

  const handleDelete = async (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    await fetch(`/api/feed/${postId}`, { method: 'DELETE' });
  };

  if (!currentCommunity) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="px-4 py-12 text-center text-text-muted">
          Please select a community to view the feed.
        </p>
      </div>
    );
  }

  // Whether each post shares the previous post's author header (chat grouping):
  // same author and within 5 minutes of the previous post.
  const GROUP_WINDOW_MS = 5 * 60 * 1000;
  const isGrouped = (i: number) => {
    if (i === 0) return false;
    const prev = posts[i - 1];
    const cur = posts[i];
    if (prev.author.id !== cur.author.id) return false;
    return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
  };

  const list = (
    <div ref={scrollRef} onScroll={handleScroll} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
      {/* Push content to the bottom when it doesn't fill the viewport. */}
      <div ref={setContentRef} className="flex min-h-full flex-col justify-end">
        {loadingMore && (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
          </div>
        )}

        {sessionPending || loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            <p className="text-sm text-text-muted">Loading feed…</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <div className="mb-3 text-4xl">📝</div>
            <h3 className="mb-1 text-lg font-semibold text-text-primary">No posts yet</h3>
            <p className="text-sm text-text-muted">Be the first to post in your community channel.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 py-3">
            {posts.map((post, i) => (
              <FeedPost
                key={post.id}
                post={post}
                grouped={isGrouped(i)}
                currentUserId={session?.user.id || ''}
                onDelete={handleDelete}
                onReactionToggle={handleReactionToggle}
                onCommentReaction={handleCommentReaction}
                onCommentAdded={handleCommentAdded}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`mx-auto flex h-full w-full max-w-2xl flex-col ${embedded ? '' : 'py-4'}`}>
      {list}
      {session && (
        <div className="shrink-0 px-3 pb-3 pt-2">
          <FeedComposer
            currentUser={{ name: session.user.name, image: session.user.image }}
            onPostCreated={handlePostCreated}
          />
        </div>
      )}
    </div>
  );
}
