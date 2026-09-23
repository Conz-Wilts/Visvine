'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { inflightFetch, invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { usePageVisible } from '@/features/shared/hooks/usePageVisible';
import { applyFeedEvent, type FeedPage, type FeedPlace, type FeedPost } from '@/lib/messages/shared/feed';
import type { ComposerPayload, RealtimeEvent, SerializedMessage } from '@/lib/messages/types';
import { withoutDraftFiles } from '@/lib/messages/shared/composer';

const FIRST_PAGE_KEY = 'feed:first';

type SendPayload = ComposerPayload;

const messagesUrl = (conversationId: string) => `/api/messages/conversations/${conversationId}/messages`;

/** A fresh first page over what is already loaded: the page leads, and the
 *  older posts scrolled into view below it stay. */
function mergeFirstPage(page: FeedPost[], loaded: FeedPost[]): FeedPost[] {
  const last = page[page.length - 1];
  if (!last) return [];
  const fresh = new Set(page.map((post) => post.message.id));
  const older = loaded.filter((post) => !fresh.has(post.message.id) && post.message.createdAt < last.message.createdAt);
  return [...page, ...older];
}

/**
 * The feed's state: pages over `GET /api/feed`, patched live from the
 * messages stream, with every act sent to the post's own channel through the
 * routes the channel itself uses.
 */
export function useFeed(currentUserId: string) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [targets, setTargets] = useState<FeedPlace[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [failed, setFailed] = useState(false);

  const postsRef = useRef<FeedPost[]>([]);
  useEffect(() => { postsRef.current = posts; }, [posts]);
  const olderLoadedRef = useRef(false);

  const places = useMemo(() => new Map(targets.map((t) => [t.conversationId, t])), [targets]);
  const placesRef = useRef(places);
  useEffect(() => { placesRef.current = places; }, [places]);

  const loadFirst = useCallback((fresh: boolean) => {
    if (fresh) invalidateRequestCache(FIRST_PAGE_KEY);
    return swrFetch<FeedPage>(FIRST_PAGE_KEY, () => fetchJson<FeedPage>('/api/feed'), (page) => {
      setPosts((loaded) => mergeFirstPage(page.posts, loaded));
      setTargets(page.targets ?? []);
      // Older pages hold their own cursor; the first page's only stands
      // until one of them has been read.
      if (!olderLoadedRef.current) setNextCursor(page.nextCursor);
      setFailed(false);
    })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { void loadFirst(false); }, [loadFirst]);

  const loadOlder = useCallback(async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await inflightFetch(`feed:${nextCursor}`, () =>
        fetchJson<FeedPage>(`/api/feed?cursor=${encodeURIComponent(nextCursor)}`));
      olderLoadedRef.current = true;
      setPosts((loaded) => {
        const seen = new Set(loaded.map((post) => post.message.id));
        return [...loaded, ...page.posts.filter((post) => !seen.has(post.message.id))];
      });
      setNextCursor(page.nextCursor);
    } catch { /* the sentinel asks again */ } finally {
      setLoadingOlder(false);
    }
  }, [nextCursor, loadingOlder]);

  // ── Live ──
  // The stream fans out inside one server process, so an event published on
  // another instance never arrives. The first page is read again whenever the
  // stream reconnects and whenever the tab comes back.
  const visible = usePageVisible();
  const wasHiddenRef = useRef(false);
  useEffect(() => {
    if (!visible) { wasHiddenRef.current = true; return; }
    if (wasHiddenRef.current) { wasHiddenRef.current = false; void loadFirst(true); }
  }, [visible, loadFirst]);

  useEffect(() => {
    if (!visible) return;
    const source = new EventSource('/api/messages/stream');
    let opened = false;
    source.onopen = () => {
      if (opened) void loadFirst(true);
      opened = true;
    };
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent;
        setPosts((loaded) => applyFeedEvent(loaded, payload, placesRef.current, currentUserId));
      } catch { /* ignore malformed */ }
    };
    source.onerror = () => {};
    return () => source.close();
  }, [visible, currentUserId, loadFirst]);

  // ── Acts ──
  const conversationOf = useCallback((messageId: string): string | null => {
    const post = postsRef.current.find((p) => p.message.id === messageId || p.comments.some((c) => c.id === messageId));
    return post?.conversationId ?? null;
  }, []);

  const apply = useCallback((event: RealtimeEvent) => {
    setPosts((loaded) => applyFeedEvent(loaded, event, placesRef.current, currentUserId));
  }, [currentUserId]);

  const send = useCallback(async (conversationId: string, payload: SendPayload) => {
    const { message } = await fetchJsonBody<{ message: SerializedMessage }>(messagesUrl(conversationId), 'POST', withoutDraftFiles(payload));
    // The stream echoes it too; the reducer drops the duplicate.
    apply({ type: 'message.new', conversationId, message });
    invalidateRequestCache(FIRST_PAGE_KEY);
  }, [apply]);

  const comment = useCallback(async (postId: string, text: string) => {
    const conversationId = conversationOf(postId);
    if (conversationId) await send(conversationId, { text, replyToId: postId });
  }, [conversationOf, send]);

  const react = useCallback(async (messageId: string, emoji: string) => {
    const conversationId = conversationOf(messageId);
    if (!conversationId) return;
    try {
      await fetchJsonBody(`${messagesUrl(conversationId)}/${messageId}/reactions`, 'POST', { emoji });
    } catch { /* best-effort */ }
  }, [conversationOf]);

  const edit = useCallback(async (messageId: string, text: string) => {
    const conversationId = conversationOf(messageId);
    if (!conversationId) return;
    try {
      const { message } = await fetchJsonBody<{ message: SerializedMessage }>(`${messagesUrl(conversationId)}/${messageId}`, 'PATCH', { text });
      apply({ type: 'message.updated', conversationId, message });
      invalidateRequestCache(FIRST_PAGE_KEY);
    } catch { /* best-effort */ }
  }, [conversationOf, apply]);

  const remove = useCallback(async (messageId: string) => {
    const conversationId = conversationOf(messageId);
    if (!conversationId) return;
    await fetchJson(`${messagesUrl(conversationId)}/${messageId}`, { method: 'DELETE' });
    apply({ type: 'message.deleted', conversationId, messageId });
    invalidateRequestCache(FIRST_PAGE_KEY);
  }, [conversationOf, apply]);

  return {
    posts, targets, loading, failed, loadingOlder,
    hasMore: nextCursor !== null,
    loadOlder, send, comment, react, edit, remove,
  };
}
