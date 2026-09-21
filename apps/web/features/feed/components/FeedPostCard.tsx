'use client';

import { memo, useState, type ReactNode } from 'react';
import Avatar from '@/components/ui/Avatar';
import LinkPreviewCard from '@/components/ui/LinkPreviewCard';
import { HeartIcon, MessageCircleIcon, PencilIcon, SmileIcon, Trash2Icon } from '@/features/shared/icons';
import { CommentRow } from '@/features/messages/components/FeedView';
import { EmojiPicker, MarkdownMessage, MessageImageGrid } from '@/features/messages/components/MessageRow';
import { timeAgo } from '@/lib/date';
import type { SerializedMessage } from '@/lib/messages/types';

const LIKE = '❤️';
const EDIT_WINDOW_MS = 15 * 60 * 1000;

const iconButton = 'rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary';

/** A post on the Feed: author and place, the post, then a like · comment bar. */
export const FeedPostCard = memo(function FeedPostCard({
  post,
  comments,
  place,
  onReaction,
  onEdit,
  onDelete,
  onComment,
}: {
  post: SerializedMessage;
  comments: SerializedMessage[];
  place: ReactNode;
  onReaction: (messageId: string, emoji: string) => Promise<void>;
  onEdit: (messageId: string, text: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onComment: (postId: string, text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.text);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(false);

  const deleted = Boolean(post.deletedAt);
  const canEdit = post.isOwn && !deleted && Date.now() - new Date(post.createdAt).getTime() < EDIT_WINDOW_MS;
  const like = post.reactions?.find((r) => r.emoji === LIKE);
  const others = post.reactions?.filter((r) => r.emoji !== LIKE) ?? [];

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== post.text) void onEdit(post.id, trimmed);
    setEditing(false);
  };

  const submitComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onComment(post.id, trimmed);
      setCommentText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <article
      className="rounded-2xl border border-border-subtle bg-surface-1"
      data-message-id={post.id}
      onMouseLeave={() => setPicker(false)}
    >
      <div className="px-6 pb-5 pt-5">
        <header className="flex items-start gap-3">
          <Avatar name={post.sender.name} imageUrl={post.sender.image} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="truncate text-[15px] font-semibold text-text-primary">{post.isOwn ? 'You' : post.sender.name}</span>
              <span className="shrink-0 text-[13px] text-text-muted">{timeAgo(post.createdAt, { style: 'compact' })}</span>
            </p>
            <div className="truncate text-[13px] text-text-muted">{place}</div>
          </div>
          {!deleted && (
            <div className="relative flex shrink-0 items-center gap-0.5">
              {canEdit && (
                <button type="button" className={iconButton} title="Edit" onClick={() => { setEditText(post.text); setEditing(true); }}>
                  <PencilIcon className="h-4 w-4" />
                </button>
              )}
              {post.isOwn && (
                <button type="button" className={`${iconButton} hover:text-red-500`} title="Delete" onClick={() => void onDelete(post.id)}>
                  <Trash2Icon className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </header>

        {deleted ? (
          <p className="mt-4 text-sm italic text-text-muted">This post was deleted</p>
        ) : editing ? (
          <div className="mt-4 rounded-xl border border-border-default px-3 py-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              rows={4}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-text-primary focus:outline-none"
            />
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={submitEdit} className="font-semibold text-brand-dark-green">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="text-text-muted">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            {post.text && (
              <div className="text-[16px] leading-[1.7] text-text-primary [&_a]:underline [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_p+p]:mt-3 [&_p]:whitespace-pre-wrap">
                <MarkdownMessage text={post.text} />
                {post.editedAt && <span className="ml-1 text-[11px] italic text-text-muted">(edited)</span>}
              </div>
            )}
            <MessageImageGrid images={post.images} />
            {post.linkPreviews?.map((lp) => <LinkPreviewCard key={lp.url} preview={lp} />)}
          </div>
        )}
      </div>

      {!deleted && (
        <footer className="relative flex items-center gap-1 border-t border-border-subtle px-4 py-2.5">
          <button
            type="button"
            className={`${iconButton} ${like?.reacted ? 'text-red-500 hover:text-red-500' : ''}`}
            title="Like"
            aria-pressed={Boolean(like?.reacted)}
            onClick={() => void onReaction(post.id, LIKE)}
          >
            <HeartIcon className={`h-5 w-5 ${like?.reacted ? 'fill-current' : ''}`} />
          </button>
          <button type="button" className={iconButton} title="Comment" onClick={() => setShowComments((v) => !v)}>
            <MessageCircleIcon className="h-5 w-5" />
          </button>
          <button type="button" className={iconButton} title="React" onClick={() => setPicker(true)}>
            <SmileIcon className="h-5 w-5" />
          </button>
          {others.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => void onReaction(post.id, r.emoji)}
              className={`ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${r.reacted ? 'bg-surface-3 text-text-primary' : 'bg-surface-2 text-text-muted'}`}
            >
              <span>{r.emoji}</span>
              <span className="font-medium">{r.count}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            className="ml-auto text-[14px] text-text-muted hover:text-text-secondary"
          >
            {like?.count ?? 0} {like?.count === 1 ? 'like' : 'likes'} · {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
          </button>
          {picker && (
            <div className="absolute bottom-12 left-4 z-20">
              <EmojiPicker onSelect={(emoji) => void onReaction(post.id, emoji)} onClose={() => setPicker(false)} />
            </div>
          )}
        </footer>
      )}

      {!deleted && showComments && (
        <div className="border-t border-border-subtle px-6 py-3">
          {comments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} onReaction={onReaction} onDelete={onDelete} />
          ))}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitComment(); } }}
              placeholder="Write a comment…"
              disabled={sending}
              autoFocus
              className="min-w-0 flex-1 rounded-full bg-surface-2 px-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-border-default disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void submitComment()}
              disabled={!commentText.trim() || sending}
              className="shrink-0 rounded-full bg-brand-green px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              Reply
            </button>
          </div>
        </div>
      )}
    </article>
  );
});
