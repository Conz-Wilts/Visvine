'use client';

import { uploadResourceFile } from '@/features/resources/lib/upload';
import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import { AtSignIcon, FolderOpenIcon, ImagePlusIcon, Link2Icon, PlusIcon, SendIcon, SmileIcon, UploadIcon, XIcon } from '@/features/shared/icons';
import { Menu } from '@visvine/ui';
import ResourcePicker from '@/features/resources/components/ResourcePicker';
import type { ResourceView } from '@/lib/resources/shared/view';
import { FileTypeIcon } from '@/features/resources/components/resourceUi';
import { resourceRawPath } from '@/lib/resources/shared/fileNode';
import { Avatar } from '@visvine/ui';

const EmojiPicker = lazy(() => import('emoji-picker-react'));
import type { ComposerPayload, SerializedMessageFile, SerializedReplyTo } from '@/lib/messages/types';

interface MentionResult {
  id: string;
  name: string;
  imageUrl?: string | null;
  subtitle?: string | null;
  type: 'user' | 'event';
}

interface MessageComposerProps {
  onSend: (payload: ComposerPayload) => void;
  replyTo?: SerializedReplyTo | null;
  onCancelReply?: () => void;
  spaceId?: string | null;
  disabled?: boolean;
  typingLabel?: string | null;
  onTyping?: () => void;
  conversationId?: string | null;
  /**
   * The space whose Drive a dropped file lands in — the channel's. Null (a DM,
   * which belongs to no space) takes no files.
   */
  filesSpaceId?: string | null;
  /**
   * 'full' (default) → the elevated card with the toolbar row (Messages/DMs).
   * 'slim' → a single-line feed-style bar (avatar · photo · text · send) for
   * the Channels page, matching the posts composer.
   */
  variant?: 'full' | 'slim';
  /** Shown as the slim composer's leading avatar. */
  currentUser?: { name: string; image: string | null };
  /** Overrides the textarea placeholder (e.g. "general…"). */
  placeholder?: string;
}

const draftKey = (id: string) => `nb-msg-draft:${id}`;

