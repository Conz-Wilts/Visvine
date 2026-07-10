'use client';

import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { Plus, ImagePlus, X, AtSign, Link2, Send, Smile, Reply } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';

const EmojiPicker = lazy(() => import('emoji-picker-react'));
import type { SerializedReplyTo } from '@/lib/messages/types';

interface MentionResult {
  id: string;
  name: string;
  imageUrl?: string | null;
  subtitle?: string | null;
  type: 'user' | 'event';
}

interface MessageComposerProps {
  onSend: (payload: {
    text: string;
    imageUrls?: string[];
    mentions?: Array<{ mentionedUserId?: string; mentionedNodeId?: string; mentionType: string }>;
    replyToId?: string;
  }) => void;
  replyTo?: SerializedReplyTo | null;
  onCancelReply?: () => void;
  communityId?: string | null;
  disabled?: boolean;
  typingLabel?: string | null;
  onTyping?: () => void;
  conversationId?: string | null;
  /**
   * 'full' (default) → the elevated card with the toolbar row (Messages/DMs).
   * 'slim' → a single-line feed-style bar (avatar · photo · text · send) for
   * the Channels page, matching the posts composer.
   */
  variant?: 'full' | 'slim';
  /** Shown as the slim composer's leading avatar. */
  currentUser?: { name: string; image: string | null };
  /** Overrides the textarea placeholder (e.g. "Message #general…"). */
  placeholder?: string;
}

const draftKey = (id: string) => `nb-msg-draft:${id}`;

