'use client';

import { uploadResourceFile } from '@/features/resources/lib/upload';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Chip, Modal } from '@visvine/ui';
import {
  AtSignIcon,
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  HashIcon,
  ImagePlusIcon,
  ItalicIcon,
  ListIcon,
  SmileIcon,
  UploadIcon,
  XIcon,
} from '@/features/shared/icons';
import { FileTypeIcon } from '@/features/resources/components/resourceUi';
import { fetchJson } from '@/lib/fetchJson';
import { badgeKey, type FeedBadge, type FeedPlace } from '@/lib/messages/shared/feed';
import { resourceRawPath } from '@/lib/resources/shared/fileNode';
import type { ComposerPayload, SerializedMessageFile } from '@/lib/messages/types';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

const DRAFT_KEY = 'vv-feed-draft';
const MAX_FILES = 10;

interface Mention { id: string; name: string; imageUrl?: string | null; subtitle?: string | null }

const tool = 'flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg disabled:opacity-40';

function readDraft(): { title: string; body: string } {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) as { title?: unknown; body?: unknown } : {};
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      body: typeof parsed.body === 'string' ? parsed.body : '',
    };
  } catch {
    return { title: '', body: '' };
  }
}

/** A post's text: the title, when there is one, is its heading. */
function postText(title: string, body: string): string {
  const heading = title.trim().replace(/\s+/g, ' ');
  const text = body.trim();
  if (!heading) return text;
  return text ? `# ${heading}\n\n${text}` : `# ${heading}`;
}

/**
 * The Feed's composer: a title, the post, what it carries, and where it
 * goes. The draft outlives closing the dialog; files are uploaded into the
 * chosen channel's Drive, so the channel is fixed once one is attached.
 */
