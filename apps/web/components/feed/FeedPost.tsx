'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageCircle, ChevronDown, ChevronUp, Send, SmilePlus, Reply, X, Trash2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { formatDistanceToNow } from '@/lib/feedUtils';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];

interface PostAuthor {
  id: string;
  name: string;
  image?: string | null;
  person?: { subtitle?: string | null; imageUrl?: string | null } | null;
}

interface PostImage {
  id: string;
  imageUrl: string;
  position: number;
}

interface PostReaction {
  userId: string;
  emoji: string;
}

export interface PostComment {
  id: string;
  content: string;
  createdAt: string;
  parentId?: string | null;
  author: PostAuthor;
  reactions?: PostReaction[];
  replies?: PostComment[];
}

export interface FeedPostData {
  id: string;
  content: string;
  createdAt: string;
  author: PostAuthor;
  images: PostImage[];
  reactions: PostReaction[];
  comments: PostComment[];
  _count: { reactions: number; comments: number };
}

interface FeedPostProps {
  post: FeedPostData;
  currentUserId: string;
  /** When true the message shares the previous message's author header (tight grouping). */
  grouped?: boolean;
  onDelete: (postId: string) => void;
  onReactionToggle: (postId: string, emoji: string) => void;
  onCommentReaction: (postId: string, commentId: string, emoji: string) => void;
  onCommentAdded: (postId: string, comment: PostComment) => void;
}

// Group reactions by emoji
function groupReactions(reactions: PostReaction[], currentUserId: string) {
  const groups: Record<string, { emoji: string; count: number; reacted: boolean }> = {};
  for (const r of reactions) {
    if (!groups[r.emoji]) {
      groups[r.emoji] = { emoji: r.emoji, count: 0, reacted: false };
    }
    groups[r.emoji].count++;
    if (r.userId === currentUserId) {
      groups[r.emoji].reacted = true;
    }
  }
  return Object.values(groups);
}

