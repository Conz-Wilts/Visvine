'use client';

import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { ConversationSummary, RealtimeEvent, SerializedMessage } from '@/lib/messages/types';
import { patchReactions, withLinkCard } from '@/lib/messages/shared/feed';

interface UseMessagesRealtimeArgs {
  currentUserId: string;
  conversationSearch: string;
  fetchConversations: (query?: string, preserveSelection?: boolean) => Promise<void>;
  markConversationRead: (conversationId: string) => Promise<void>;
  /** Mirror of the selected conversation id — read inside SSE handlers without resubscribing. */
  selectedConversationRef: MutableRefObject<string | null>;
  /** Mirror of `conversations` so the SSE handler can check membership without resubscribing on every list change. */
  conversationsRef: MutableRefObject<ConversationSummary[]>;
  atBottomRef: MutableRefObject<boolean>;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
  setConversations: Dispatch<SetStateAction<ConversationSummary[]>>;
  setTypingUsers: Dispatch<SetStateAction<Record<string, string>>>;
  setNewMessagesPending: Dispatch<SetStateAction<number>>;
  setAnnounce: Dispatch<SetStateAction<string>>;
}

/**
 * Realtime SSE wiring for the messages experience: one EventSource per mount,
 * message/reaction/typing events patched into local state, and a
 * trailing-debounced full conversation-list refetch reserved for events the
 * sidebar can't patch from the payload (unknown conversation, renames).
 */
export function useMessagesRealtime({
  currentUserId,
  conversationSearch,
  fetchConversations,
  markConversationRead,
  selectedConversationRef,
  conversationsRef,
  atBottomRef,
  virtuosoRef,
  setMessages,
  setConversations,
  setTypingUsers,
  setNewMessagesPending,
  setAnnounce,
}: UseMessagesRealtimeArgs) {
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Trailing-debounced full conversation-list refetch for SSE events the list
  // can't patch locally (e.g. a brand-new conversation) — coalesces bursts so
  // a flood of events costs at most one refetch per second.
  const conversationsRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime SSE
  useEffect(() => {
    const typingTimers = typingTimersRef.current;
    const source = new EventSource('/api/messages/stream');
    // One trailing full refetch per ~1s window — reserved for events the
    // sidebar can't patch from the payload (unknown conversation, renames).
    const scheduleConversationsRefetch = () => {
      if (conversationsRefetchTimerRef.current) return;
      conversationsRefetchTimerRef.current = setTimeout(() => {
        conversationsRefetchTimerRef.current = null;
        void fetchConversations(conversationSearch);
      }, 1000);
    };
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent;
        if (payload.type === 'message.new') {
          const normalized: SerializedMessage = { ...payload.message, isOwn: payload.message.sender.id === currentUserId };
          const isActiveConversation = payload.conversationId === selectedConversationRef.current;
          if (isActiveConversation) {
            setMessages((prev) => prev.some((m) => m.id === normalized.id) ? prev : [...prev, normalized]);
            // Smart auto-scroll: only if user is near bottom, else show pill
            if (atBottomRef.current || normalized.isOwn) {
              requestAnimationFrame(() => {
                virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
              });
              if (!normalized.isOwn) void markConversationRead(payload.conversationId);
            } else {
              setNewMessagesPending((n) => n + 1);
              setAnnounce(`${normalized.sender.name}: ${normalized.text.slice(0, 80)}`);
            }
          }
          // Patch the sidebar entry in place from the event payload instead of
          // refetching the whole list (heavy include) on every message. The
          // server sets conversation.updatedAt to the message's createdAt and
          // orders by updatedAt desc, so mirroring that here keeps the local
          // ordering identical. Only an unknown conversation (e.g. a brand-new
          // DM) needs the debounced full refetch.
          if (conversationsRef.current.some((c) => c.id === payload.conversationId)) {
            setConversations((prev) => prev
              .map((c) => c.id === payload.conversationId
                ? {
                    ...c,
                    lastMessage: normalized,
                    updatedAt: normalized.createdAt,
                    unreadCount: !normalized.isOwn && !isActiveConversation ? c.unreadCount + 1 : c.unreadCount,
                  }
                : c)
              .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt))));
          } else {
            scheduleConversationsRefetch();
          }
        }
        if (payload.type === 'message.updated') {
          if (payload.conversationId === selectedConversationRef.current) {
            const updated = { ...payload.message, isOwn: payload.message.sender.id === currentUserId };
            // `starred` is per-user but the broadcast is serialized for the editor —
            // keep the local flag so someone else's edit doesn't clear your star.
            setMessages((prev) => prev.map((m) => m.id === updated.id ? { ...updated, starred: m.starred } : m));
          }
        }
        if (payload.type === 'resource.updated') {
          if (payload.conversationId === selectedConversationRef.current) {
            setMessages((prev) => {
              const next = prev.map((m) => withLinkCard(m, payload.card));
              return next.some((m, i) => m !== prev[i]) ? next : prev;
            });
          }
        }
        if (payload.type === 'message.deleted') {
          if (payload.conversationId === selectedConversationRef.current) {
            setMessages((prev) => prev.map((m) =>
              m.id === payload.messageId ? { ...m, deletedAt: new Date().toISOString(), text: '' } : m,
            ));
          }
        }
        if (payload.type === 'reaction.added' || payload.type === 'reaction.removed') {
          if (payload.conversationId === selectedConversationRef.current) {
            setMessages((prev) => prev.map((m) => m.id === payload.messageId
              ? { ...m, reactions: patchReactions(m.reactions, payload, currentUserId) }
              : m));
          }
        }
        // conversation.updated carries no data (rename, membership change) —
        // a refetch is required, but coalesced so bursts can't stampede.
        if (payload.type === 'conversation.updated') {
          // Our own read marker for the conversation on screen was patched
          // locally when it was sent; only another tab needs the list again.
          const ownRead = payload.readBy === currentUserId && payload.conversationId === selectedConversationRef.current;
          if (!ownRead) scheduleConversationsRefetch();
        }
        if (payload.type === 'typing') {
          if (payload.userId === currentUserId || payload.conversationId !== selectedConversationRef.current) return;
          if (!payload.isTyping) {
            setTypingUsers((prev) => { const next = { ...prev }; delete next[payload.userId]; return next; });
            const t = typingTimers.get(payload.userId);
            if (t) { clearTimeout(t); typingTimers.delete(payload.userId); }
            return;
          }
          setTypingUsers((prev) => ({ ...prev, [payload.userId]: payload.userName }));
          const existing = typingTimers.get(payload.userId);
          if (existing) clearTimeout(existing);
          typingTimers.set(payload.userId, setTimeout(() => {
            setTypingUsers((prev) => { const next = { ...prev }; delete next[payload.userId]; return next; });
            typingTimers.delete(payload.userId);
          }, 2500));
        }
      } catch { /* ignore malformed */ }
    };
    source.onerror = () => {};
    return () => {
      source.close();
      typingTimers.forEach(clearTimeout);
      typingTimers.clear();
      if (conversationsRefetchTimerRef.current) {
        clearTimeout(conversationsRefetchTimerRef.current);
        conversationsRefetchTimerRef.current = null;
      }
    };
    // Refs and setState functions are stable — only the four data deps matter,
    // exactly as when this effect lived inline in MessagesClient.
  }, [
    conversationSearch,
    currentUserId,
    fetchConversations,
    markConversationRead,
    selectedConversationRef,
    conversationsRef,
    atBottomRef,
    virtuosoRef,
    setMessages,
    setConversations,
    setTypingUsers,
    setNewMessagesPending,
    setAnnounce,
  ]);
}