export default function FeedComposer({
  targets,
  target,
  onTarget,
  user,
  badges,
  onPublish,
  onClose,
}: {
  targets: FeedPlace[];
  target: FeedPlace;
  onTarget: (conversationId: string) => void;
  user: { id: string; name: string; image: string | null };
  badges: Record<string, FeedBadge>;
  onPublish: (conversationId: string, payload: ComposerPayload) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<SerializedMessageFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [emoji, setEmoji] = useState(false);
  const [picking, setPicking] = useState(false);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionAt, setMentionAt] = useState(0);
  const [mentioned, setMentioned] = useState<Map<string, string>>(new Map());
  const [dragging, setDragging] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loaded = useRef(false);

  useEffect(() => {
    const draft = readDraft();
    setTitle(draft.title);
    setBody(draft.body);
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      try {
        if (title.trim() || body.trim()) window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body }));
        else window.localStorage.removeItem(DRAFT_KEY);
      } catch { /* private mode */ }
    }, 300);
    return () => clearTimeout(t);
  }, [title, body]);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  // Popovers close on a press outside them.
  useEffect(() => {
    if (!emoji && !picking) return;
    const handler = (e: MouseEvent) => {
      const inside = (ref: React.RefObject<HTMLDivElement | null>) => ref.current?.contains(e.target as Node);
      if (emoji && !inside(emojiRef)) setEmoji(false);
      if (picking && !inside(pickerRef)) setPicking(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emoji, picking]);

  const upload = useCallback(async (picked: File[]) => {
    if (!picked.length) return;
    setUploading(true);
    setProblem(null);
    const added: SerializedMessageFile[] = [];
    const failed: string[] = [];
    for (const file of picked.slice(0, MAX_FILES)) {
      try {
        const data = await uploadResourceFile(file, { spaceId: target.space.id, conversationId: target.conversationId });
        added.push({ id: data.id, name: data.name, fileType: data.fileType, kind: data.kind, fileSize: data.fileSize, url: resourceRawPath(data.id) });
      } catch {
        failed.push(file.name);
      }
    }
    setFiles((prev) => [...prev, ...added].slice(0, MAX_FILES));
    if (failed.length) setProblem(`Couldn't attach ${failed.join(', ')}`);
    setUploading(false);
  }, [target.space.id, target.conversationId]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    void upload(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  // ── The body's text ──

  /** Replace the selection (or insert at the caret) and put the caret after it. */
  const splice = (make: (selected: string) => string, caretFromEnd = 0) => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: from, selectionEnd: to } = el;
    const insert = make(body.slice(from, to));
    setBody(body.slice(0, from) + insert + body.slice(to));
    const caret = from + insert.length - caretFromEnd;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
  };

  const wrap = (mark: string) => {
    const el = bodyRef.current;
    const empty = !el || el.selectionStart === el.selectionEnd;
    splice((s) => `${mark}${s}${mark}`, empty ? mark.length : 0);
  };
  const bullet = () => splice((s) => (s ? s.split('\n').map((line) => `- ${line}`).join('\n') : '- '));

  const searchMentions = (query: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, type: 'user', spaceId: target.space.id });
        const data = await fetchJson<{ results?: Mention[] }>(`/api/messages/mentions?${params.toString()}`);
        setMentions(data.results ?? []);
        setMentionAt(0);
      } catch { /* the next keystroke asks again */ }
    }, 200);
  };

  const onBody = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);
    const match = value.slice(0, e.target.selectionStart).match(/(?:^|\s)@(\w*)$/);
    if (match) searchMentions(match[1]);
    else setMentions([]);
  };

  const insertMention = (person: Mention) => {
    const el = bodyRef.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = body.slice(0, caret).replace(/@(\w*)$/, `@${person.name} `);
    setBody(before + body.slice(caret));
    setMentioned((prev) => new Map(prev).set(person.id, person.name));
    setMentions([]);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };

  const text = postText(title, body);
  const ready = (text.length > 0 || files.length > 0) && !uploading && !publishing;

  const publish = async () => {
    if (!ready) return;
    setPublishing(true);
    setProblem(null);
    // A mention whose name was edited out of the text no longer mentions.
    const people = [...mentioned].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id);
    try {
      await onPublish(target.conversationId, {
        text,
        fileIds: files.length ? files.map((f) => f.id) : undefined,
        files: files.length ? files : undefined,
        mentions: people.length ? people.map((id) => ({ mentionedUserId: id, mentionType: 'user' })) : undefined,
      });
      try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
      onClose();
    } catch {
      setProblem("Couldn't publish");
      setPublishing(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionAt((i) => Math.min(i + 1, mentions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionAt((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentions[mentionAt]); return; }
      if (e.key === 'Escape') { e.stopPropagation(); setMentions([]); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void publish(); }
    if (e.key === 'b' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); wrap('**'); }
    if (e.key === 'i' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); wrap('_'); }
  };

  const badge = badges[badgeKey(target.space.id, user.id)];
  const spaces = [...new Map(targets.map((t) => [t.space.id, t.space])).values()];
  const locked = files.length > 0 || uploading;

  return (
    <Modal
      onClose={onClose}
      ariaLabel="Create post"
      maxWidth="max-w-2xl"
      closeOnBackdrop={!text && files.length === 0}
      panelClassName="relative flex max-h-[88vh] min-h-[min(34rem,88vh)] flex-col rounded-2xl bg-surface shadow-float"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line-subtle px-6 py-4">
        <h2 className="text-lg font-semibold text-fg">Create post</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg">
          <XIcon className="h-5 w-5" />
        </button>
      </header>

      <div
        className={`relative flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-4 pt-5 ${dragging ? 'bg-accent/5' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(Array.from(e.dataTransfer.files)); }}
      >
        <div className="flex items-center gap-3">
          <Avatar name={user.name} imageUrl={user.image} size="md" />
          <span className="truncate text-[15px] font-semibold text-fg">{user.name}</span>
          {badge && <Chip color={badge.color} size="sm" className="shrink-0">{badge.name}</Chip>}
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current?.focus(); } }}
          placeholder="Title"
          aria-label="Title"
          maxLength={200}
          className="mt-5 w-full bg-transparent text-[26px] font-bold leading-tight text-fg outline-none placeholder:text-fg-muted/70"
        />
        <textarea
          ref={bodyRef}
          value={body}
          onChange={onBody}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) { e.preventDefault(); void upload(pasted); }
          }}
          placeholder="Write something…"
          aria-label="Post"
          autoFocus
          rows={4}
          className="mt-3 w-full flex-1 resize-none bg-transparent text-[16px] leading-[1.7] text-fg outline-none placeholder:text-fg-muted"
        />

        {mentions.length > 0 && (
          <ul className="mt-1 w-72 overflow-hidden rounded-xl border border-line-subtle bg-surface py-1 shadow-float">
            {mentions.map((person, i) => (
              <li key={person.id}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertMention(person); }}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === mentionAt ? 'bg-surface-subtle' : 'hover:bg-surface-subtle'}`}
                >
                  <Avatar name={person.name} imageUrl={person.imageUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{person.name}</span>
                    {person.subtitle && <span className="block truncate text-xs text-fg-muted">{person.subtitle}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {(files.length > 0 || uploading) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {files.map((file) => (
              <div key={file.id} className="group relative">
                {file.fileType === 'image' ? (
                  <img src={file.url} alt="" className="h-24 w-24 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-24 w-48 items-center gap-2 rounded-xl border border-line-subtle px-3">
                    <FileTypeIcon type={file.fileType} />
                    <span className="line-clamp-2 text-sm text-fg">{file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                  aria-label={`Remove ${file.name}`}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-surface-muted">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            )}
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent text-sm font-medium text-accent">
            Drop to attach
          </div>
        )}
      </div>

      {problem && <p className="px-6 pb-2 text-xs text-danger">{problem}</p>}

      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-subtle px-4 py-3">
        <div className="flex items-center">
          <input ref={photoRef} type="file" accept="image/*" multiple onChange={pick} className="hidden" />
          <input ref={fileRef} type="file" multiple onChange={pick} className="hidden" />
          <button type="button" className={tool} title="Photo" onClick={() => photoRef.current?.click()} disabled={files.length >= MAX_FILES}>
            <ImagePlusIcon className="h-5 w-5" />
          </button>
          <button type="button" className={tool} title="File" onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_FILES}>
            <UploadIcon className="h-5 w-5" />
          </button>
          <div className="relative" ref={emojiRef}>
            <button type="button" className={tool} title="Emoji" aria-expanded={emoji} onClick={() => setEmoji((v) => !v)}>
              <SmileIcon className="h-5 w-5" />
            </button>
            {emoji && (
              <div className="absolute bottom-full left-0 z-50 mb-2">
                <Suspense fallback={<div className="h-[380px] w-[340px] rounded-xl bg-surface shadow-float" />}>
                  <EmojiPicker
                    onEmojiClick={(data) => { splice(() => data.emoji); setEmoji(false); }}
                    width={340}
                    height={380}
                    lazyLoadEmojis
                    searchPlaceholder="Search emoji…"
                    previewConfig={{ showPreview: false }}
                  />
                </Suspense>
              </div>
            )}
          </div>
          <button type="button" className={tool} title="Mention" onClick={() => { splice(() => '@'); searchMentions(''); }}>
            <AtSignIcon className="h-5 w-5" />
          </button>
          <span className="mx-1 h-5 w-px bg-line-subtle" aria-hidden />
          <button type="button" className={tool} title="Bold" onClick={() => wrap('**')}>
            <BoldIcon className="h-[18px] w-[18px]" />
          </button>
          <button type="button" className={tool} title="Italic" onClick={() => wrap('_')}>
            <ItalicIcon className="h-[18px] w-[18px]" />
          </button>
          <button type="button" className={tool} title="List" onClick={bullet}>
            <ListIcon className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-3">
          <div className="relative min-w-0" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              disabled={targets.length < 2 || locked}
              aria-haspopup="listbox"
              aria-expanded={picking}
              className="flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[14px] text-fg-secondary transition-colors enabled:hover:bg-surface-muted disabled:cursor-default"
            >
              <span className="truncate font-medium text-fg">{target.space.name}</span>
              <span className="text-fg-muted">·</span>
              <span className="truncate">{target.channel.name}</span>
              {targets.length > 1 && !locked && <ChevronDownIcon className="h-4 w-4 shrink-0 text-fg-muted" />}
            </button>
            {picking && (
              <div role="listbox" aria-label="Post in" className="absolute bottom-full right-0 z-50 mb-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-line-subtle bg-surface py-1.5 shadow-float">
                {spaces.map((space) => (
                  <div key={space.id} className="py-1">
                    <p className="truncate px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{space.name}</p>
                    {targets.filter((t) => t.space.id === space.id).map((t) => {
                      const on = t.conversationId === target.conversationId;
                      return (
                        <button
                          key={t.conversationId}
                          type="button"
                          role="option"
                          aria-selected={on}
                          onClick={() => { onTarget(t.conversationId); setPicking(false); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-subtle"
                        >
                          <HashIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                          <span className="min-w-0 flex-1 truncate">{t.channel.name}</span>
                          {on && <CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={!ready}
            className="shrink-0 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </footer>
    </Modal>
  );
}
