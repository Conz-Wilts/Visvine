'use client';

import { useEffect, useRef, useState } from 'react';
import { Smile, Reply, Pencil, Trash2 } from 'lucide-react';
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
        <span key={`u${m.index}`} className="font-semibold text-brand-green cursor-pointer hover:underline">{m[1]}</span>,
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
    <div ref={ref} className="flex items-center gap-0.5 rounded-xl border border-border-subtle bg-surface-1 px-2 py-1.5 shadow-lg">
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

// ─── Image grid ──────────────────────────────────────────────────────────────

function MessageImageGrid({ images }: { images: SerializedMessage['images'] }) {
  if (!images?.length) return null;

  if (images.length === 1) {
    return (
      <img
        src={images[0].imageUrl}
        alt=""
        className="mt-1.5 max-h-64 w-full rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
        loading="lazy"
      />
    );
  }

  return (
    <div className={`mt-1.5 grid gap-1 ${images.length === 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
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

// ─── Link preview card ───────────────────────────────────────────────────────

function LinkPreviewCard({ preview }: { preview: SerializedLinkPreview }) {
  if (!preview.title && !preview.description) return null;

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block rounded-xl border border-border-subtle bg-surface-1/50 overflow-hidden hover:bg-surface-2/50 transition-colors"
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

// ─── Message Bubble ──────────────────────────────────────────────────────────

export interface MessageBubbleProps {
  message: SerializedMessage;
  currentUserId: string;
  isLastInGroup?: boolean;
  onReply: (replyTo: SerializedReplyTo) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onScrollToMessage?: (messageId: string) => void;
}

export default function MessageBubble({ message, currentUserId: _currentUserId, isLastInGroup = true, onReply, onReaction, onEdit, onDelete, onScrollToMessage }: MessageBubbleProps) {
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const editRef = useRef<HTMLTextAreaElement>(null);

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
      <div className="flex items-start gap-2.5 px-5 py-1">
        <div className="mt-0.5 h-9 w-9 shrink-0" />
        <div className="italic text-sm text-text-muted">This message was deleted</div>
      </div>
    );
  }

  return (
    <div
      className="group relative flex items-start gap-2.5 rounded-lg px-5 py-1.5 hover:bg-surface-2/50 transition-colors"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false); }}
    >
      {/* Avatar — show for first in group, spacer for continuation */}
      {isLastInGroup ? (
        <div className="mt-0.5 shrink-0">
          <Avatar name={message.sender.name} imageUrl={message.sender.image} size="md" />
        </div>
      ) : (
        <div className="w-9 shrink-0" />
      )}

      <div className="relative min-w-0 flex-1">
        {/* Name + timestamp header (Slack style) */}
        {isLastInGroup && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-text-primary">{message.sender.name}</span>
            <span className="text-xs text-text-muted">{formatChatTimestamp(message.createdAt)}</span>
            {isEdited && <span className="text-xs text-text-muted italic">(edited)</span>}
          </div>
        )}

        {/* Reply preview */}
        {message.replyTo && (
          <button
            type="button"
            onClick={() => onScrollToMessage?.(message.replyTo!.id)}
            className="mb-1 flex items-center gap-2 rounded-md border-l-[3px] border-brand-green bg-surface-3/50 px-3 py-1.5 text-left"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-brand-green">{message.replyTo.senderName}</p>
              <p className="truncate text-xs text-text-muted">{message.replyTo.text}</p>
            </div>
          </button>
        )}

        {/* Message text or edit mode */}
        {isEditing ? (
          <div className="space-y-2 rounded-lg border border-brand-green/30 bg-surface-3/30 px-3 py-2">
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
              <button type="button" onClick={handleEditSubmit} className="font-medium text-brand-green">Save</button>
              <button type="button" onClick={() => setIsEditing(false)} className="text-text-muted">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed text-text-primary [&_p]:whitespace-pre-wrap">
            <MarkdownMessage text={message.text} />
          </div>
        )}

        {/* Inline timestamp for continuation messages */}
        {!isLastInGroup && !isEditing && (
          <span className="ml-1 hidden text-[11px] text-text-muted group-hover:inline">
            {formatChatTimestamp(message.createdAt)}
          </span>
        )}

        {/* Images */}
        <MessageImageGrid images={message.images} />

        {/* Link previews */}
        {message.linkPreviews?.map((lp) => (
          <LinkPreviewCard key={lp.url} preview={lp} />
        ))}

        {/* Delivery ticks (own messages, last in group) */}
        {message.isOwn && !isDeleted && isLastInGroup && message.recipientCount > 0 && (
          <span className="ml-2 inline-flex items-center align-middle text-[11px]" title={
            message.isFullyReadByRecipients ? 'Read by everyone' : message.readByCount > 0 ? `Read by ${message.readByCount}` : 'Sent'
          }>
            {message.isFullyReadByRecipients ? (
              <span className="text-blue-500">✓✓</span>
            ) : message.readByCount > 0 ? (
              <span className="text-text-muted">✓✓</span>
            ) : (
              <span className="text-text-muted">✓</span>
            )}
          </span>
        )}

        {/* Pinned indicator */}
        {message.pinnedAt && (
          <span className="ml-2 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            📌 Pinned
          </span>
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
      </div>

      {/* Hover actions toolbar — top-right like Slack */}
      {showActions && !isEditing && (
        <div className="absolute -top-3 right-5 z-10 flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-1 px-1 py-0.5 shadow-md">
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
        <div className="absolute -top-12 right-5 z-20">
          <EmojiPicker
            onSelect={(emoji) => onReaction(message.id, emoji)}
            onClose={() => setShowEmojiPicker(false)}
          />
        </div>
      )}
    </div>
  );
}
