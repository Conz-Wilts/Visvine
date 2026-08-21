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
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';

interface UseMessageActionsArgs {
  selectedConversationRef: MutableRefObject<string | null>;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  messages: SerializedMessage[];
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
}

/**
 * Per-message actions (react, star, edit, delete, scroll-to). These are
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
      await fetchJsonBody(`/api/messages/conversations/${conversationId}/messages/${messageId}/reactions`, 'POST', { emoji });
    } catch { /* best-effort */ }
  }, [selectedConversationRef]);

  const handleToggleStar = useCallback(async (messageId: string) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    // Optimistic flip — stars are private, so no realtime echo will correct us.
    setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, starred: !m.starred } : m));
    try {
      const { starred } = await fetchJson<{ starred: boolean }>(
        `/api/messages/conversations/${conversationId}/messages/${messageId}/star`,
        { method: 'POST' },
      );
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, starred } : m));
    } catch {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, starred: !m.starred } : m));
    }
  }, [selectedConversationRef, setMessages]);

  const handleEdit = useCallback(async (messageId: string, text: string) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    try {
      const { message } = await fetchJsonBody<{ message: SerializedMessage }>(
        `/api/messages/conversations/${conversationId}/messages/${messageId}`, 'PATCH', { text });
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...message, isOwn: true } : m));
    } catch { /* best-effort */ }
  }, [selectedConversationRef, setMessages]);

  const handleDelete = useCallback(async (messageId: string) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId || !window.confirm('Delete this message?')) return;
    try {
      await fetchJson(`/api/messages/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
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

  return { handleReaction, handleToggleStar, handleEdit, handleDelete, handleScrollToMessage };
}
