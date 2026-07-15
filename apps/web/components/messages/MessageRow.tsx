'use client';

/**
 * MessageRow — linear feed message (LinkedIn/Slack style).
 *
 * Every message renders left-aligned: avatar gutter, then a header line
 * (name · time) for the first message of a sender group, then plain rich
 * text. There is no own/other side split and no bubble chrome — the thread
 * reads as one continuous feed.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { Smile, Reply, Pencil, Trash2, Star, Pin } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type {
  SerializedMessage,
  SerializedReplyTo,
  SerializedLinkPreview,
} from '@/lib/messages/types';
import Avatar from '@/components/ui/Avatar';

// ─── Utilities ───────────────────────────────────────────────────────────────

export function formatChatTimestamp(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTimeOnly(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function mergeMessages(messages: SerializedMessage[]) {
  const seen = new Set<string>();
  const merged: SerializedMessage[] = [];
  for (const message of messages) {
    if (!seen.has(message.id)) {
      seen.add(message.id);
      merged.push(message);
    }
  }
  return merged;
}

// ─── Rich text renderer ──────────────────────────────────────────────────────

// Linkify @mentions and #events in a plain string (markdown handles links + formatting).
function linkifyMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(@[\w\s]+?)(?=\s@|\s#|[.,!?;:]|$|\n)|#([\w\s]+?)(?=\s@|\s#|[.,!?;:]|$|\n)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      parts.push(
        <span key={`u${m.index}`} className="font-semibold text-brand-dark-green cursor-pointer hover:underline">{m[1]}</span>,
      );
    } else if (m[2]) {
      parts.push(
        <span key={`e${m.index}`} className="font-semibold text-red-500 dark:text-red-400 cursor-pointer hover:underline">#{m[2]}</span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function applyMentions(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') return linkifyMentions(node);
  if (Array.isArray(node)) return node.map((n, i) => <span key={i}>{applyMentions(n)}</span>);
  return node;
}

const mdSanitizeSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== 'img'),
};

function MarkdownMessage({ text }: { text: string }) {
  if (!text) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, mdSanitizeSchema]]}
      components={{
        p: ({ children }) => <p className="whitespace-pre-wrap">{applyMentions(children)}</p>,
        li: ({ children }) => <li className="ml-5 list-disc">{applyMentions(children)}</li>,
        strong: ({ children }) => <strong className="font-semibold">{applyMentions(children)}</strong>,
        em: ({ children }) => <em className="italic">{applyMentions(children)}</em>,
        code: ({ children }) => <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[13px]">{children}</code>,
        pre: ({ children }) => <pre className="my-1 overflow-x-auto rounded-md bg-surface-3 p-2 font-mono text-[13px]">{children}</pre>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:opacity-80">
            {children}
          </a>
        ),
        blockquote: ({ children }) => <blockquote className="my-1 border-l-[3px] border-border-default pl-2 text-text-secondary">{children}</blockquote>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

// ─── Quick emoji picker ──────────────────────────────────────────────────────

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];

function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="flex items-center gap-0.5 rounded-xl border border-border-subtle bg-surface-1 px-2 py-1.5 shadow-float">
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => { onSelect(emoji); onClose(); }}
          className="rounded-lg p-1.5 text-base hover:bg-surface-2 transition-colors"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// ─── Media ───────────────────────────────────────────────────────────────────

function MessageImageGrid({ images }: { images: SerializedMessage['images'] }) {
  if (!images?.length) return null;

  if (images.length === 1) {
    return (
      <img
        src={images[0].imageUrl}
        alt=""
        className="mt-1.5 max-h-64 max-w-sm rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
        loading="lazy"
      />
    );
  }

  return (
    <div className="mt-1.5 grid max-w-md grid-cols-2 gap-1">
      {images.slice(0, 4).map((img, i) => (
        <div key={img.id} className="relative">
          <img
            src={img.imageUrl}
            alt=""
            className="h-32 w-full rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
            loading="lazy"
          />
          {i === 3 && images.length > 4 && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 text-white text-lg font-bold">
              +{images.length - 4}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LinkPreviewCard({ preview }: { preview: SerializedLinkPreview }) {
  if (!preview.title && !preview.description) return null;

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block max-w-md rounded-xl border border-border-subtle bg-surface-2/60 overflow-hidden hover:bg-surface-2 transition-colors"
    >
      {preview.imageUrl && (
        <img src={preview.imageUrl} alt="" className="h-32 w-full object-cover" loading="lazy" />
      )}
      <div className="px-3 py-2">
        {preview.siteName && (
          <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{preview.siteName}</p>
        )}
        {preview.title && (
          <p className="text-sm font-medium text-text-primary line-clamp-2">{preview.title}</p>
        )}
        {preview.description && (
          <p className="mt-0.5 text-xs text-text-muted line-clamp-2">{preview.description}</p>
        )}
      </div>
    </a>
  );
}

// ─── Message row ─────────────────────────────────────────────────────────────

export interface MessageRowProps {
  message: SerializedMessage;
  /** First message of a sender group — renders the avatar + name/time header. */
  showHeader?: boolean;
  /**
   * 'bubble' (default) → floating bubble card, the Messages/DM aesthetic.
   * 'feed' → flat Slack-style row (no bubble), matching the posts feed look
   * used on the Channels page.
   */
  variant?: 'bubble' | 'feed';
  onReply: (replyTo: SerializedReplyTo) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onScrollToMessage?: (messageId: string) => void;
  /** Toggle the current user's private star (saved message). */
  onToggleStar?: (messageId: string) => void;
  /** Toggle the conversation-wide pin (any member may pin, Slack-style). */
  onTogglePin?: (messageId: string) => void;
}

