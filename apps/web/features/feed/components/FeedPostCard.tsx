'use client';

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar, Chip } from '@visvine/ui';
import LinkPreviewCard from '@/features/shared/components/LinkPreviewCard';
import { HeartIcon, MessageCircleIcon, PencilIcon, SmileIcon, Trash2Icon } from '@/features/shared/icons';
import { CommentRow } from '@/features/messages/components/FeedView';
import { EmojiPicker, MarkdownMessage, MessageImageGrid, MessageFiles } from '@/features/messages/components/MessageRow';
import { timeAgo } from '@/lib/date';
import type { FeedBadge } from '@/lib/messages/shared/feed';
import type { SerializedMessage } from '@/lib/messages/types';

const LIKE = '❤️';
const EDIT_WINDOW_MS = 15 * 60 * 1000;

const iconButton = 'rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-subtle hover:text-fg';

/** A post on the Feed: author, their alias and place, the post, then a like · comment bar. */
export const FeedPostCard = memo(function FeedPostCard({
  post,
  comments,
  badge,
  place,
  onReaction,
  onEdit,
  onDelete,
  onComment,
}: {
  post: SerializedMessage;
  comments: SerializedMessage[];
  badge?: FeedBadge;
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
      className="rounded-2xl border border-line-subtle bg-surface"
      data-message-id={post.id}
      onMouseLeave={() => setPicker(false)}
    >
      <div className="px-6 pb-5 pt-5">
        <header className="flex items-start gap-3">
          <Avatar name={post.sender.name} imageUrl={post.sender.image} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-semibold text-fg">{post.sender.name}</span>
              {badge && <Chip color={badge.color} size="sm" className="shrink-0">{badge.name}</Chip>}
              <span className="shrink-0 text-[13px] text-fg-muted">{timeAgo(post.createdAt, { style: 'compact' })}</span>
            </p>
            <div className="truncate text-[13px] text-fg-muted">{place}</div>
          </div>
          {!deleted && (canEdit || post.isOwn) && (
            <PostMenu
              onEdit={canEdit ? () => { setEditText(post.text); setEditing(true); } : undefined}
              onDelete={post.isOwn ? () => void onDelete(post.id) : undefined}
            />
          )}
        </header>

        {deleted ? (
          <p className="mt-4 text-sm italic text-fg-muted">This post was deleted</p>
        ) : editing ? (
          <div className="mt-4 rounded-xl border border-line px-3 py-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              rows={4}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-fg focus:outline-none"
            />
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={submitEdit} className="font-semibold text-accent-strong">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="text-fg-muted">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            {post.text && (
              <div className="text-[16px] leading-[1.7] text-fg [&_a]:underline [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_p+p]:mt-3 [&_p]:whitespace-pre-wrap">
                <MarkdownMessage text={post.text} />
                {post.editedAt && <span className="ml-1 text-[11px] italic text-fg-muted">(edited)</span>}
              </div>
            )}
            <MessageImageGrid images={post.images} />
          <MessageFiles files={post.files} />
            {post.linkPreviews?.map((lp) => <LinkPreviewCard key={lp.url} preview={lp} />)}
          </div>
        )}
      </div>

      {!deleted && (
        <footer className="relative flex items-center gap-1 border-t border-line-subtle px-4 py-2.5">
          <button
            type="button"
            className={`${iconButton} ${like?.reacted ? 'text-danger-bright hover:text-danger-bright' : ''}`}
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
              className={`ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${r.reacted ? 'bg-surface-muted text-fg' : 'bg-surface-subtle text-fg-muted'}`}
            >
              <span>{r.emoji}</span>
              <span className="font-medium">{r.count}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            className="ml-auto text-[14px] text-fg-muted hover:text-fg-secondary"
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
        <div className="border-t border-line-subtle px-6 py-3">
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
              className="min-w-0 flex-1 rounded-full bg-surface-subtle px-4 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-line disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void submitComment()}
              disabled={!commentText.trim() || sending}
              className="shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              Reply
            </button>
          </div>
        </div>
      )}
    </article>
  );
});

/** The post's own actions behind three dots — Edit while the window is open, Delete for its author. */
function PostMenu({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = 'flex h-8 w-full items-center gap-2 px-3 text-left text-[13px] transition-colors hover:bg-surface-subtle';
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={iconButton}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="19" cy="12" r="1.9" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="dropdown-pop absolute right-0 top-full z-20 mt-1 w-36 rounded-xl border border-line-subtle bg-surface py-[5px] shadow-float"
        >
          {onEdit && (
            <button type="button" role="menuitem" className={`${item} text-fg-secondary`} onClick={pick(onEdit)}>
              <PencilIcon className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
          {onDelete && (
            <button type="button" role="menuitem" className={`${item} text-danger-bright`} onClick={pick(onDelete)}>
              <Trash2Icon className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
