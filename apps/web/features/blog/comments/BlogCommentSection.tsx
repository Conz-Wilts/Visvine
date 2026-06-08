'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Globe, Lock, Send, Plus } from 'lucide-react';
import BlogCommentItem from './BlogCommentItem';
import type { BlogCommentData } from './types';

interface Props {
  postId: string;
  currentUserId: string | null;
  isAdmin: boolean;
}

const GUEST_COMMENTS_KEY = 'visvine:guestCommentIds';

function loadGuestCommentIds(): Set<string> {
  try {
    const raw = localStorage.getItem(GUEST_COMMENTS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveGuestCommentId(id: string) {
  try {
    const ids = loadGuestCommentIds();
    ids.add(id);
    localStorage.setItem(GUEST_COMMENTS_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable — skip silently
  }
}

export default function BlogCommentSection({ postId, currentUserId, isAdmin }: Props) {
  const [comments, setComments] = useState<BlogCommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ commentId: string; authorName: string; parentIsPrivate: boolean } | null>(null);
  const [myGuestCommentIds, setMyGuestCommentIds] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMyGuestCommentIds(loadGuestCommentIds());
  }, []);

  useEffect(() => {
    fetch(`/api/blog/${postId}/comments`)
      .then((r) => r.json())
      .then((d) => setComments(d.comments ?? []))
      .finally(() => setLoading(false));
  }, [postId]);

  const openForm = useCallback(() => {
    setShowForm(true);
    setTimeout(() => {
      if (!currentUserId && !isAnonymous) {
        nameRef.current?.focus();
      } else {
        textareaRef.current?.focus();
      }
    }, 50);
  }, [currentUserId, isAnonymous]);

  const handleReply = useCallback((commentId: string, authorName: string, parentIsPrivate: boolean) => {
    setReplyingTo({ commentId, authorName, parentIsPrivate });
    if (parentIsPrivate) setIsPrivate(true);
    setShowForm(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const handleDelete = useCallback(async (commentId: string) => {
    await fetch(`/api/blog/comments/${commentId}`, { method: 'DELETE' });
    setComments((prev) => {
      const filtered = prev.filter((c) => c.id !== commentId);
      return filtered.map((c) => ({
        ...c,
        replies: c.replies.filter((r) => r.id !== commentId),
      }));
    });
  }, []);

  const handleReaction = useCallback(async (commentId: string, emoji: string) => {
    const res = await fetch(`/api/blog/comments/${commentId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
    if (!res.ok) return;
    const { reacted } = await res.json();

    const updateReactions = (c: BlogCommentData | Omit<BlogCommentData, 'replies'>) => {
      if (c.id !== commentId) return c;
      const without = c.reactions.filter(
        (r) => !(r.userId === currentUserId && r.emoji === emoji)
      );
      const reactions = reacted
        ? [...without, { userId: currentUserId!, emoji }]
        : without;
      return { ...c, reactions };
    };

    setComments((prev) =>
      prev.map((c) => ({
        ...(updateReactions(c) as BlogCommentData),
        replies: c.replies.map((r) => updateReactions(r) as Omit<BlogCommentData, 'replies'>),
      }))
    );
  }, [currentUserId]);

  const canSubmit = Boolean(
    text.trim() && (currentUserId || isAnonymous || guestName.trim())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/blog/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text.trim(),
          isPrivate,
          parentId: replyingTo?.commentId ?? null,
          guestName: currentUserId ? undefined : (isAnonymous ? null : guestName.trim()),
        }),
      });
      if (!res.ok) return;
      const { comment } = await res.json();

      // Track guest-posted comment IDs so the delete button can be shown without a session
      if (!currentUserId) {
        saveGuestCommentId(comment.id);
        setMyGuestCommentIds((prev) => new Set([...prev, comment.id]));
      }

      if (replyingTo) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === replyingTo.commentId
              ? { ...c, replies: [...c.replies, comment] }
              : c
          )
        );
      } else {
        setComments((prev) => [...prev, { ...comment, replies: comment.replies ?? [] }]);
      }

      setText('');
      setReplyingTo(null);
      setIsPrivate(false);
      setGuestName('');
      setIsAnonymous(false);
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  const totalCount = comments.reduce((n, c) => n + 1 + c.replies.length, 0);
  const toggleLocked = Boolean(replyingTo?.parentIsPrivate);

  return (
    <section>
      {/* Header row: title + add button */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <h2 className="text-lg font-semibold text-neutral-900">
          {totalCount === 0 ? 'Comments' : `${totalCount} Comment${totalCount === 1 ? '' : 's'}`}
        </h2>
        {!showForm && (
          <button
            onClick={openForm}
            className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-800 border border-neutral-200 hover:border-neutral-300 rounded-lg px-3 py-2 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add a comment
          </button>
        )}
      </div>

      {/* Compose form — shown above comments */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-8">
          {replyingTo && (
            <div className="flex items-center gap-2 mb-2 text-[12px] text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5">
              <span>Replying to <span className="font-medium text-neutral-700">{replyingTo.authorName}</span></span>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="ml-auto text-neutral-400 hover:text-neutral-600"
                aria-label="Cancel reply"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Public / Private sliding toggle */}
          <div className="mb-3 flex items-center gap-3">
            <div
              role="group"
              className={`relative flex items-center bg-neutral-100 rounded-xl p-1 text-[13px] font-medium select-none ${toggleLocked ? 'opacity-60 pointer-events-none' : ''}`}
            >
              {/* sliding pill */}
              <span
                aria-hidden
                className={`absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-lg bg-brand-green shadow-sm transition-transform duration-200 ease-in-out ${
                  isPrivate ? 'translate-x-full' : 'translate-x-0'
                }`}
              />
              <button
                type="button"
                onClick={() => setIsPrivate(false)}
                disabled={toggleLocked}
                className={`relative z-10 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-colors duration-200 ${
                  !isPrivate ? 'text-white font-semibold' : 'text-neutral-400 hover:text-neutral-600'
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                Public
              </button>
              <button
                type="button"
                onClick={() => setIsPrivate(true)}
                disabled={toggleLocked}
                className={`relative z-10 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-colors duration-200 ${
                  isPrivate ? 'text-white font-semibold' : 'text-neutral-400 hover:text-neutral-600'
                }`}
              >
                <Lock className="h-3.5 w-3.5" />
                Private
              </button>
            </div>
            {isPrivate && (
              <span className="text-[11px] text-amber-600">
                {replyingTo?.parentIsPrivate ? 'Replies to private comments are always private.' : 'Only visible to the site admin.'}
              </span>
            )}
          </div>

          {!currentUserId && (
            <div className="mb-3 flex items-center gap-3">
              <input
                ref={nameRef}
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Your name *"
                disabled={isAnonymous}
                maxLength={80}
                className="flex-1 text-sm border border-neutral-200 rounded-lg px-3 py-1.5 outline-none focus:border-neutral-400 placeholder-neutral-400 disabled:bg-neutral-50 disabled:text-neutral-400 transition-colors"
              />
              <label className="inline-flex items-center gap-2 text-[12px] text-neutral-500 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="rounded w-4 h-4"
                />
                Anonymous
              </label>
            </div>
          )}

          <div className="flex flex-col gap-2 border border-neutral-200 rounded-xl p-3 focus-within:border-neutral-400 transition-colors">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write a comment…"
              rows={3}
              className="w-full resize-none text-sm text-neutral-800 placeholder-neutral-400 outline-none bg-transparent"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setReplyingTo(null); }}
                className="text-[13px] text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium bg-neutral-900 text-white rounded-lg px-3 py-1.5 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
                {submitting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>

        </form>
      )}

      {/* Comment list */}
      {loading ? (
        <div className="text-sm text-neutral-400">Loading comments…</div>
      ) : (
        <div className="flex flex-col gap-5">
          {comments.map((comment) => (
            <BlogCommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              myGuestCommentIds={myGuestCommentIds}
              onReply={handleReply}
              onDelete={handleDelete}
              onReaction={handleReaction}
            />
          ))}
        </div>
      )}
    </section>
  );
}
