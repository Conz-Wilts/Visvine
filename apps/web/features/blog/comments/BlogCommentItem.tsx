'use client';

import { useState, useRef, useEffect } from 'react';
import { Reply, Trash2, SmilePlus, Lock } from 'lucide-react';
import { formatDistanceToNow } from '@/lib/feedUtils';
import type { BlogCommentData, BlogCommentReactionData } from './types';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];

function groupReactions(reactions: BlogCommentReactionData[], currentUserId: string | null) {
  const groups: Record<string, { emoji: string; count: number; reacted: boolean }> = {};
  for (const r of reactions) {
    if (!groups[r.emoji]) groups[r.emoji] = { emoji: r.emoji, count: 0, reacted: false };
    groups[r.emoji].count++;
    if (currentUserId && r.userId === currentUserId) groups[r.emoji].reacted = true;
  }
  return Object.values(groups);
}

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
    <div ref={ref} className="absolute bottom-full mb-1 left-0 bg-white border border-neutral-200 rounded-xl shadow-lg p-1.5 flex gap-0.5 z-50">
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onSelect(emoji); onClose(); }}
          className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-neutral-100 transition-colors"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export interface BlogCommentItemProps {
  comment: BlogCommentData | Omit<BlogCommentData, 'replies'>;
  currentUserId: string | null;
  isAdmin: boolean;
  myGuestCommentIds?: Set<string>;
  onReply?: (commentId: string, authorName: string, parentIsPrivate: boolean) => void;
  onDelete: (commentId: string) => void;
  onReaction: (commentId: string, emoji: string) => void;
  isReply?: boolean;
}

export default function BlogCommentItem({
  comment,
  currentUserId,
  isAdmin,
  myGuestCommentIds,
  onReply,
  onDelete,
  onReaction,
  isReply = false,
}: BlogCommentItemProps) {
  const [showPicker, setShowPicker] = useState(false);
  const reactions = groupReactions(comment.reactions, currentUserId);
  const displayName = comment.author?.name ?? comment.guestName ?? 'Anonymous';
  const canDelete =
    (currentUserId && currentUserId === comment.author?.id) ||
    isAdmin ||
    myGuestCommentIds?.has(comment.id);

  return (
    <div className={`flex gap-3 ${isReply ? 'ml-10' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="bg-neutral-100 rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-neutral-900">
              {displayName}
            </span>
            <span className="text-[11px] text-neutral-400">
              {formatDistanceToNow(comment.createdAt)}
            </span>
            {comment.isPrivate && isAdmin && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                <Lock className="h-2.5 w-2.5" />
                Private
              </span>
            )}
          </div>
          <p className="text-[13px] text-neutral-800 mt-0.5 whitespace-pre-wrap">{comment.content}</p>
        </div>

        {/* Reactions + actions */}
        <div className="flex items-center gap-2 mt-1 ml-1 flex-wrap">
          {/* Existing reaction counts */}
          {reactions.map((r) => (
            <button
              key={r.emoji}
              onClick={() => currentUserId && onReaction(comment.id, r.emoji)}
              className={`inline-flex items-center gap-0.5 text-[12px] rounded-full px-2 py-0.5 border transition-colors ${
                r.reacted
                  ? 'bg-neutral-200 border-neutral-400 font-medium'
                  : 'bg-white border-neutral-200 hover:border-neutral-300'
              } ${!currentUserId ? 'cursor-default' : ''}`}
            >
              <span>{r.emoji}</span>
              <span className="text-neutral-600">{r.count}</span>
            </button>
          ))}

          {/* Add reaction */}
          {currentUserId && (
            <div className="relative">
              <button
                onClick={() => setShowPicker(!showPicker)}
                className="text-neutral-400 hover:text-neutral-600 transition-colors"
                aria-label="Add reaction"
              >
                <SmilePlus className="h-3.5 w-3.5" />
              </button>
              {showPicker && (
                <EmojiPicker
                  onSelect={(emoji) => onReaction(comment.id, emoji)}
                  onClose={() => setShowPicker(false)}
                />
              )}
            </div>
          )}

          {/* Reply */}
          {!isReply && onReply && currentUserId && (
            <button
              onClick={() => onReply(comment.id, displayName, comment.isPrivate)}
              className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors flex items-center gap-0.5"
            >
              <Reply className="h-3 w-3" />
              Reply
            </button>
          )}

          {/* Delete */}
          {canDelete && (
            <button
              onClick={() => onDelete(comment.id)}
              className="text-[11px] text-neutral-400 hover:text-red-500 transition-colors flex items-center gap-0.5 ml-auto"
              aria-label="Delete comment"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Replies */}
        {'replies' in comment && comment.replies.length > 0 && (
          <div className="mt-3 flex flex-col gap-3">
            {comment.replies.map((reply) => (
              <BlogCommentItem
                key={reply.id}
                comment={reply}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                myGuestCommentIds={myGuestCommentIds}
                onDelete={onDelete}
                onReaction={onReaction}
                isReply
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
