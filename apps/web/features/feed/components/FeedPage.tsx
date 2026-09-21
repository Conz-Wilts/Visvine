'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, EmptyState, Skeleton } from '@/components/ui';
import Select from '@/components/ui/Select';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import Link from '@/features/shared/components/SpaceLink';
import { NewspaperIcon } from '@/features/shared/icons';
import MessageComposer from '@/features/messages/components/MessageComposer';
import { PostCard } from '@/features/messages/components/FeedView';
import { inSpace } from '@/lib/spaces/shared/spaceUrl';
import type { FeedPlace } from '@/lib/messages/shared/feed';
import { useFeed } from '../hooks/useFeed';

const TARGET_KEY = 'vv-feed-target';

function readTarget(): string | null {
  try { return window.localStorage.getItem(TARGET_KEY); } catch { return null; }
}

const placeLabel = (place: FeedPlace) => `${place.space.name} · ${place.channel.name}`;

/** The feed: every post from the FEED channels a person has joined, across
 *  their spaces, newest first. */
export default function FeedPage() {
  const { user } = useAuth();
  const feed = useFeed(user?.id ?? '');
  const { posts, targets, loading, failed, hasMore, loadingOlder, loadOlder } = feed;

  // Where a new post lands: the last channel posted into, else the first.
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => { setChosen(readTarget()); }, []);
  const target = targets.find((t) => t.conversationId === chosen) ?? targets[0] ?? null;

  const chooseTarget = (conversationId: string) => {
    setChosen(conversationId);
    try { window.localStorage.setItem(TARGET_KEY, conversationId); } catch { /* private mode */ }
  };

  const [deleting, setDeleting] = useState<string | null>(null);
  const askDelete = useCallback(async (messageId: string) => { setDeleting(messageId); }, []);

  // Older pages load as the end of the list comes into view.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadOlder();
    }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadOlder]);

  if (!user) return null;

  return (
    <div className="mx-auto w-full max-w-2xl pr-6 pt-2">
      {target && (
        <div className="border-b border-border-subtle pb-3">
          {targets.length > 1 && (
            <Select
              aria-label="Post to"
              className="mb-2 w-fit max-w-full"
              value={target.conversationId}
              onChange={(e) => chooseTarget(e.target.value)}
            >
              {targets.map((t) => (
                <option key={t.conversationId} value={t.conversationId}>{placeLabel(t)}</option>
              ))}
            </Select>
          )}
          <MessageComposer
            key={target.conversationId}
            onSend={(payload) => void feed.send(target.conversationId, payload)}
            spaceId={target.space.id}
            conversationId={target.conversationId}
            variant="slim"
            currentUser={{ name: user.name, image: user.image ?? null }}
            placeholder="Share something…"
          />
        </div>
      )}

      {loading && Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="border-b border-border-subtle px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="mt-3 h-3" style={{ width: `${85 - i * 15}%` }} />
        </div>
      ))}

      {!loading && failed && posts.length === 0 && (
        <EmptyState title="The feed could not be loaded" size="page" />
      )}

      {!loading && !failed && posts.length === 0 && (
        <EmptyState
          title="No posts yet"
          icon={<NewspaperIcon />}
          size="page"
          action={targets.length === 0 ? { label: 'Find a space', href: '/discover' } : undefined}
        />
      )}

      {posts.map((post) => (
        <PostCard
          key={post.message.id}
          post={post.message}
          comments={post.comments}
          context={(
            <Link
              href={inSpace(post.space.id, `/channels/${post.conversationId}`)}
              className="truncate text-[11px] text-text-muted hover:text-text-secondary hover:underline"
            >
              {placeLabel(post)}
            </Link>
          )}
          onReaction={feed.react}
          onEdit={feed.edit}
          onDelete={askDelete}
          onToggleStar={feed.toggleStar}
          onComment={feed.comment}
        />
      ))}

      <div ref={sentinelRef} className="flex h-10 items-center justify-center">
        {loadingOlder && <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={posts.some((p) => p.message.id === deleting) ? 'Delete this post?' : 'Delete this comment?'}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await feed.remove(deleting);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