// Inline emoji picker
function EmojiPicker({
  onSelect,
  onClose,
  align = 'left',
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`absolute bottom-full mb-1 ${align === 'right' ? 'right-0' : 'left-0'} z-50 flex gap-0.5 rounded-xl border border-border-subtle bg-surface-1 p-1.5 shadow-lg`}
    >
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onSelect(emoji); onClose(); }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-surface-2"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// Render content with @mentions highlighted and markdown links
function renderContent(content: string) {
  const parts: React.ReactNode[] = [];
  let remaining = content;
  let key = 0;

  while (remaining.length > 0) {
    const mentionMatch = remaining.match(/@([\w\s]+?)(?=\s|$|@|\[)/);
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    let nextMatch: { index: number; length: number; node: React.ReactNode } | null = null;

    if (mentionMatch && mentionMatch.index !== undefined) {
      nextMatch = {
        index: mentionMatch.index,
        length: mentionMatch[0].length,
        node: (
          <span key={key++} className="font-medium text-brand-green">
            {mentionMatch[0]}
          </span>
        ),
      };
    }

    if (linkMatch && linkMatch.index !== undefined) {
      if (!nextMatch || linkMatch.index < nextMatch.index) {
        nextMatch = {
          index: linkMatch.index,
          length: linkMatch[0].length,
          node: (
            <a
              key={key++}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-green hover:underline"
            >
              {linkMatch[1]}
            </a>
          ),
        };
      }
    }

    if (nextMatch) {
      if (nextMatch.index > 0) {
        parts.push(<span key={key++}>{remaining.slice(0, nextMatch.index)}</span>);
      }
      parts.push(nextMatch.node);
      remaining = remaining.slice(nextMatch.index + nextMatch.length);
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }

  return parts;
}

// Single comment component (used for top-level and replies)
function CommentItem({
  comment,
  postId,
  currentUserId,
  onReply,
  onCommentReaction,
  isReply = false,
}: {
  comment: PostComment;
  postId: string;
  currentUserId: string;
  onReply?: (commentId: string, authorName: string) => void;
  onCommentReaction: (postId: string, commentId: string, emoji: string) => void;
  isReply?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const commentImage = comment.author.person?.imageUrl || comment.author.image;
  const reactions = groupReactions(comment.reactions || [], currentUserId);

  return (
    <div className={`flex gap-2.5 ${isReply ? 'ml-9' : ''}`}>
      <Avatar name={comment.author.name} imageUrl={commentImage} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-text-primary">{comment.author.name}</span>
            <span className="text-[11px] text-text-muted">{formatDistanceToNow(comment.createdAt)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-text-primary">
            {renderContent(comment.content)}
          </p>
        </div>

        <div className="ml-1 mt-1 flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="text-[11px] text-text-muted transition-colors hover:text-text-primary"
            >
              React
            </button>
            {showPicker && (
              <EmojiPicker
                onSelect={(emoji) => onCommentReaction(postId, comment.id, emoji)}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
          {!isReply && onReply && (
            <button
              onClick={() => onReply(comment.id, comment.author.name)}
              className="flex items-center gap-0.5 text-[11px] text-text-muted transition-colors hover:text-text-primary"
            >
              <Reply className="h-3 w-3" />
              Reply
            </button>
          )}
        </div>

        {reactions.length > 0 && (
          <div className="ml-1 mt-1 flex flex-wrap gap-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onCommentReaction(postId, comment.id, r.emoji)}
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors ${
                  r.reacted
                    ? 'border-brand-green bg-brand-light-bg text-brand-dark-green'
                    : 'border-border-subtle bg-surface-2 text-text-muted hover:border-text-muted'
                }`}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A single post rendered as a chat message in the Slack-style feed channel:
 * avatar + inline name/time, content, images, inline reaction pills, and
 * hover actions. Consecutive posts from the same author are `grouped`
 * (header hidden, tighter spacing).
 */
export default function FeedPost({
  post,
  currentUserId,
  grouped = false,
  onDelete,
  onReactionToggle,
  onCommentReaction,
  onCommentAdded,
}: FeedPostProps) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [expandedContent, setExpandedContent] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ commentId: string; authorName: string } | null>(null);

  const isOwn = post.author.id === currentUserId;
  const authorImage = post.author.person?.imageUrl || post.author.image;
  const authorSubtitle = post.author.person?.subtitle;
  const contentIsLong = post.content.length > 400;
  const displayContent = contentIsLong && !expandedContent ? post.content.slice(0, 400) + '…' : post.content;
  const reactions = groupReactions(post.reactions, currentUserId);

  const handleComment = async () => {
    if (!commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/feed/${post.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: commentText.trim(),
          parentId: replyingTo?.commentId || null,
        }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setCommentText('');
        setReplyingTo(null);
        onCommentAdded(post.id, comment);
      }
    } finally {
      setSubmittingComment(false);
    }
  };

  return (
    <div className={`group relative flex gap-3 rounded-xl px-3 transition-colors hover:bg-surface-2/40 ${grouped ? 'py-0.5' : 'pb-1 pt-2'}`}>
      {/* Avatar gutter — keep alignment when the header is hidden in a group */}
      <div className="w-9 shrink-0">
        {!grouped && <Avatar name={post.author.name} imageUrl={authorImage} size="md" />}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold text-text-primary">{post.author.name}</span>
            {authorSubtitle && (
              <span className="truncate text-xs text-text-muted">{authorSubtitle}</span>
            )}
            <span className="shrink-0 text-[11px] text-text-muted">{formatDistanceToNow(post.createdAt)}</span>
          </div>
        )}

        {/* Content */}
        {post.content && (
          <div className={grouped ? '' : 'mt-0.5'}>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
              {renderContent(displayContent)}
            </p>
            {contentIsLong && (
              <button
                onClick={() => setExpandedContent(!expandedContent)}
                className="mt-1 flex items-center gap-0.5 text-sm text-text-muted transition-colors hover:text-brand-green"
              >
                {expandedContent ? (
                  <>Show less <ChevronUp className="h-3.5 w-3.5" /></>
                ) : (
                  <>See more <ChevronDown className="h-3.5 w-3.5" /></>
                )}
              </button>
            )}
          </div>
        )}

        {/* Images */}
        {post.images.length > 0 && (
          <div className="mt-1.5 max-w-md">
            <div
              className={`overflow-hidden rounded-xl ${
                post.images.length === 1 ? '' : 'grid grid-cols-2 gap-0.5'
              }`}
            >
              {post.images.slice(0, 4).map((img, i) => (
                <div
                  key={img.id}
                  className={`relative ${post.images.length === 3 && i === 0 ? 'row-span-2' : ''} ${
                    post.images.length === 1 ? 'max-h-[360px]' : 'aspect-square'
                  }`}
                >
                  <img src={img.imageUrl} alt="" className="h-full w-full object-cover" />
                  {i === 3 && post.images.length > 4 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <span className="text-2xl font-bold text-white">+{post.images.length - 4}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reaction pills */}
        {reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReactionToggle(post.id, r.emoji)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  r.reacted
                    ? 'border-brand-green bg-brand-light-bg text-brand-dark-green'
                    : 'border-border-subtle bg-surface-2 text-text-muted hover:border-text-muted'
                }`}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Inline actions */}
        <div className="mt-1 flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-text-primary"
            >
              <SmilePlus className="h-3.5 w-3.5" />
              React
            </button>
            {showPicker && (
              <EmojiPicker onSelect={(emoji) => onReactionToggle(post.id, emoji)} onClose={() => setShowPicker(false)} />
            )}
          </div>
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-text-primary"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {post._count.comments > 0
              ? `${post._count.comments} ${post._count.comments === 1 ? 'comment' : 'comments'}`
              : 'Comment'}
          </button>
        </div>

        {/* Comments */}
        {showComments && (
          <div className="mt-2 space-y-3 border-l-2 border-border-subtle pl-3">
            {post.comments.length > 0 && (
              <div className="space-y-3">
                {post.comments.map((comment) => (
                  <div key={comment.id}>
                    <CommentItem
                      comment={comment}
                      postId={post.id}
                      currentUserId={currentUserId}
                      onReply={(commentId, authorName) => {
                        setReplyingTo({ commentId, authorName });
                        setShowComments(true);
                      }}
                      onCommentReaction={onCommentReaction}
                    />
                    {comment.replies && comment.replies.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {comment.replies.map((reply) => (
                          <CommentItem
                            key={reply.id}
                            comment={reply}
                            postId={post.id}
                            currentUserId={currentUserId}
                            onCommentReaction={onCommentReaction}
                            isReply
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {replyingTo && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Reply className="h-3 w-3" />
                <span>Replying to <span className="font-medium text-text-primary">{replyingTo.authorName}</span></span>
                <button
                  onClick={() => setReplyingTo(null)}
                  className="ml-auto text-text-muted transition-colors hover:text-text-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <div className="flex flex-1 items-center rounded-full bg-surface-2 px-4 py-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={replyingTo ? `Reply to ${replyingTo.authorName}…` : 'Write a comment…'}
                  className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleComment()}
                />
                <button
                  onClick={handleComment}
                  disabled={!commentText.trim() || submittingComment}
                  className="ml-2 text-brand-green transition-colors disabled:text-text-muted"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hover toolbar: timestamp on grouped rows + delete */}
      <div className="absolute right-3 top-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {grouped && (
          <span className="rounded bg-surface-1 px-1 text-[10px] text-text-muted">
            {formatDistanceToNow(post.createdAt)}
          </span>
        )}
        {isOwn && (
          <button
            onClick={() => onDelete(post.id)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-red-500"
            aria-label="Delete post"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
