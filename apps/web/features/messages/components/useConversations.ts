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
import { fetchJson } from '@/lib/fetchJson';
import { inflightFetch } from '@/features/shared/lib/requestCache';

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
      const url = `/api/messages/conversations?${params.toString()}`;
      const payload = await inflightFetch(url, () => fetchJson<{ conversations?: ConversationSummary[] }>(url, { cache: 'no-store' }));
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

  // The first list read goes out at once; only a CHANGED search is debounced
  // into its refetch, so the sidebar never waits 200 ms behind mount, and a
  // re-run of the effect with the same query (dev double-mount, a rebuilt
  // callback) asks nothing again — the realtime stream keeps the list current.
  const lastQuery = useRef<string | null>(null);
  useEffect(() => {
    if (lastQuery.current === conversationSearch) return;
    if (lastQuery.current === null) {
      lastQuery.current = conversationSearch;
      void fetchConversations(conversationSearch);
      return;
    }
    const t = setTimeout(() => {
      lastQuery.current = conversationSearch;
      void fetchConversations(conversationSearch);
    }, 200);
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
