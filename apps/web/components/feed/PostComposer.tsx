'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { ImagePlus, X, AtSign, Link2, Send, Loader2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useCommunity } from '@/lib/contexts/CommunityContext';

interface MemberSuggestion {
  id: string;
  name: string;
  image?: string | null;
  person?: { subtitle?: string | null; imageUrl?: string | null } | null;
}

interface PostComposerProps {
  currentUser: { name: string; image?: string | null };
  onPostCreated: () => void;
}

export default function PostComposer({ currentUser, onPostCreated }: PostComposerProps) {
  const { currentCommunity } = useCommunity();
  const [content, setContent] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [, setMentionQuery] = useState('');
  const [mentionSuggestions, setMentionSuggestions] = useState<MemberSuggestion[]>([]);
  const [mentionedUsers, setMentionedUsers] = useState<string[]>([]);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [content]);

  // Search members for @mentions
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

    // Detect @mention trigger
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      setShowMentions(true);
      setMentionQuery(mentionMatch[1]);
      clearTimeout(mentionTimeoutRef.current);
      mentionTimeoutRef.current = setTimeout(() => {
        searchMembers(mentionMatch[1]);
      }, 200);
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (member: MemberSuggestion) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = content.slice(0, cursorPos);
    const textAfterCursor = content.slice(cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      const newText =
        textBeforeCursor.slice(0, mentionMatch.index) +
        `@${member.name} ` +
        textAfterCursor;
      setContent(newText);
      setMentionedUsers((prev) => [...new Set([...prev, member.id])]);
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
      const newContent = content.slice(0, cursorPos) + markdown + content.slice(cursorPos);
      setContent(newContent);
    } else {
      setContent((prev) => prev + markdown);
    }
    setLinkUrl('');
    setLinkText('');
    setShowLinkInput(false);
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
    if (!content.trim() || !currentCommunity || submitting) return;

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
        setContent('');
        setImageUrls([]);
        setMentionedUsers([]);
        setExpanded(false);
        onPostCreated();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-surface-1 rounded-2xl border border-border-subtle shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex gap-3">
          <Avatar name={currentUser.name} imageUrl={currentUser.image} size="lg" />
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onFocus={() => setExpanded(true)}
              placeholder="Share something with your community..."
              className="w-full resize-none bg-transparent text-text-primary placeholder:text-text-muted outline-none text-[15px] leading-relaxed min-h-[44px]"
              rows={expanded ? 3 : 1}
            />

            {/* @Mention suggestions dropdown */}
            {showMentions && mentionSuggestions.length > 0 && (
              <div className="absolute left-0 top-full mt-1 w-72 bg-surface-1 border border-border-subtle rounded-xl shadow-lg z-50 overflow-hidden">
                {mentionSuggestions.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => insertMention(member)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 transition-colors text-left"
                  >
                    <Avatar
                      name={member.name}
                      imageUrl={member.person?.imageUrl || member.image}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {member.name}
                      </p>
                      {member.person?.subtitle && (
                        <p className="text-xs text-text-muted truncate">
                          {member.person.subtitle}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Image previews */}
        {imageUrls.length > 0 && (
          <div className="mt-3 flex gap-2 flex-wrap">
            {imageUrls.map((url, i) => (
              <div key={i} className="relative group rounded-xl overflow-hidden">
                <img src={url} alt="" className="h-24 w-24 object-cover rounded-xl" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Link input */}
        {showLinkInput && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1 space-y-1.5">
              <input
                type="text"
                placeholder="Display text (optional)"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-surface-2 border border-border-subtle rounded-lg outline-none focus:border-brand-green text-text-primary placeholder:text-text-muted"
              />
              <input
                type="url"
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-surface-2 border border-border-subtle rounded-lg outline-none focus:border-brand-green text-text-primary placeholder:text-text-muted"
                onKeyDown={(e) => e.key === 'Enter' && insertLink()}
              />
            </div>
            <button
              onClick={insertLink}
              className="px-3 py-1.5 text-sm font-medium text-brand-green hover:bg-surface-2 rounded-lg transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => setShowLinkInput(false)}
              className="px-2 py-1.5 text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Action bar */}
      {expanded && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-brand-green hover:bg-surface-2 rounded-lg transition-colors"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              <span>Photo</span>
            </button>
            <button
              onClick={() => {
                const textarea = textareaRef.current;
                if (textarea) {
                  const cursorPos = textarea.selectionStart;
                  const newContent = content.slice(0, cursorPos) + '@' + content.slice(cursorPos);
                  setContent(newContent);
                  setShowMentions(true);
                  searchMembers('');
                  setTimeout(() => {
                    textarea.focus();
                    textarea.setSelectionRange(cursorPos + 1, cursorPos + 1);
                  }, 0);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-brand-green hover:bg-surface-2 rounded-lg transition-colors"
            >
              <AtSign className="h-4 w-4" />
              <span>Mention</span>
            </button>
            <button
              onClick={() => setShowLinkInput(!showLinkInput)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-brand-green hover:bg-surface-2 rounded-lg transition-colors"
            >
              <Link2 className="h-4 w-4" />
              <span>Link</span>
            </button>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
            className="flex items-center gap-2 px-5 py-2 bg-brand-green text-white rounded-full text-sm font-semibold hover:opacity-90 active:translate-y-[1px] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Post
          </button>
        </div>
      )}
    </div>
  );
}
