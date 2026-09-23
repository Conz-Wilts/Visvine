'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, EmptyState, Skeleton } from '@/components/ui';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import Link from '@/features/shared/components/SpaceLink';
import { HouseIcon, PlusIcon } from '@/features/shared/icons';
import Avatar from '@/components/ui/Avatar';
import MessageComposer from '@/features/messages/components/MessageComposer';
import { inSpace } from '@/lib/spaces/shared/spaceUrl';
import type { FeedPlace } from '@/lib/messages/shared/feed';
import { useFeed } from '../hooks/useFeed';
import { FeedPostCard } from './FeedPostCard';

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

  const [composing, setComposing] = useState(false);
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
    <div className="w-full pb-10">
      <div className="mx-auto flex w-full max-w-2xl gap-6 px-6 pt-6">
        <main className="flex min-w-0 flex-1 flex-col gap-5">
          {target && (
            <div className="rounded-2xl border border-border-subtle bg-surface-1 px-4 py-3">
              <button type="button" onClick={() => setComposing(true)} className="flex w-full items-center gap-3 text-left">
                <Avatar name={user.name} imageUrl={user.image ?? null} size="md" />
                <span className="flex-1 text-[15px] text-text-muted">Start a post</span>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-text-secondary">
                  <PlusIcon className="h-4 w-4" />
                </span>
              </button>
            </div>
          )}

          {loading && Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border-subtle bg-surface-1 px-6 py-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="mt-4 h-3" style={{ width: `${85 - i * 15}%` }} />
            </div>
          ))}

          {!loading && failed && posts.length === 0 && (
            <EmptyState title="The feed could not be loaded" size="page" />
          )}

          {!loading && !failed && posts.length === 0 && (
            <EmptyState
              title="No posts yet"
              icon={<HouseIcon />}
              size="page"
              action={targets.length === 0 ? { label: 'Find a space', href: '/discover' } : undefined}
            />
          )}

          {posts.map((post) => (
            <FeedPostCard
              key={post.message.id}
              post={post.message}
              comments={post.comments}
              place={(
                <Link
                  href={inSpace(post.space.id, `/channels/${post.conversationId}`)}
                  className="hover:text-text-secondary hover:underline"
                >
                  Posted in {placeLabel(post)}
                </Link>
              )}
              onReaction={feed.react}
              onEdit={feed.edit}
              onDelete={askDelete}
              onComment={feed.comment}
            />
          ))}

          <div ref={sentinelRef} className="flex h-10 items-center justify-center">
            {loadingOlder && <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />}
          </div>
        </main>
      </div>

      {target && composing && (
        <Modal title="New post" size="sm" onClose={() => setComposing(false)}>
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
            onSend={(payload) => { void feed.send(target.conversationId, payload); setComposing(false); }}
            spaceId={target.space.id}
            conversationId={target.conversationId}
            filesSpaceId={target.space.id}
            variant="slim"
            currentUser={{ name: user.name, image: user.image ?? null }}
            placeholder="Start a post"
          />
        </Modal>
      )}

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