export default function MessageComposer({
  onSend,
  replyTo,
  onCancelReply,
  spaceId,
  disabled,
  typingLabel,
  onTyping,
  conversationId,
  filesSpaceId,
  variant = 'full',
  currentUser,
  placeholder,
}: MessageComposerProps) {
  // Channels use the slim, single-line feed composer; DMs keep the full card.
  const slim = variant === 'slim';
  const [text, setText] = useState('');
  const [files, setFiles] = useState<SerializedMessageFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const canAttach = !!filesSpaceId && !!conversationId;
  const [picking, setPicking] = useState(false);
  // Resources the space already holds, shared again here: a file rides the
  // message by id, a link goes into the text (and becomes its card).
  const addExisting = (picked: ResourceView[]) => {
    const fileShares = picked.filter((r) => r.source === 'upload');
    const links = picked.filter((r) => r.source === 'link' && r.url).map((r) => r.url!);
    if (fileShares.length) {
      setFiles((prev) =>
        [
          ...prev,
          ...fileShares
            .filter((r) => !prev.some((f) => f.id === r.id))
            .map((r) => ({ id: r.id, name: r.name, fileType: r.kind === 'image' ? 'image' : r.kind, kind: r.kind, fileSize: r.fileSize, url: r.rawUrl ?? '' })),
        ].slice(0, 10),
      );
    }
    if (links.length) setText((prev) => [prev.trim(), ...links].filter(Boolean).join(' '));
  };
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

  // A dropped file becomes a Drive file of the channel's space first, as Slack
  // uploads before it shares; the message then carries it by id.
  const uploadFiles = useCallback(async (picked: File[]) => {
    if (!picked.length || !filesSpaceId || !conversationId) return;
    setUploading(true);
    setUploadError(null);
    const added: SerializedMessageFile[] = [];
    const failed: string[] = [];
    for (const file of picked) {
      try {
        const data = await uploadResourceFile(file, { spaceId: filesSpaceId, conversationId });
        added.push({ id: data.id, name: data.name, fileType: data.fileType, kind: data.kind, fileSize: data.fileSize, url: resourceRawPath(data.id) });
      } catch {
        failed.push(file.name);
      }
    }
    setFiles((prev) => [...prev, ...added].slice(0, 10));
    if (failed.length) setUploadError(`Couldn't attach ${failed.join(', ')}`);
    setUploading(false);
  }, [filesSpaceId, conversationId]);

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
        if (spaceId) params.set('spaceId', spaceId);
        const data = await fetchJson<{ results?: MentionResult[] }>(`/api/messages/mentions?${params.toString()}`);
        setMentionSuggestions(data.results ?? []);
        setSelectedMentionIndex(0);
      } catch { /* ignore */ }
    },
    [spaceId],
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

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    await uploadFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canAttach) return;
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length) {
      e.preventDefault();
      await uploadFiles(pasted);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) await uploadFiles(dropped);
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || uploading) return;

    const mentions: Array<{ mentionedUserId?: string; mentionedNodeId?: string; mentionType: string }> = [];
    for (const userId of mentionedUsers) {
      mentions.push({ mentionedUserId: userId, mentionType: 'user' });
    }
    for (const nodeId of mentionedNodes) {
      mentions.push({ mentionedNodeId: nodeId, mentionType: 'event' });
    }

    onSend({
      text: trimmed,
      fileIds: files.length ? files.map((f) => f.id) : undefined,
      files: files.length ? files : undefined,
      mentions: mentions.length ? mentions : undefined,
      replyToId: replyTo?.id,
    });

    setText('');
    setFiles([]);
    setUploadError(null);
    setMentionedUsers([]);
    setMentionedNodes([]);
    if (conversationId) {
      try { localStorage.removeItem(draftKey(conversationId)); } catch { /* ignore */ }
    }
    onCancelReply?.();

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
      className={`relative w-full ${slim ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-2 md:px-6'} ${isDragging ? 'bg-accent/5' : ''}`}
      onDragOver={(e) => { if (!canAttach) return; e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-surface/80 text-sm font-medium text-accent">
          Drop to attach
        </div>
      )}
      {/* Slim (channel) composer spans the full Slack-style feed width. */}
      <div className={slim ? 'w-full' : 'contents'}>
      {typingLabel && (
        <p className="mb-1.5 px-1 text-xs text-fg-muted italic">{typingLabel}</p>
      )}

      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 border-l-4 border-line py-0.5 pl-3">
          <p className="min-w-0 flex-1 truncate text-[13px] text-fg-muted">
            Replying to <span className="font-bold text-fg-secondary">{replyTo.senderName}</span>
            {'  '}{replyTo.text}
          </p>
          <button type="button" onClick={onCancelReply} className="shrink-0 text-fg-muted hover:text-fg-secondary">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Attached files */}
      {(files.length > 0 || uploading) && (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {files.map((file) => (
            <div key={file.id} className="relative shrink-0">
              {file.fileType === 'image' ? (
                <img src={file.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="flex h-16 max-w-[200px] items-center gap-2 rounded-lg border border-line-subtle bg-surface px-3">
                  <FileTypeIcon type={file.fileType} kind={file.kind} size="sm" />
                  <span className="truncate text-sm text-fg">{file.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-fg/80 text-white"
                aria-label={`Remove ${file.name}`}
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
          {uploading && (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          )}
        </div>
      )}
      {uploadError && <p className="mb-1.5 px-1 text-xs text-danger">{uploadError}</p>}

      {/* Link input */}
      {showLinkInput && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-muted/60 px-3 py-2">
          <Link2Icon className="h-4 w-4 shrink-0 text-fg-muted" />
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="URL"
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none"
            autoFocus
          />
          <input
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            placeholder="Display text (optional)"
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={insertLink}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white"
          >
            Add
          </button>
          <button type="button" onClick={() => setShowLinkInput(false)} className="text-fg-muted">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative">
        {/* Mention suggestions dropdown */}
        {showMentions && mentionSuggestions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 w-72 rounded-lg border border-line-subtle bg-surface shadow-float z-50 overflow-hidden max-h-48 overflow-y-auto">
            {mentionSuggestions.map((result, i) => (
              <button
                key={result.id}
                type="button"
                onClick={() => insertMention(result)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                  i === selectedMentionIndex ? 'bg-surface-subtle' : 'hover:bg-surface-subtle'
                }`}
              >
                <Avatar name={result.name} imageUrl={result.imageUrl} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg truncate">{result.name}</p>
                  {result.subtitle && (
                    <p className="text-xs text-fg-muted truncate">{result.subtitle}</p>
                  )}
                </div>
                <span className={`ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white ${
                  result.type === 'event' ? 'bg-type-event-fg' : 'bg-type-person-fg'
                }`}>
                  {result.type === 'event' ? 'Event' : 'Person'}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Slim feed-style bar (Channels): avatar · photo · text · send */}
        {slim && (
          <div className="flex items-end gap-2 rounded-xl border border-line-subtle bg-surface px-3 py-2 transition-colors focus-within:border-line">
            {currentUser && (
              <div className="shrink-0 self-center">
                <Avatar name={currentUser.name} imageUrl={currentUser.image} size="sm" />
              </div>
            )}
            {canAttach && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFilePick}
                  className="hidden"
                />
                <div className="shrink-0 self-center">
                  <Menu
                    label="Attach"
                    align="start"
                    placement="above"
                    items={[
                      { id: 'upload', label: 'Upload file', icon: <UploadIcon />, onSelect: () => fileInputRef.current?.click() },
                      { id: 'existing', label: 'From Resources', icon: <FolderOpenIcon />, onSelect: () => setPicking(true) },
                    ]}
                    trigger={({ toggle }) => (
                      <button
                        type="button"
                        onClick={toggle}
                        disabled={uploading}
                        className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-subtle hover:text-accent"
                        aria-label="Attach"
                      >
                        {uploading
                          ? <span className="block h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                          : <PlusIcon className="h-5 w-5" />}
                      </button>
                    )}
                  />
                </div>
              </>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              placeholder={placeholder ?? 'Message…'}
              disabled={disabled}
              className="custom-scrollbar max-h-[140px] min-h-[28px] flex-1 resize-none self-center bg-transparent py-1 text-[15px] leading-relaxed text-fg outline-none placeholder:text-fg-muted disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || uploading || (!text.trim() && files.length === 0)}
              className="shrink-0 self-center rounded-full bg-accent p-2 text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
              aria-label="Send"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Full composer: one hairline field with the textarea + toolbar row below */}
        {!slim && (
        <div className="rounded-xl border border-line-subtle bg-surface transition-colors focus-within:border-line">
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
            className="max-h-36 min-h-[40px] w-full resize-none bg-transparent px-5 pt-3 pb-1 text-[15px] leading-snug text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-50"
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
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-surface-muted hover:text-fg-secondary'
                  }`}
                  title="Attach"
                >
                  <PlusIcon className="h-5 w-5" />
                </button>

                {/* Attachment popup menu */}
                {showAttachMenu && (
                  <div className="absolute bottom-full left-0 mb-1 w-44 rounded-lg border border-line-subtle bg-surface py-1 shadow-float z-50">
                    {canAttach && (
                      <button
                        type="button"
                        onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-fg hover:bg-surface-subtle transition-colors"
                      >
                        <ImagePlusIcon className="h-4 w-4 text-fg-muted" />
                        Upload file
                      </button>
                    )}
                    {canAttach && (
                      <button
                        type="button"
                        onClick={() => { setPicking(true); setShowAttachMenu(false); }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-fg hover:bg-surface-subtle transition-colors"
                      >
                        <FolderOpenIcon className="h-4 w-4 text-fg-muted" />
                        From Resources
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setShowLinkInput((v) => !v); setShowAttachMenu(false); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-fg hover:bg-surface-subtle transition-colors"
                    >
                      <Link2Icon className="h-4 w-4 text-fg-muted" />
                      Add link
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFilePick}
                className="hidden"
              />

              {/* Emoji */}
              <div className="relative" ref={emojiPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    showEmojiPicker
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-surface-muted hover:text-fg-secondary'
                  }`}
                  title="Emoji"
                >
                  <SmileIcon className="h-5 w-5" />
                </button>

                {showEmojiPicker && (
                  <div className="absolute bottom-full left-0 mb-2 z-50">
                    <Suspense fallback={<div className="h-[400px] w-[350px] rounded-lg bg-surface shadow-float" />}>
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
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg-secondary transition-colors"
                title="Mention someone"
              >
                <AtSignIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Send button — right side */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || uploading || (!text.trim() && files.length === 0)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-accent transition-colors hover:bg-accent/10 disabled:text-fg-muted disabled:hover:bg-transparent"
              title="Send"
            >
              <SendIcon className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
        )}
      </div>
      </div>
      {picking && filesSpaceId && (
        <ResourcePicker spaceId={filesSpaceId} open multiple onClose={() => setPicking(false)} onPick={addExisting} />
      )}
    </footer>
  );
}
