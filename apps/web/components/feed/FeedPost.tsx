'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageCircle, MoreHorizontal, Trash2, ChevronDown, ChevronUp, Send, SmilePlus, Reply, X } from 'lucide-react';
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

interface PostComment {
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
  onDelete: (postId: string) => void;
  onReactionToggle: (postId: string, emoji: string) => void;
  onCommentReaction: (postId: string, commentId: string, emoji: string) => void;
  onCommentAdded: () => void;
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
function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute bottom-full mb-1 left-0 bg-surface-1 border border-border-subtle rounded-xl shadow-lg p-1.5 flex gap-0.5 z-50">
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onSelect(emoji); onClose(); }}
          className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-surface-2 transition-colors"
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
          <span key={key++} className="text-brand-green font-medium">
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
              className="text-brand-green hover:underline font-medium"
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
    <div className={`flex gap-2.5 ${isReply ? 'ml-10' : ''}`}>
      <Avatar name={comment.author.name} imageUrl={commentImage} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="bg-surface-2 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-text-primary">
              {comment.author.name}
            </span>
            <span className="text-[11px] text-text-muted">
              {formatDistanceToNow(comment.createdAt)}
            </span>
          </div>
          <p className="text-[13px] text-text-primary mt-0.5 whitespace-pre-wrap">
            {renderContent(comment.content)}
          </p>
        </div>

        {/* Comment actions + reactions */}
        <div className="flex items-center gap-3 mt-1 ml-1">
          <div className="relative">
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
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
              className="text-[11px] text-text-muted hover:text-text-primary transition-colors flex items-center gap-0.5"
            >
              <Reply className="h-3 w-3" />
              Reply
            </button>
          )}
        </div>

        {/* Comment reaction pills */}
        {reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1 ml-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onCommentReaction(postId, comment.id, r.emoji)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                  r.reacted
                    ? 'bg-brand-light-bg border-brand-green text-brand-dark-green'
                    : 'bg-surface-2 border-border-subtle text-text-muted hover:border-text-muted'
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

export default function FeedPost({
  post,
  currentUserId,
  onDelete,
  onReactionToggle,
  onCommentReaction,
  onCommentAdded,
}: FeedPostProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [expandedContent, setExpandedContent] = useState(false);
  const [showPostPicker, setShowPostPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ commentId: string; authorName: string } | null>(null);

  const isOwn = post.author.id === currentUserId;
  const authorImage = post.author.person?.imageUrl || post.author.image;
  const authorSubtitle = post.author.person?.subtitle;
  const contentIsLong = post.content.length > 300;
  const displayContent = contentIsLong && !expandedContent ? post.content.slice(0, 300) + '...' : post.content;
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
        setCommentText('');
        setReplyingTo(null);
        onCommentAdded();
      }
    } finally {
      setSubmittingComment(false);
    }
  };

  return (
    <article className="bg-surface-1 rounded-2xl border border-border-subtle shadow-sm overflow-hidden">
      {/* Author header */}
      <div className="flex items-start gap-3 p-4 pb-0">
        <Avatar name={post.author.name} imageUrl={authorImage} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-text-primary truncate">
              {post.author.name}
            </h3>
            <span className="text-xs text-text-muted shrink-0">
              {formatDistanceToNow(post.createdAt)}
            </span>
          </div>
          {authorSubtitle && (
            <p className="text-xs text-text-muted truncate">{authorSubtitle}</p>
          )}
        </div>

        {/* Menu */}
        {isOwn && (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 rounded-full hover:bg-surface-2 text-text-muted transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-8 w-40 bg-surface-1 border border-border-subtle rounded-xl shadow-lg z-50 overflow-hidden">
                  <button
                    onClick={() => {
                      onDelete(post.id);
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-surface-2 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete post
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pt-3 pb-2">
        <p className="text-[15px] text-text-primary leading-relaxed whitespace-pre-wrap">
          {renderContent(displayContent)}
        </p>
        {contentIsLong && (
          <button
            onClick={() => setExpandedContent(!expandedContent)}
            className="text-sm text-text-muted hover:text-brand-green mt-1 flex items-center gap-0.5 transition-colors"
          >
            {expandedContent ? (
              <>Show less <ChevronUp className="h-3.5 w-3.5" /></>
            ) : (
              <>See more <ChevronDown className="h-3.5 w-3.5" /></>
            )}
          </button>
        )}
      </div>

      {/* Images */}
      {post.images.length > 0 && (
        <div className="px-4 pb-2">
          <div
            className={`rounded-xl overflow-hidden ${
              post.images.length === 1
                ? ''
                : post.images.length === 2
                  ? 'grid grid-cols-2 gap-0.5'
                  : post.images.length === 3
                    ? 'grid grid-cols-2 gap-0.5'
                    : 'grid grid-cols-2 gap-0.5'
            }`}
          >
            {post.images.slice(0, 4).map((img, i) => (
              <div
                key={img.id}
                className={`relative ${
                  post.images.length === 3 && i === 0 ? 'row-span-2' : ''
                } ${post.images.length === 1 ? 'max-h-[400px]' : 'aspect-square'}`}
              >
                <img
                  src={img.imageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
                {i === 3 && post.images.length > 4 && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-white text-2xl font-bold">
                      +{post.images.length - 4}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reaction pills + counts */}
      {(reactions.length > 0 || post._count.comments > 0) && (
        <div className="flex items-center justify-between px-4 py-2">
          {/* Reaction pills */}
          <div className="flex flex-wrap gap-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReactionToggle(post.id, r.emoji)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${
                  r.reacted
                    ? 'bg-brand-light-bg border-brand-green text-brand-dark-green'
                    : 'bg-surface-2 border-border-subtle text-text-muted hover:border-text-muted'
                }`}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
          {post._count.comments > 0 && (
            <button
              onClick={() => setShowComments(!showComments)}
              className="text-xs text-text-muted hover:text-text-primary transition-colors hover:underline shrink-0"
            >
              {post._count.comments} {post._count.comments === 1 ? 'comment' : 'comments'}
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center border-t border-border-subtle">
        <div className="relative flex-1">
          <button
            onClick={() => setShowPostPicker(!showPostPicker)}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-2 transition-colors"
          >
            <SmilePlus className="h-[18px] w-[18px]" />
            React
          </button>
          {showPostPicker && (
            <EmojiPicker
              onSelect={(emoji) => onReactionToggle(post.id, emoji)}
              onClose={() => setShowPostPicker(false)}
            />
          )}
        </div>
        <div className="w-px h-5 bg-border-subtle" />
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-2 transition-colors"
        >
          <MessageCircle className="h-[18px] w-[18px]" />
          Comment
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="border-t border-border-subtle">
          {/* Existing comments with threading */}
          {post.comments.length > 0 && (
            <div className="px-4 pt-3 space-y-3">
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
                  {/* Replies */}
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

          {/* Reply indicator */}
          {replyingTo && (
            <div className="flex items-center gap-2 px-4 pt-2 text-xs text-text-muted">
              <Reply className="h-3 w-3" />
              <span>Replying to <span className="font-medium text-text-primary">{replyingTo.authorName}</span></span>
              <button
                onClick={() => setReplyingTo(null)}
                className="ml-auto text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Comment input */}
          <div className="flex items-center gap-2.5 p-3">
            <div className="flex-1 flex items-center bg-surface-2 rounded-full px-4 py-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={replyingTo ? `Reply to ${replyingTo.authorName}...` : 'Write a comment...'}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleComment()}
              />
              <button
                onClick={handleComment}
                disabled={!commentText.trim() || submittingComment}
                className="ml-2 text-brand-green disabled:text-text-muted transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
