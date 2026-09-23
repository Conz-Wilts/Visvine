'use client';

/**
 * FeedView — the "Feed" rendering mode for channels (viewMode = 'FEED').
 *
 * Same messages, same realtime backend as the chat view — just rendered as
 * social-feed post cards: composer on top, newest post first, quote-replies
 * shown as a comment thread under their post instead of inline quotes.
 */

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MessageCircleIcon, PencilIcon, PinIcon, SmileIcon, StarIcon, Trash2Icon } from '@/features/shared/icons';
import Avatar from '@/components/ui/Avatar';
import LinkPreviewCard from '@/components/ui/LinkPreviewCard';
import MessageComposer from './MessageComposer';
import { MarkdownMessage, EmojiPicker, MessageImageGrid, MessageFiles } from './MessageRow';
import { formatChatTimestamp } from '@/lib/date';
import type { ComposerPayload, ConversationSummary, SerializedMessage } from '@/lib/messages/types';

interface FeedPost {
  post: SerializedMessage;
  comments: SerializedMessage[];
}

interface FeedViewProps {
  conversation: ConversationSummary;
  /** Same state the chat view renders — oldest → newest, older pages prepended. */
  messages: SerializedMessage[];
  messagesLoading: boolean;
  currentUser: { id: string; name: string; image: string | null };
  hasMoreMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlder: () => Promise<void>;
  onSendMessage: (payload: ComposerPayload) => Promise<void>;
  onReaction: (messageId: string, emoji: string) => Promise<void>;
  onEdit: (messageId: string, text: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onToggleStar: (messageId: string) => Promise<void>;
  spaceId?: string;
}

/**
 * Classify the loaded window into posts (no replyTo) and comments (replyTo
 * chain resolves to a loaded top-level message). A reply whose parent isn't
 * loaded (page boundary, parent deleted → replyToId nulled server-side)
 * degrades to its own top-level card.
 */
function buildFeed(messages: SerializedMessage[]): FeedPost[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const commentsByPost = new Map<string, SerializedMessage[]>();
  const topLevel: SerializedMessage[] = [];

  const resolveRoot = (message: SerializedMessage): SerializedMessage | null => {
    let current = message;
    const seen = new Set<string>([current.id]);
    while (current.replyTo) {
      const parent = byId.get(current.replyTo.id);
      if (!parent || seen.has(parent.id)) return null;
      seen.add(parent.id);
      current = parent;
    }
    return current;
  };

  for (const message of messages) {
    if (!message.replyTo) {
      topLevel.push(message);
      continue;
    }
    const root = resolveRoot(message);
    if (root && root.id !== message.id) {
      const list = commentsByPost.get(root.id) ?? [];
      list.push(message);
      commentsByPost.set(root.id, list);
    } else {
      // Orphaned reply — its quote block still shows who it answered.
      topLevel.push(message);
    }
  }

  // Posts newest-first; comments stay oldest-first (messages arrive ascending).
  return topLevel
    .map((post) => ({ post, comments: commentsByPost.get(post.id) ?? [] }))
    .reverse();
}

// ─── Comment row ─────────────────────────────────────────────────────────────

export const CommentRow = memo(function CommentRow({
  comment,
  onReaction,
  onDelete,
}: {
  comment: SerializedMessage;
  onReaction: (messageId: string, emoji: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  if (comment.deletedAt) {
    return (
      <div className="flex gap-2.5 py-1.5">
        <div className="w-7 shrink-0" />
        <p className="text-xs italic text-fg-muted">This comment was deleted</p>
      </div>
    );
  }

  return (
    <div className="group relative flex gap-2.5 py-1.5" onMouseLeave={() => setShowEmojiPicker(false)}>
      <div className="shrink-0 pt-0.5">
        <Avatar name={comment.sender.name} imageUrl={comment.sender.image} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="font-semibold text-fg">{comment.isOwn ? 'You' : comment.sender.name}</span>
          <span className="ml-1.5 text-[11px] text-fg-muted">{formatChatTimestamp(comment.createdAt)}</span>
        </p>
        <div className="text-[14px] leading-relaxed text-fg [&_p]:whitespace-pre-wrap">
          <MarkdownMessage text={comment.text} />
          {comment.editedAt && <span className="ml-1 text-[11px] italic text-fg-muted">(edited)</span>}
        </div>
        <MessageImageGrid images={comment.images} />
        <MessageFiles files={comment.files} />
        {comment.reactions && comment.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {comment.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => void onReaction(comment.id, r.emoji)}
                className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
                  r.reacted
                    ? 'border-accent/30 bg-accent/10 text-fg'
                    : 'border-line-subtle bg-surface text-fg-muted hover:bg-surface-subtle'
                }`}
              >
                <span>{r.emoji}</span>
                <span className="font-medium">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover actions */}
      <div className="absolute -top-1 right-0 z-10 hidden items-center gap-0.5 rounded-lg border border-line-subtle bg-surface px-0.5 py-0.5 shadow-float group-hover:flex">
        <button
          type="button"
          onClick={() => setShowEmojiPicker(true)}
          className="rounded-md p-1 text-fg-muted hover:bg-surface-subtle hover:text-fg-secondary"
          title="React"
        >
          <SmileIcon className="h-3.5 w-3.5" />
        </button>
        {comment.isOwn && (
          <button
            type="button"
            onClick={() => void onDelete(comment.id)}
            className="rounded-md p-1 text-fg-muted hover:bg-danger-wash hover:text-danger-bright"
            title="Delete"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showEmojiPicker && (
        <div className="absolute -top-9 right-0 z-20">
          <EmojiPicker
            onSelect={(emoji) => void onReaction(comment.id, emoji)}
            onClose={() => setShowEmojiPicker(false)}
          />
        </div>
      )}
    </div>
  );
});

// ─── Post card ───────────────────────────────────────────────────────────────

const PostCard = memo(function PostCard({
  post,
  comments,
  context,
  onReaction,
  onEdit,
  onDelete,
  onToggleStar,
  onComment,
}: {
  post: SerializedMessage;
  comments: SerializedMessage[];
  /** Where the post was written, for a surface that draws more than one channel. */
  context?: ReactNode;
  onReaction: (messageId: string, emoji: string) => Promise<void>;
  onEdit: (messageId: string, text: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onToggleStar: (messageId: string) => Promise<void>;
  onComment: (postId: string, text: string) => Promise<void>;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(post.text);
  const [commentText, setCommentText] = useState('');
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);

  const isDeleted = Boolean(post.deletedAt);
  const canEdit = post.isOwn && !isDeleted && (Date.now() - new Date(post.createdAt).getTime() < 15 * 60 * 1000);

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== post.text) void onEdit(post.id, trimmed);
    setIsEditing(false);
  };

  const submitComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed || sendingComment) return;
    setSendingComment(true);
    try {
      await onComment(post.id, trimmed);
      setCommentText('');
    } finally {
      setSendingComment(false);
    }
  };

  return (
    <article
      className="group relative border-b border-line-subtle px-4 py-4 last:border-b-0"
      onMouseLeave={() => setShowEmojiPicker(false)}
      data-message-id={post.id}
    >
      {/* Header: avatar · name · time · badges */}
      <div className="flex items-center gap-2.5">
        <Avatar name={post.sender.name} imageUrl={post.sender.image} size="md" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-semibold text-fg">{post.isOwn ? 'You' : post.sender.name}</span>
            <span className="text-[11px] text-fg-muted">{formatChatTimestamp(post.createdAt)}</span>
            {context}
            {post.pinnedAt && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
                <PinIcon className="h-2.5 w-2.5" /> Pinned
              </span>
            )}
            {post.starred && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-warning-bright px-2 py-0.5 text-[10px] font-medium text-white">
                <StarIcon className="h-2.5 w-2.5 fill-current" /> Saved
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Body */}
      {isDeleted ? (
        <p className="mt-2 text-sm italic text-fg-muted">This post was deleted</p>
      ) : isEditing ? (
        <div className="mt-2 w-full section-y-2 rounded-xl border border-accent/30 bg-surface-subtle/60 px-3 py-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
              if (e.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            className="w-full resize-none bg-transparent text-sm leading-relaxed text-fg focus:outline-none"
            rows={3}
          />
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={submitEdit} className="font-medium text-accent-strong">Save</button>
            <button type="button" onClick={() => setIsEditing(false)} className="text-fg-muted">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {/* Orphaned reply degraded to a card — keep its quote context */}
          {post.replyTo && (
            <p className="mb-1 truncate border-l-4 border-line py-0.5 pl-3 text-[13px] text-fg-muted">
              <span className="font-bold text-fg-secondary">{post.replyTo.senderName}</span>
              {'  '}{post.replyTo.text}
            </p>
          )}
          {post.text && (
            <div className="text-[15px] leading-relaxed text-fg [&_a]:underline [&_p]:whitespace-pre-wrap">
              <MarkdownMessage text={post.text} />
              {post.editedAt && <span className="ml-1 text-[11px] italic text-fg-muted">(edited)</span>}
            </div>
          )}
          <MessageImageGrid images={post.images} />
          <MessageFiles files={post.files} />
          {post.linkPreviews?.map((lp) => (
            <LinkPreviewCard key={lp.url} preview={lp} />
          ))}
        </div>
      )}

      {/* Reactions + comment count */}
      {!isDeleted && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {post.reactions?.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => void onReaction(post.id, r.emoji)}
              className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${
                r.reacted
                  ? 'border-accent/30 bg-accent/10 text-fg'
                  : 'border-line-subtle bg-surface text-fg-muted hover:bg-surface-subtle'
              }`}
            >
              <span>{r.emoji}</span>
              <span className="font-medium">{r.count}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowCommentInput((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-line-subtle bg-surface px-2 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-subtle"
          >
            <MessageCircleIcon className="h-3 w-3" />
            {comments.length > 0
              ? `${comments.length} comment${comments.length === 1 ? '' : 's'}`
              : 'Comment'}
          </button>
        </div>
      )}

      {/* Comments */}
      {comments.length > 0 && (
        <div className="mt-2 border-t border-line-subtle pt-1">
          {comments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} onReaction={onReaction} onDelete={onDelete} />
          ))}
        </div>
      )}

      {/* Inline comment input */}
      {!isDeleted && (showCommentInput || comments.length > 0) && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitComment(); } }}
            placeholder="Write a comment…"
            disabled={sendingComment}
            className="min-w-0 flex-1 rounded-lg bg-surface-subtle px-3.5 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:bg-surface focus:outline-none focus:ring-1 focus:ring-line disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void submitComment()}
            disabled={!commentText.trim() || sendingComment}
            className="shrink-0 rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            Reply
          </button>
        </div>
      )}

      {/* Hover toolbar */}
      {!isDeleted && !isEditing && (
        <div className="absolute -top-3 right-3 z-10 hidden items-center gap-0.5 rounded-xl border border-line-subtle bg-surface px-1 py-0.5 shadow-float group-hover:flex">
          <button
            type="button"
            onClick={() => setShowEmojiPicker(true)}
            className="rounded-md p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg-secondary"
            title="React"
          >
            <SmileIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void onToggleStar(post.id)}
            className={`rounded-md p-1.5 hover:bg-surface-subtle ${post.starred ? 'text-warning-bright' : 'text-fg-muted hover:text-fg-secondary'}`}
            title={post.starred ? 'Remove from saved' : 'Save for later'}
          >
            <StarIcon className={`h-4 w-4 ${post.starred ? 'fill-current' : ''}`} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => { setIsEditing(true); setEditText(post.text); }}
              className="rounded-md p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg-secondary"
              title="Edit"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
          )}
          {post.isOwn && (
            <button
              type="button"
              onClick={() => void onDelete(post.id)}
              className="rounded-md p-1.5 text-fg-muted hover:bg-danger-wash hover:text-danger-bright"
              title="Delete"
            >
              <Trash2Icon className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {showEmojiPicker && (
        <div className="absolute -top-11 right-3 z-20">
          <EmojiPicker
            onSelect={(emoji) => void onReaction(post.id, emoji)}
            onClose={() => setShowEmojiPicker(false)}
          />
        </div>
      )}
    </article>
  );
});

