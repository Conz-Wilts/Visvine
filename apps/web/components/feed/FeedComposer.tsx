'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { ImagePlus, X, Send, Loader2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import type { FeedPostData } from '@/components/feed/FeedPost';

interface MemberSuggestion {
  id: string;
  name: string;
  image?: string | null;
  person?: { subtitle?: string | null; imageUrl?: string | null } | null;
}

interface FeedComposerProps {
  currentUser: { name: string; image?: string | null };
  /** Called with the freshly-created post so the feed can append it at the bottom. */
  onPostCreated: (post: FeedPostData) => void;
}

/**
 * Chat-style composer pinned to the bottom of the Slack-like feed channel.
 * A single auto-growing line: Enter sends, Shift+Enter inserts a newline.
 * Keeps @mention autocomplete and photo attachments; drops the rich
 * card toolbar that the old feed used.
 */
export default function FeedComposer({ currentUser, onPostCreated }: FeedComposerProps) {
  const { currentCommunity } = useCommunity();
  const [content, setContent] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<MemberSuggestion[]>([]);
  const [mentionedUsers, setMentionedUsers] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-grow the textarea up to a few lines, then scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [content]);

  const searchMembers = useCallback(
    async (query: string) => {
      if (!currentCommunity) return;
      try {
        const res = await fetch(
          `/api/feed/members?communityId=${currentCommunity.id}&q=${encodeURIComponent(query)}`
        );
        if (res.ok) {
          const data = await res.json();
          setMentionSuggestions(data.members);
        }
      } catch {
        // ignore
      }
    },
    [currentCommunity]
  );

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    const cursorPos = e.target.selectionStart;
    const mentionMatch = val.slice(0, cursorPos).match(/@(\w*)$/);
    if (mentionMatch) {
      setShowMentions(true);
      clearTimeout(mentionTimeoutRef.current);
      mentionTimeoutRef.current = setTimeout(() => searchMembers(mentionMatch[1]), 200);
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (member: MemberSuggestion) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const before = content.slice(0, cursorPos);
    const after = content.slice(cursorPos);
    const mentionMatch = before.match(/@(\w*)$/);
    if (mentionMatch) {
      setContent(before.slice(0, mentionMatch.index) + `@${member.name} ` + after);
      setMentionedUsers((prev) => [...new Set([...prev, member.id])]);
    }
    setShowMentions(false);
    textarea.focus();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'post');
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          newUrls.push(data.url);
        }
      } catch {
        // ignore failed uploads
      }
    }
    setImageUrls((prev) => [...prev, ...newUrls]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    setImageUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if ((!content.trim() && imageUrls.length === 0) || !currentCommunity || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communityId: currentCommunity.id,
          content: content.trim(),
          imageUrls: imageUrls.length ? imageUrls : undefined,
          mentions: mentionedUsers.length ? mentionedUsers : undefined,
        }),
      });
      if (res.ok) {
        const { post } = await res.json();
        setContent('');
        setImageUrls([]);
        setMentionedUsers([]);
        setShowMentions(false);
        onPostCreated(post);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative">
      {/* @Mention suggestions */}
      {showMentions && mentionSuggestions.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-lg">
          {mentionSuggestions.map((member) => (
            <button
              key={member.id}
              onClick={() => insertMention(member)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
            >
              <Avatar name={member.name} imageUrl={member.person?.imageUrl || member.image} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-primary">{member.name}</p>
                {member.person?.subtitle && (
                  <p className="truncate text-xs text-text-muted">{member.person.subtitle}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-2xl border border-border-default bg-surface-1 px-3 py-2 shadow-sm transition-colors focus-within:border-brand-green/40">
        {/* Image previews */}
        {imageUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {imageUrls.map((url, i) => (
              <div key={i} className="group relative overflow-hidden rounded-lg">
                <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Avatar name={currentUser.name} imageUrl={currentUser.image} size="sm" />
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
            className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-brand-green"
            aria-label="Attach photo"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          </button>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            placeholder="Post to the channel…"
            rows={1}
            className="custom-scrollbar max-h-[140px] min-h-[28px] flex-1 resize-none self-center bg-transparent py-1 text-[15px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={(!content.trim() && imageUrls.length === 0) || submitting}
            className="shrink-0 rounded-full bg-brand-green p-2 text-white shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
            aria-label="Send post"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