export default function MessageComposer({
  onSend,
  replyTo,
  onCancelReply,
  communityId,
  disabled,
  typingLabel,
  onTyping,
  conversationId,
  variant = 'full',
  currentUser,
  placeholder,
}: MessageComposerProps) {
  // Channels use the slim, single-line feed composer; DMs keep the full card.
  const slim = variant === 'slim';
  const [text, setText] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [, setMentionQuery] = useState('');
  const [, setMentionType] = useState<'user' | 'event'>('user');
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionResult[]>([]);
  const [mentionedUsers, setMentionedUsers] = useState<string[]>([]);
  const [mentionedNodes, setMentionedNodes] = useState<string[]>([]);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Close attach menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAttachMenu]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  // Load draft on conversation change
  useEffect(() => {
    if (!conversationId) return;
    try {
      const saved = localStorage.getItem(draftKey(conversationId));
      setText(saved ?? '');
    } catch { /* ignore */ }
  }, [conversationId]);

  // Persist draft (debounced)
  useEffect(() => {
    if (!conversationId) return;
    const t = setTimeout(() => {
      try {
        if (text.trim()) localStorage.setItem(draftKey(conversationId), text);
        else localStorage.removeItem(draftKey(conversationId));
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [text, conversationId]);

  const uploadFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    setUploading(true);
    const newUrls: string[] = [];
    for (const file of images) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'message');
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          newUrls.push(data.url);
        }
      } catch { /* ignore */ }
    }
    setImageUrls((prev) => [...prev, ...newUrls]);
    setUploading(false);
  }, []);

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const pos = textarea.selectionStart;
      setText((prev) => prev.slice(0, pos) + emoji + prev.slice(pos));
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(pos + emoji.length, pos + emoji.length);
      }, 0);
    } else {
      setText((prev) => prev + emoji);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 144) + 'px';
    }
  }, [text]);

  const searchMentions = useCallback(
    async (query: string, type: 'user' | 'event') => {
      try {
        const params = new URLSearchParams({ q: query, type });
        if (communityId) params.set('communityId', communityId);
        const res = await fetch(`/api/messages/mentions?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setMentionSuggestions(data.results ?? []);
          setSelectedMentionIndex(0);
        }
      } catch { /* ignore */ }
    },
    [communityId],
  );

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    onTyping?.();

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);

    // Detect @mention for people
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    // Detect #mention for events
    const eventMatch = textBeforeCursor.match(/#(\w*)$/);

    if (mentionMatch) {
      setShowMentions(true);
      setMentionType('user');
      setMentionQuery(mentionMatch[1]);
      clearTimeout(mentionTimeoutRef.current);
      mentionTimeoutRef.current = setTimeout(() => searchMentions(mentionMatch[1], 'user'), 200);
    } else if (eventMatch) {
      setShowMentions(true);
      setMentionType('event');
      setMentionQuery(eventMatch[1]);
      clearTimeout(mentionTimeoutRef.current);
      mentionTimeoutRef.current = setTimeout(() => searchMentions(eventMatch[1], 'event'), 200);
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (result: MentionResult) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = text.slice(0, cursorPos);
    const textAfterCursor = text.slice(cursorPos);
    const triggerChar = result.type === 'event' ? '#' : '@';
    const mentionMatch = textBeforeCursor.match(new RegExp(`\\${triggerChar}(\\w*)$`));

    if (mentionMatch) {
      const newText =
        textBeforeCursor.slice(0, mentionMatch.index) +
        `${triggerChar}${result.name} ` +
        textAfterCursor;
      setText(newText);

      if (result.type === 'user') {
        setMentionedUsers((prev) => [...new Set([...prev, result.id])]);
      } else {
        setMentionedNodes((prev) => [...new Set([...prev, result.id])]);
      }
    }

    setShowMentions(false);
    textarea.focus();
  };

  const insertLink = () => {
    if (!linkUrl.trim()) return;
    const display = linkText.trim() || linkUrl;
    const markdown = `[${display}](${linkUrl})`;
    const textarea = textareaRef.current;
    if (textarea) {
      const cursorPos = textarea.selectionStart;
      setText(text.slice(0, cursorPos) + markdown + text.slice(cursorPos));
    } else {
      setText((prev) => prev + markdown);
    }
    setLinkUrl('');
    setLinkText('');
    setShowLinkInput(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    await uploadFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      await uploadFiles(files);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) await uploadFiles(files);
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed && imageUrls.length === 0) return;

    const mentions: Array<{ mentionedUserId?: string; mentionedNodeId?: string; mentionType: string }> = [];
    for (const userId of mentionedUsers) {
      mentions.push({ mentionedUserId: userId, mentionType: 'user' });
    }
    for (const nodeId of mentionedNodes) {
      mentions.push({ mentionedNodeId: nodeId, mentionType: 'event' });
    }

    onSend({
      text: trimmed || '📷',
      imageUrls: imageUrls.length ? imageUrls : undefined,
      mentions: mentions.length ? mentions : undefined,
      replyToId: replyTo?.id,
    });

    setText('');
    setImageUrls([]);
    setMentionedUsers([]);
    setMentionedNodes([]);
    if (conversationId) {
      try { localStorage.removeItem(draftKey(conversationId)); } catch { /* ignore */ }
    }
    onCancelReply?.();

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => Math.min(prev + 1, mentionSuggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionSuggestions[selectedMentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentions(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <footer
      className={`relative w-full ${slim ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-2 md:px-6'} ${isDragging ? 'bg-brand-green/5' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-green bg-white/80 text-sm font-medium text-brand-green">
          Drop images to attach
        </div>
      )}
      {/* Slim (channel) composer reads in a centered feed-width column. */}
      <div className={slim ? 'mx-auto w-full max-w-3xl' : 'contents'}>
      {typingLabel && (
        <p className="mb-1.5 px-1 text-xs text-text-muted italic">{typingLabel}</p>
      )}

      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-[3px] border-brand-green bg-surface-3/60 px-3 py-2">
          <Reply className="h-3.5 w-3.5 shrink-0 text-brand-green" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-brand-green">{replyTo.senderName}</p>
            <p className="truncate text-xs text-text-muted">{replyTo.text}</p>
          </div>
          <button type="button" onClick={onCancelReply} className="text-text-muted hover:text-text-secondary">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Image previews */}
      {imageUrls.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {imageUrls.map((url, i) => (
            <div key={url} className="relative shrink-0">
              <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => setImageUrls((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900/80 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {uploading && (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
            </div>
          )}
        </div>
      )}

      {/* Link input */}
      {showLinkInput && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-3/60 px-3 py-2">
          <Link2 className="h-4 w-4 shrink-0 text-text-muted" />
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="URL"
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            autoFocus
          />
          <input
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            placeholder="Display text (optional)"
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={insertLink}
            className="rounded-md bg-brand-green px-2.5 py-1 text-xs font-medium text-white"
          >
            Add
          </button>
          <button type="button" onClick={() => setShowLinkInput(false)} className="text-text-muted">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative">
        {/* Mention suggestions dropdown */}
        {showMentions && mentionSuggestions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 w-72 rounded-lg border border-border-subtle bg-surface-1 shadow-lg z-50 overflow-hidden max-h-48 overflow-y-auto">
            {mentionSuggestions.map((result, i) => (
              <button
                key={result.id}
                type="button"
                onClick={() => insertMention(result)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                  i === selectedMentionIndex ? 'bg-surface-2' : 'hover:bg-surface-2'
                }`}
              >
                <Avatar name={result.name} imageUrl={result.imageUrl} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{result.name}</p>
                  {result.subtitle && (
                    <p className="text-xs text-text-muted truncate">{result.subtitle}</p>
                  )}
                </div>
                <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  result.type === 'event'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                }`}>
                  {result.type === 'event' ? 'Event' : 'Person'}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Slim feed-style bar (Channels): avatar · photo · text · send */}
        {slim && (
          <div className="flex items-end gap-2 rounded-2xl border border-border-default bg-surface-1 px-3 py-2 shadow-sm transition-colors focus-within:border-brand-green/40">
            {currentUser && (
              <div className="shrink-0 self-center">
                <Avatar name={currentUser.name} imageUrl={currentUser.image} size="sm" />
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="shrink-0 self-center rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-brand-green"
              aria-label="Attach photo"
            >
              {uploading
                ? <span className="block h-5 w-5 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
                : <ImagePlus className="h-5 w-5" />}
            </button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              placeholder={placeholder ?? 'Message…'}
              disabled={disabled}
              className="custom-scrollbar max-h-[140px] min-h-[28px] flex-1 resize-none self-center bg-transparent py-1 text-[15px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || (!text.trim() && imageUrls.length === 0)}
              className="shrink-0 self-center rounded-full bg-brand-green p-2 text-white shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Minimal composer: elevated card with textarea + toolbar row below */}
        {!slim && (
        <div className="rounded-3xl border border-border-subtle bg-surface-1 shadow-float transition-shadow focus-within:border-brand-green/30">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder={placeholder ?? 'Message…'}
            disabled={disabled}
            className="max-h-36 min-h-[40px] w-full resize-none bg-transparent px-5 pt-3 pb-1 text-[15px] leading-snug text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />

          {/* Bottom toolbar row */}
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-0.5">
              {/* Plus button — opens attachment menu */}
              <div className="relative" ref={attachMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAttachMenu((v) => !v)}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    showAttachMenu
                      ? 'bg-brand-green/10 text-brand-green'
                      : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'
                  }`}
                  title="Attach"
                >
                  <Plus className="h-5 w-5" />
                </button>

                {/* Attachment popup menu */}
                {showAttachMenu && (
                  <div className="absolute bottom-full left-0 mb-1 w-44 rounded-lg border border-border-subtle bg-surface-1 py-1 shadow-lg z-50">
                    <button
                      type="button"
                      onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-surface-2 transition-colors"
                    >
                      <ImagePlus className="h-4 w-4 text-text-muted" />
                      Upload image
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowLinkInput((v) => !v); setShowAttachMenu(false); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-surface-2 transition-colors"
                    >
                      <Link2 className="h-4 w-4 text-text-muted" />
                      Add link
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />

              {/* Emoji */}
              <div className="relative" ref={emojiPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    showEmojiPicker
                      ? 'bg-brand-green/10 text-brand-green'
                      : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'
                  }`}
                  title="Emoji"
                >
                  <Smile className="h-5 w-5" />
                </button>

                {showEmojiPicker && (
                  <div className="absolute bottom-full left-0 mb-2 z-50">
                    <Suspense fallback={<div className="h-[400px] w-[350px] rounded-lg bg-surface-1 shadow-lg" />}>
                      <EmojiPicker
                        onEmojiClick={(data) => {
                          insertEmoji(data.emoji);
                          setShowEmojiPicker(false);
                        }}
                        width={350}
                        height={400}
                        lazyLoadEmojis
                        searchPlaceholder="Search emoji…"
                        previewConfig={{ showPreview: false }}
                      />
                    </Suspense>
                  </div>
                )}
              </div>

              {/* @ mention */}
              <button
                type="button"
                onClick={() => {
                  const textarea = textareaRef.current;
                  if (textarea) {
                    const pos = textarea.selectionStart;
                    setText((prev) => prev.slice(0, pos) + '@' + prev.slice(pos));
                    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(pos + 1, pos + 1); }, 0);
                  }
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-secondary transition-colors"
                title="Mention someone"
              >
                <AtSign className="h-5 w-5" />
              </button>
            </div>

            {/* Send button — right side */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || (!text.trim() && imageUrls.length === 0)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-brand-green transition-colors hover:bg-brand-green/10 disabled:text-text-muted disabled:hover:bg-transparent"
              title="Send"
            >
              <Send className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
        )}
      </div>
      </div>
    </footer>
  );
}
