'use client';

/**
 * MessageRow — linear feed message (LinkedIn/Slack style).
 *
 * Every message renders left-aligned: avatar gutter, then a header line
 * (name · time) for the first message of a sender group, then plain rich
 * text. There is no own/other side split and no bubble chrome — the thread
 * reads as one continuous feed.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, PencilIcon, ReplyIcon, SmileIcon, StarIcon, Trash2Icon } from '@/features/shared/icons';
import Image from 'next/image';
import ReactMarkdown, { type Options as ReactMarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type {
  SerializedMessage,
  SerializedReplyTo,
} from '@/lib/messages/types';
import { Avatar } from '@visvine/ui';
import LinkPreviewCard from '@/features/shared/components/LinkPreviewCard';
import Link from '@/features/shared/components/SpaceLink';
import { FILE_LABEL, FileTypeIcon } from '@/features/resources/components/resourceUi';
import { formatBytes } from '@/lib/utils';
import { isOptimizableImageUrl } from '@/lib/mediaUrl';
import { formatChatTimestamp, formatTime } from '@/lib/date';

// ─── Utilities ───────────────────────────────────────────────────────────────

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
        <span key={`u${m.index}`} className="font-semibold text-accent-strong cursor-pointer hover:underline">{m[1]}</span>,
      );
    } else if (m[2]) {
      parts.push(
        <span key={`e${m.index}`} className="font-semibold text-danger-bright cursor-pointer hover:underline">#{m[2]}</span>,
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

// Hoisted to module scope: fresh plugin arrays / components maps per render
// defeat react-markdown's internal memoization and force a full re-parse of
// every visible message whenever the virtualized list re-renders.
const MD_REMARK_PLUGINS: ReactMarkdownOptions['remarkPlugins'] = [remarkGfm];
const MD_REHYPE_PLUGINS: ReactMarkdownOptions['rehypePlugins'] = [[rehypeSanitize, mdSanitizeSchema]];
const MD_COMPONENTS: ReactMarkdownOptions['components'] = {
  p: ({ children }) => <p className="whitespace-pre-wrap">{applyMentions(children)}</p>,
  li: ({ children }) => <li className="ml-5 list-disc">{applyMentions(children)}</li>,
  strong: ({ children }) => <strong className="font-semibold">{applyMentions(children)}</strong>,
  em: ({ children }) => <em className="italic">{applyMentions(children)}</em>,
  code: ({ children }) => <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[13px]">{children}</code>,
  pre: ({ children }) => <pre className="my-1 overflow-x-auto rounded-md bg-surface-muted p-2 font-mono text-[13px]">{children}</pre>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-fg-link underline hover:opacity-80">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="my-1 border-l-[3px] border-line pl-2 text-fg-secondary">{children}</blockquote>,
};

// memo()'d so a MessageRow re-render with unchanged text (reactions, hover
// state, read receipts) never re-runs the remark/rehype parse pipeline.
export const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  if (!text) return null;
  return (
    <ReactMarkdown
      remarkPlugins={MD_REMARK_PLUGINS}
      rehypePlugins={MD_REHYPE_PLUGINS}
      components={MD_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
});

// ─── Quick emoji picker ──────────────────────────────────────────────────────

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];

export function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="flex items-center gap-0.5 rounded-xl border border-line-subtle bg-surface px-2 py-1.5 shadow-float">
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => { onSelect(emoji); onClose(); }}
          className="rounded-lg p-1.5 text-base hover:bg-surface-subtle transition-colors"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// ─── Media ───────────────────────────────────────────────────────────────────

// Only http(s)/relative URLs may go through next/image — optimistic sends or
// previews could theoretically carry blob:/data: sources, which must stay <img>.
// A Drive file's `/raw` address is a gated redirect the optimizer cannot follow
// (it fetches without the reader's cookie), so it stays <img> too.
function isNextImageSrc(url: string): boolean {
  if (url.startsWith('/api/resources/')) return false;
  return url.startsWith('/') || url.startsWith('https://') || url.startsWith('http://');
}

/**
 * The Drive files a message carries: its images as the image grid, anything
 * else as one hairline row each — type, name, size — opening the file's page.
 */