// ─── Feed view ───────────────────────────────────────────────────────────────

export default function FeedView({
  conversation,
  messages,
  messagesLoading,
  currentUser,
  hasMoreMessages,
  loadingOlderMessages,
  onLoadOlder,
  onSendMessage,
  onReaction,
  onEdit,
  onDelete,
  onToggleStar,
  spaceId,
}: FeedViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const feed = useMemo(() => buildFeed(messages), [messages]);

  // After posting, snap the feed to the top so the author sees their new post.
  const newestPostId = feed[0]?.post.id ?? null;
  const newestIsOwn = feed[0]?.post.isOwn ?? false;
  const prevNewestRef = useRef(newestPostId);
  useEffect(() => {
    if (newestPostId !== prevNewestRef.current && newestIsOwn) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevNewestRef.current = newestPostId;
  }, [newestPostId, newestIsOwn]);

  const handleComment = (postId: string, text: string) =>
    onSendMessage({ text, replyToId: postId });

  return (
    <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl section-y-3 px-3 py-4 md:px-4">

        {/* Composer on top — no onTyping: typing indicators are a chat affordance */}
        <MessageComposer
          onSend={onSendMessage}
          spaceId={spaceId}
          conversationId={conversation.id}
          filesSpaceId={spaceId}
          variant="slim"
          currentUser={currentUser}
          placeholder="Share something…"
        />

        {messagesLoading && (
          <div className="section-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-line-subtle bg-surface px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-surface-muted" />
                  <div className="h-3 w-40 animate-pulse rounded bg-surface-muted" />
                </div>
                <div className="mt-3 h-3 animate-pulse rounded bg-surface-muted" style={{ width: `${85 - i * 15}%` }} />
              </div>
            ))}
          </div>
        )}

        {!messagesLoading && feed.length === 0 && (
          <div className="flex justify-center py-10">
            <div className="rounded-2xl bg-surface-subtle px-5 py-4 text-center text-sm text-fg-muted">
              <p className="font-medium text-fg-secondary">No posts yet</p>
              <p className="mt-0.5 text-xs text-fg-muted">Share the first post to get things going!</p>
            </div>
          </div>
        )}

        {!messagesLoading && feed.map(({ post, comments }) => (
          <PostCard
            key={post.id}
            post={post}
            comments={comments}
            onReaction={onReaction}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleStar={onToggleStar}
            onComment={handleComment}
          />
        ))}

        {/* Older content sits below the newest-first cards */}
        {!messagesLoading && hasMoreMessages && (
          <div className="flex justify-center py-2">
            {loadingOlderMessages ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            ) : (
              <button
                type="button"
                onClick={() => void onLoadOlder()}
                className="rounded-md bg-surface-subtle px-4 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-muted"
              >
                Load older posts
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
