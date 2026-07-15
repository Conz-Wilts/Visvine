'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { ConversationSummary } from '@/lib/messages/types';

interface UseConversationsArgs {
  /** Mirror of the selected conversation id owned by the orchestrator. */
  selectedConversationRef: MutableRefObject<string | null>;
  /** Called when a refetch shows the selected conversation is gone — resets selection. */
  onSelectionLost: () => void;
  setError: Dispatch<SetStateAction<string | null>>;
}

/**
 * Conversation-list state: the list itself, its loading flag, the sidebar
 * search input (debounced into a refetch), and a ref mirror of the list for
 * stable callbacks (the SSE handler) that need to read it without
 * resubscribing on every change.
 */
export function useConversations({ selectedConversationRef, onSelectionLost, setError }: UseConversationsArgs) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationSearch, setConversationSearch] = useState('');
  // Mirror of `conversations` so the SSE handler can check membership without
  // resubscribing on every list change.
  const conversationsRef = useRef<ConversationSummary[]>([]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  const fetchConversations = useCallback(async (query?: string, preserveSelection = true) => {
    try {
      const params = new URLSearchParams();
      if (query?.trim()) params.set('query', query.trim());
      const response = await fetch(`/api/messages/conversations?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to load conversations');
      const payload = await response.json();
      const nextConversations: ConversationSummary[] = payload.conversations ?? [];
      setConversations(nextConversations);
      const currentId = selectedConversationRef.current;
      if (preserveSelection && currentId && !nextConversations.some((c) => c.id === currentId)) {
        onSelectionLost();
      }
    } catch (fetchError) {
      setError((fetchError as Error).message || 'Failed to load conversations.');
    } finally {
      setConversationsLoading(false);
    }
  }, [onSelectionLost, selectedConversationRef, setError]);

  // Debounce the sidebar search into a list refetch.
  useEffect(() => {
    const t = setTimeout(() => void fetchConversations(conversationSearch), 200);
    return () => clearTimeout(t);
  }, [conversationSearch, fetchConversations]);

  return {
    conversations,
    setConversations,
    conversationsRef,
    conversationsLoading,
    conversationSearch,
    setConversationSearch,
    fetchConversations,
  };
}
