'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Hash, ArrowUpRight } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useClickOutside } from '@/hooks/useClickOutside';
import { fetchJson } from '@/lib/fetchJson';
import { formatChatTimestamp } from '@/lib/date';
import type { ConversationSummary } from '@/lib/messages/types';

/**
 * Header messages entry point (Circle-style): the navbar chat icon opens a
 * top-right popover previewing recent conversations instead of navigating
 * away. Clicking a row deep-links to /messages/[conversationId]; the header
 * expand icon and footer link open the full two-pane messages view.
 */
export default function MessagesDropdown() {
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const messagesActive = pathname.startsWith('/messages');

  useClickOutside(menuRef, () => setOpen(false));

  const refresh = useCallback(async () => {
    try {
      const payload = await fetchJson<{ conversations?: ConversationSummary[] }>(
        '/api/messages/conversations',
        { cache: 'no-store' },
      );
      setConversations(payload.conversations ?? []);
    } catch {
      // Badge/preview is best-effort; the full page surfaces errors properly.
      setConversations((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch powers the unread badge before the popover is ever opened.
  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  function toggle() {
    setOpen((v) => {
      if (!v) void refresh();
      return !v;
    });
  }

  function openConversation(id: string) {
    setOpen(false);
    router.push(`/messages/${id}`);
  }

  const totalUnread = (conversations ?? []).reduce((sum, c) => sum + c.unreadCount, 0);
  // Recent activity first; the API already sorts, but keep the preview stable if not.
  const preview = (conversations ?? []).slice(0, 8);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={toggle}
        aria-label="Messages"
        title="Messages"
        aria-haspopup="true"
        aria-expanded={open}
        className={`relative w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
          messagesActive || open
            ? 'text-brand-green hover:text-brand-dark-green'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
        }`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        {totalUnread > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 rounded-xl bg-surface-1 border border-border-subtle shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
            <p className="text-sm font-semibold text-text-primary">Messages</p>
            <Link
              href="/messages"
              onClick={() => setOpen(false)}
              aria-label="Open full messages view"
              title="Open full messages view"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
            >
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Conversation preview list */}
          <div className="max-h-[400px] overflow-y-auto py-1">
            {loading && conversations === null ? (
              <div className="px-4 py-3 space-y-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="h-9 w-9 rounded-xl bg-surface-3 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-1/3 rounded bg-surface-3" />
                      <div className="h-3 w-2/3 rounded bg-surface-3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : preview.length === 0 ? (
              <p className="px-4 py-8 text-sm text-text-muted text-center">No conversations yet</p>
            ) : (
              preview.map((c) => {
                const snippet = c.lastMessage
                  ? `${c.lastMessage.isOwn ? 'You: ' : c.type !== 'DM' ? `${c.lastMessage.sender.name}: ` : ''}${c.lastMessage.text || 'Sent an attachment'}`
                  : 'No messages yet';
                return (
                  <button
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className="w-full text-left px-4 py-2.5 hover:bg-surface-2 transition-colors flex items-center gap-3"
                  >
                    {c.type === 'CHANNEL' ? (
                      <span className="h-9 w-9 rounded-xl bg-surface-3 flex items-center justify-center shrink-0 text-text-muted">
                        {c.icon ? <span className="text-base leading-none">{c.icon}</span> : <Hash className="w-4 h-4" />}
                      </span>
                    ) : (
                      <Avatar name={c.name} imageUrl={c.avatarUrl} fallback={c.type === 'DM' ? 'silhouette' : 'initials'} />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`text-sm truncate ${c.unreadCount > 0 ? 'font-semibold text-text-primary' : 'font-medium text-text-primary'}`}>
                          {c.name}
                        </span>
                        <span className="text-[11px] text-text-muted shrink-0">
                          {formatChatTimestamp(c.lastMessage?.createdAt ?? c.updatedAt)}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={`text-xs truncate ${c.unreadCount > 0 ? 'text-text-primary font-medium' : 'text-text-muted'}`}>
                          {snippet}
                        </span>
                        {c.unreadCount > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-green text-white text-[10px] font-semibold flex items-center justify-center leading-none shrink-0">
                            {c.unreadCount > 9 ? '9+' : c.unreadCount}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <Link
            href="/messages"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-center text-sm font-medium text-brand-green hover:bg-surface-2 transition-colors border-t border-border-subtle"
          >
            See all messages
          </Link>
        </div>
      )}
    </div>
  );
}