export function MessageFiles({ files }: { files: SerializedMessage['files'] }) {
  if (!files?.length) return null;
  const images = files.filter((f) => f.fileType === 'image');
  const others = files.filter((f) => f.fileType !== 'image');
  return (
    <>
      <MessageImageGrid images={images.map((f, i) => ({ id: f.id, imageUrl: f.url, position: i }))} />
      {others.length > 0 && (
        <div className="mt-1.5 flex max-w-md flex-col gap-1">
          {others.map((file) => (
            <Link
              key={file.id}
              href={`/resources/${encodeURIComponent(file.id)}`}
              className="flex items-center gap-3 rounded-xl border border-line-subtle px-3 py-2 transition-colors hover:bg-surface-subtle"
            >
              <FileTypeIcon type={file.fileType} className="h-9 w-9 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{file.name}</span>
                <span className="block text-xs text-fg-muted">
                  {[FILE_LABEL[file.fileType] ?? file.fileType, formatBytes(file.fileSize ?? undefined)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function MessageImageGrid({ images }: { images: SerializedMessage['images'] }) {
  if (!images?.length) return null;

  if (images.length === 1) {
    // Kept as a raw <img>: layout is intrinsic-size driven (natural size
    // capped by max-h-64/max-w-sm) and stored messages carry no width/height
    // metadata, so next/image can't reproduce it without a fixed container.
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
        <div key={img.id} className="relative h-32">
          {isNextImageSrc(img.imageUrl) ? (
            <Image
              src={img.imageUrl}
              alt=""
              fill
              // Cells are half of a max-w-md (28rem) grid → ≤ ~220px each.
              sizes="(max-width: 480px) 50vw, 220px"
              className="rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
              unoptimized={!isOptimizableImageUrl(img.imageUrl)}
            />
          ) : (
            <img
              src={img.imageUrl}
              alt=""
              className="h-32 w-full rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
              loading="lazy"
            />
          )}
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

// ─── Message row ─────────────────────────────────────────────────────────────

interface MessageRowProps {
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
}

function MessageRow({ message, showHeader = true, variant = 'bubble', onReply, onReaction, onEdit, onDelete, onScrollToMessage, onToggleStar }: MessageRowProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Channels render messages as flat feed rows; DMs keep the bubble cards.
  const feed = variant === 'feed';

  // Keyed on the text content: local state changes (emoji picker, edit mode)
  // reuse the same element, so React bails out of re-rendering the markdown
  // subtree entirely.
  const markdownBody = useMemo(
    () => (message.text ? <MarkdownMessage text={message.text} /> : null),
    [message.text],
  );

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
        <p className="text-sm italic text-fg-muted">This message was deleted</p>
      </div>
    );
  }

  return (
    <div
      className={
        feed
          ? `group relative flex gap-3 rounded-xl px-3 transition-colors hover:bg-surface-subtle/40 ${showHeader ? 'pb-1 pt-2' : 'py-0.5'}`
          : `group relative flex gap-3 rounded-xl px-3 transition-colors hover:bg-surface-subtle/40 ${showHeader ? 'pb-1 pt-2' : 'py-0.5'}`
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
          <span className="absolute right-0 top-1 hidden text-[10px] leading-none text-fg-muted group-hover:block">
            {formatTime(message.createdAt)}
          </span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* Every row sits flat on the page — DMs and channels alike. The
            avatar gutter and the name line are what separate one message
            from the next; there is no bubble. */}
        <div className="relative">
        {/* Header line: name · time · receipts */}
        {showHeader && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`${feed ? 'text-[15px]' : 'text-[13px]'} font-semibold text-fg`}>
              {message.isOwn ? 'You' : message.sender.name}
            </span>
            <span className="text-[11px] text-fg-muted">{formatChatTimestamp(message.createdAt)}</span>
            {message.isOwn && message.recipientCount > 0 && (
              <span
                className="text-[11px]"
                title={
                  message.isFullyReadByRecipients ? 'Read by everyone' : message.readByCount > 0 ? `Read by ${message.readByCount}` : 'Sent'
                }
              >
                {message.isFullyReadByRecipients || message.readByCount > 0 ? (
                  <span className={`inline-flex ${message.isFullyReadByRecipients ? 'text-info-bright' : 'text-fg-muted'}`}>
                    <CheckIcon className="h-3 w-3" />
                    <CheckIcon className="-ml-[5px] h-3 w-3" />
                  </span>
                ) : (
                  <CheckIcon className="h-3 w-3 text-fg-muted" />
                )}
              </span>
            )}
            {message.starred && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-warning-bright px-2 py-0.5 text-[10px] font-medium text-white">
                <StarIcon className="h-2.5 w-2.5 fill-current" /> Saved
              </span>
            )}
          </div>
        )}

        {/* Saved badge for grouped messages (the header line carries it otherwise) */}
        {!showHeader && message.starred && (
          <span className="inline-flex items-center gap-0.5 rounded-md bg-warning-bright px-2 py-0.5 text-[10px] font-medium text-white">
            <StarIcon className="h-2.5 w-2.5 fill-current" /> Saved
          </span>
        )}

        {/* Reply quote — Slack-style blockquote: plain gray bar, no card */}
        {message.replyTo && (
          <button
            type="button"
            onClick={() => onScrollToMessage?.(message.replyTo!.id)}
            className="group/quote mt-0.5 block w-full max-w-md border-l-4 border-line py-0.5 pl-3 text-left transition-colors hover:border-fg-muted"
          >
            <p className="truncate text-[13px] text-fg-muted">
              <span className="font-bold text-fg-secondary group-hover/quote:text-fg">{message.replyTo.senderName}</span>
              {'  '}{message.replyTo.text}
            </p>
          </button>
        )}

        {/* Body: rich text or edit mode */}
        {isEditing ? (
          <div className="mt-1 w-full section-y-2 rounded-lg bg-surface-subtle px-3 py-2">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); }
                if (e.key === 'Escape') setIsEditing(false);
              }}
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-fg focus:outline-none"
              rows={2}
            />
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={handleEditSubmit} className="font-medium text-accent-strong">Save</button>
              <button type="button" onClick={() => setIsEditing(false)} className="text-fg-muted">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {message.text && (
              <div className="text-[15px] leading-relaxed text-fg [&_a]:underline [&_p]:whitespace-pre-wrap">
                {markdownBody}
                {isEdited && <span className="ml-1 text-[11px] italic text-fg-muted">(edited)</span>}
              </div>
            )}

            <MessageImageGrid images={message.images} />
            <MessageFiles files={message.files} />

            {/* Image-only messages still need their edited marker */}
            {!message.text && isEdited && (
              <div className="mt-0.5"><span className="text-[11px] italic text-fg-muted">(edited)</span></div>
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
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                  r.reacted
                    ? 'bg-accent/15 text-fg'
                    : 'bg-surface-subtle text-fg-muted hover:bg-surface-muted'
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
            <div className="absolute -top-3 right-1 z-10 hidden items-center gap-0.5 rounded-lg bg-surface px-1 py-0.5 shadow-float group-hover:flex">
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
            onClick={() => onReply({ id: message.id, text: message.text, senderName: message.sender.name })}
            className="rounded-md p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg-secondary"
            title="Reply"
          >
            <ReplyIcon className="h-4 w-4" />
          </button>
          {onToggleStar && (
            <button
              type="button"
              onClick={() => onToggleStar(message.id)}
              className={`rounded-md p-1.5 hover:bg-surface-subtle ${message.starred ? 'text-warning-bright' : 'text-fg-muted hover:text-fg-secondary'}`}
              title={message.starred ? 'Remove from saved' : 'Save for later'}
            >
              <StarIcon className={`h-4 w-4 ${message.starred ? 'fill-current' : ''}`} />
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => { setIsEditing(true); setEditText(message.text); }}
              className="rounded-md p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg-secondary"
              title="Edit"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
          )}
              {message.isOwn && (
                <button
                  type="button"
                  onClick={() => onDelete(message.id)}
                  className="rounded-md p-1.5 text-fg-muted hover:bg-danger-wash hover:text-danger-bright"
                  title="Delete"
                >
                  <Trash2Icon className="h-4 w-4" />
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
