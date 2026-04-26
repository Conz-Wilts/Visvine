'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useSession } from '@/lib/auth-client';
import PostComposer from '@/components/feed/PostComposer';
import FeedPost, { type FeedPostData } from '@/components/feed/FeedPost';
import { Loader2 } from 'lucide-react';

export default function FeedPage() {
  const { currentCommunity } = useCommunity();
  const { data: session, isPending: sessionPending } = useSession();
  const [posts, setPosts] = useState<FeedPostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

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
          if (isInitial) {
            setPosts(data.posts);
          } else {
            setPosts((prev) => [...prev, ...data.posts]);
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

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleReactionToggle = async (postId: string, emoji: string) => {
    if (!session) return;
    const userId = session.user.id;

    // Optimistic update
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

    // Optimistic update on nested comment reactions
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          comments: p.comments.map((c) => {
            // Check top-level comment
            if (c.id === commentId) {
              const existing = (c.reactions || []).find((r) => r.userId === userId && r.emoji === emoji);
              return {
                ...c,
                reactions: existing
                  ? (c.reactions || []).filter((r) => !(r.userId === userId && r.emoji === emoji))
                  : [...(c.reactions || []), { userId, emoji }],
              };
            }
            // Check replies
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
      <div className="min-h-screen w-full py-8">
        <div className="w-full max-w-2xl mx-auto px-4">
          <p className="text-center text-text-muted py-12">
            Please select a community to view the feed.
          </p>
        </div>
      </div>
    );
  }

  if (sessionPending) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="w-full py-8">
      <div className="w-full max-w-2xl mx-auto px-4">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Feed</h1>
          <p className="text-sm text-text-muted mt-1">
            Stay up to date with your community
          </p>
        </div>

        {/* Post composer */}
        {session && (
          <div className="mb-6">
            <PostComposer
              currentUser={{
                name: session.user.name,
                image: session.user.image,
              }}
              onPostCreated={() => fetchPosts()}
            />
          </div>
        )}

        {/* Feed posts */}
        {loading ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            <p className="text-sm text-text-muted">Loading feed...</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-12 text-center">
            <div className="text-4xl mb-3">📝</div>
            <h3 className="text-lg font-semibold text-text-primary mb-1">No posts yet</h3>
            <p className="text-sm text-text-muted">
              Be the first to share something with your community!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <FeedPost
                key={post.id}
                post={post}
                currentUserId={session?.user.id || ''}
                onDelete={handleDelete}
                onReactionToggle={handleReactionToggle}
                onCommentReaction={handleCommentReaction}
                onCommentAdded={() => fetchPosts()}
              />
            ))}

            {/* Load more */}
            {nextCursor && (
              <div className="flex justify-center py-4">
                <button
                  onClick={() => fetchPosts(nextCursor)}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary bg-surface-1 border border-border-subtle rounded-full hover:shadow-sm transition-all"
                >
                  {loadingMore ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