function MessageRow({ message, showHeader = true, variant = 'bubble', onReply, onReaction, onEdit, onDelete, onScrollToMessage, onToggleStar, onTogglePin }: MessageRowProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Channels render messages as flat feed rows; DMs keep the bubble cards.
  const feed = variant === 'feed';

  const isDeleted = Boolean(message.deletedAt);
  const isEdited = Boolean(message.editedAt);
  const canEdit = message.isOwn && !isDeleted && (Date.now() - new Date(message.createdAt).getTime() < 15 * 60 * 1000);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [isEditing]);

  const handleEditSubmit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.text) {
      onEdit(message.id, trimmed);
    }
    setIsEditing(false);
  };

  if (isDeleted) {
    return (
      <div className="flex gap-3 rounded-xl px-3 py-1">
        <div className="w-9 shrink-0" />
        <p className="text-sm italic text-text-muted">This message was deleted</p>
      </div>
    );
  }

  return (
    <div
      className={
        feed
          ? `group relative flex gap-3 rounded-xl px-3 transition-colors hover:bg-surface-2/40 ${showHeader ? 'pb-1 pt-2' : 'py-0.5'}`
          : `group relative flex gap-3 px-3 py-1 ${showHeader ? 'mt-2' : ''}`
      }
      onMouseLeave={() => setShowEmojiPicker(false)}
    >
      {/* Gutter: avatar for the first message of a group, hover timestamp after */}
      {showHeader ? (
        <div className="shrink-0 pt-0.5">
          <Avatar name={message.sender.name} imageUrl={message.sender.image} size="md" />
        </div>
      ) : (
        <div className="relative w-9 shrink-0">
          <span className="absolute right-0 top-1 hidden text-[10px] leading-none text-text-muted group-hover:block">
            {formatTimeOnly(message.createdAt)}
          </span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* Bubble card (DMs) hugs its content; feed rows (Channels) sit flat. */}
        <div
          className={
            feed
              ? 'relative'
              : 'relative w-fit max-w-full rounded-2xl border border-border-subtle/70 bg-surface-1 px-4 py-2.5 shadow-[0_2px_12px_rgba(16,24,40,0.06)]'
          }
        >
        {/* Header line: name · time · receipts */}
        {showHeader && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`${feed ? 'text-[15px]' : 'text-[13px]'} font-semibold text-text-primary`}>
              {message.isOwn ? 'You' : message.sender.name}
            </span>
            <span className="text-[11px] text-text-muted">{formatChatTimestamp(message.createdAt)}</span>
            {message.isOwn && message.recipientCount > 0 && (
              <span
                className="text-[11px]"
                title={
                  message.isFullyReadByRecipients ? 'Read by everyone' : message.readByCount > 0 ? `Read by ${message.readByCount}` : 'Sent'
                }
              >
                {message.isFullyReadByRecipients ? (
                  <span className="text-blue-500">✓✓</span>
                ) : message.readByCount > 0 ? (
                  <span className="text-text-muted">✓✓</span>
                ) : (
                  <span className="text-text-muted">✓</span>
                )}
              </span>
            )}
            {message.pinnedAt && (
              <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                📌 Pinned
              </span>
            )}
            {message.starred && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                <Star className="h-2.5 w-2.5 fill-current" /> Saved
              </span>
            )}
          </div>
        )}

        {/* Pinned/saved badges for grouped messages (the header line carries them otherwise) */}
        {!showHeader && (message.pinnedAt || message.starred) && (
          <span className="inline-flex items-center gap-1">
            {message.pinnedAt && (
              <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                📌 Pinned
              </span>
            )}
            {message.starred && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                <Star className="h-2.5 w-2.5 fill-current" /> Saved
              </span>
            )}
          </span>
        )}

        {/* Reply quote */}
        {message.replyTo && (
          <button
            type="button"
            onClick={() => onScrollToMessage?.(message.replyTo!.id)}
            className="mt-0.5 flex w-full max-w-md items-center gap-2 rounded-md border-l-[3px] border-brand-green bg-surface-2/80 px-3 py-1.5 text-left hover:bg-surface-3 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-brand-dark-green">{message.replyTo.senderName}</p>
              <p className="truncate text-xs text-text-muted">{message.replyTo.text}</p>
            </div>
          </button>
        )}

        {/* Body: rich text or edit mode */}
        {isEditing ? (
          <div className="mt-1 w-full space-y-2 rounded-xl border border-brand-green/30 bg-surface-2/60 px-3 py-2">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); }
                if (e.key === 'Escape') setIsEditing(false);
              }}
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-text-primary focus:outline-none"
              rows={2}
            />
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={handleEditSubmit} className="font-medium text-brand-dark-green">Save</button>
              <button type="button" onClick={() => setIsEditing(false)} className="text-text-muted">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {message.text && (
              <div className="text-[15px] leading-relaxed text-text-primary [&_a]:underline [&_p]:whitespace-pre-wrap">
                <MarkdownMessage text={message.text} />
                {isEdited && <span className="ml-1 text-[11px] italic text-text-muted">(edited)</span>}
              </div>
            )}

            <MessageImageGrid images={message.images} />

            {/* Image-only messages still need their edited marker */}
            {!message.text && isEdited && (
              <div className="mt-0.5"><span className="text-[11px] italic text-text-muted">(edited)</span></div>
            )}

            {message.linkPreviews?.map((lp) => (
              <LinkPreviewCard key={lp.url} preview={lp} />
            ))}
          </>
        )}

        {/* Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReaction(message.id, r.emoji)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  r.reacted
                    ? 'border-brand-green/30 bg-brand-green/10 text-text-primary'
                    : 'border-border-subtle bg-surface-1 text-text-muted hover:bg-surface-2'
                }`}
              >
                <span>{r.emoji}</span>
                <span className="font-medium">{r.count}</span>
              </button>
            ))}
          </div>
        )}
          {/* Hover actions — floating toolbar pinned to the bubble (CSS
              group-hover so a mouse pass doesn't re-render the row) */}
          {!isEditing && (
            <div className={`absolute z-10 hidden items-center gap-0.5 rounded-xl border border-border-subtle bg-surface-1 px-1 py-0.5 shadow-float group-hover:flex ${feed ? '-top-3 right-1' : '-top-4 right-3'}`}>
          <button
            type="button"
            onClick={() => setShowEmojiPicker(true)}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-secondary"
            title="React"
          >
            <Smile className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onReply({ id: message.id, text: message.text, senderName: message.sender.name })}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-secondary"
            title="Reply"
          >
            <Reply className="h-4 w-4" />
          </button>
          {onToggleStar && (
            <button
              type="button"
              onClick={() => onToggleStar(message.id)}
              className={`rounded-md p-1.5 hover:bg-surface-2 ${message.starred ? 'text-amber-500' : 'text-text-muted hover:text-text-secondary'}`}
              title={message.starred ? 'Remove from saved' : 'Save for later'}
            >
              <Star className={`h-4 w-4 ${message.starred ? 'fill-current' : ''}`} />
            </button>
          )}
          {onTogglePin && (
            <button
              type="button"
              onClick={() => onTogglePin(message.id)}
              className={`rounded-md p-1.5 hover:bg-surface-2 ${message.pinnedAt ? 'text-yellow-600 dark:text-yellow-400' : 'text-text-muted hover:text-text-secondary'}`}
              title={message.pinnedAt ? 'Unpin from conversation' : 'Pin to conversation'}
            >
              <Pin className={`h-4 w-4 ${message.pinnedAt ? 'fill-current' : ''}`} />
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => { setIsEditing(true); setEditText(message.text); }}
              className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-secondary"
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
              {message.isOwn && (
                <button
                  type="button"
                  onClick={() => onDelete(message.id)}
                  className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-500"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* Emoji picker popup */}
          {showEmojiPicker && (
            <div className={`absolute z-20 ${feed ? '-top-11 right-1' : '-top-12 right-3'}`}>
              <EmojiPicker
                onSelect={(emoji) => onReaction(message.id, emoji)}
                onClose={() => setShowEmojiPicker(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Memoized: the row re-parses markdown on every render, and the virtualized
// feed re-runs itemContent for all visible rows on each MessagesClient state
// change (typing events, scroll position, polls). Callers must pass stable
// callbacks for the memo to hold.
export default memo(MessageRow);
