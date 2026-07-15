'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { SerializedMessage } from '@/lib/messages/types';

interface UseMessageActionsArgs {
  selectedConversationRef: MutableRefObject<string | null>;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  messages: SerializedMessage[];
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
}

/**
 * Per-message actions (react, star, pin, edit, delete, scroll-to). These are
 * passed to every (memoized) MessageRow — keep them stable via useCallback +
 * refs or the memo never holds and each state change re-parses markdown for
 * all visible rows.
 */
export function useMessageActions({ selectedConversationRef, virtuosoRef, messages, setMessages }: UseMessageActionsArgs) {
  // Mirror of `messages` for stable callbacks that only need to read it.
  const messagesRef = useRef<SerializedMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    try {
      await fetch(`/api/messages/conversations/${conversationId}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
    } catch { /* best-effort */ }
  }, [selectedConversationRef]);

  const handleToggleStar = useCallback(async (messageId: string) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    // Optimistic flip — stars are private, so no realtime echo will correct us.
    setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, starred: !m.starred } : m));
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/messages/${messageId}/star`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error();
      const { starred } = await res.json();
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, starred } : m));
    } catch {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, starred: !m.starred } : m));
    }
  }, [selectedConversationRef, setMessages]);

  const handleTogglePin = useCallback(async (messageId: string) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/messages/${messageId}/pin`, {
        method: 'POST',
      });
      if (!res.ok) return;
      const { pinnedAt } = await res.json();
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, pinnedAt } : m));
    } catch { /* best-effort */ }
  }, [selectedConversationRef, setMessages]);

  const handleEdit = useCallback(async (messageId: string, text: string) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const { message } = await res.json();
        setMessages((prev) => prev.map((m) => m.id === messageId ? { ...message, isOwn: true } : m));
      }
    } catch { /* best-effort */ }
  }, [selectedConversationRef, setMessages]);

  const handleDelete = useCallback(async (messageId: string) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId || !window.confirm('Delete this message?')) return;
    try {
      await fetch(`/api/messages/conversations/${conversationId}/messages/${messageId}`, {
        method: 'DELETE',
      });
      setMessages((prev) => prev.map((m) =>
        m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), text: '' } : m,
      ));
    } catch { /* best-effort */ }
  }, [selectedConversationRef, setMessages]);

  const handleScrollToMessage = useCallback((messageId: string) => {
    const idx = messagesRef.current.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: idx, behavior: 'smooth', align: 'center' });
    }
  }, [virtuosoRef]);

  return { handleReaction, handleToggleStar, handleTogglePin, handleEdit, handleDelete, handleScrollToMessage };
}
