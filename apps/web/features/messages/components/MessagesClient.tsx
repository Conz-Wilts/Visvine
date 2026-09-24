'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { useHeader } from '@/features/shared/contexts/HeaderContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useMessageHeights } from '@/features/messages/hooks/useMessageHeights';
import type {
  ComposerPayload,
  ChannelDirectoryEntry,
  ChannelSectionEntry,
  ChannelViewMode,
  ChannelVisibility,
  ConversationSummary,
  SavedMessageEntry,
  SerializedMessage,
  SerializedReplyTo,
} from '@/lib/messages/types';
import AddMembersModal from './AddMembersModal';
import { withoutDraftFiles } from '@/lib/messages/shared/composer';
import { mergeMessages } from './MessageRow';
import { inflightFetch } from '@/features/shared/lib/requestCache';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import ProfilePanel from './ProfilePanel';
import ConversationListPanel, { type ChannelListGroup } from './ConversationListPanel';
import ThreadPanel from './ThreadPanel';
import { useConversations } from './useConversations';
import { useMessagesRealtime } from './useMessagesRealtime';
import { useMessageActions } from './useMessageActions';
import { motion } from '@visvine/tokens';

interface MessagesClientProps {
  currentUser: {
    id: string;
    name: string;
    image: string | null;
  };
  initialConversationId?: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessagesClient({ currentUser, initialConversationId }: MessagesClientProps) {
  const { setHeaderContent } = useHeader();
  const spaceCtx = useSpace();
  // On wide viewports the Channels page docks its channel list INTO the global
  // Sidebar (the same portal host the /context notes tree uses), so the rail +
  // channel list read as one connected card instead of a separate floating box.
  const { host } = useContextPanel();

  // Under the space's prefix: the history writes below set the URL by hand.
  const basePath = spaceCtx.spaceHref('/channels');

  const [activeConversation, setActiveConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<SerializedMessage[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId ?? null);
  const [messageSearch, setMessageSearch] = useState('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [isMobile, setIsMobile] = useState(false);
  // ≥1024px: dock the conversation/channel list into the Sidebar (must match
  // DOCK_MIN_WIDTH in Sidebar.tsx). Below it, keep the page's own inline list
  // so a 300px panel doesn't crowd the thread.
  const [isWide, setIsWide] = useState(true);
  const [showAddMembersModal, setShowAddMembersModal] = useState(false);
  // Channels: the docked right-hand Details pane is toggleable (Slack-style) —
  // closed by default, opened via the channel header, remembered for the session.
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem('channels:detailsOpen');
    if (stored !== null) setDetailsOpen(stored === 'true');
  }, []);
  const toggleDetails = useCallback((next?: boolean) => {
    setDetailsOpen((prev) => {
      const value = next ?? !prev;
      try { window.sessionStorage.setItem('channels:detailsOpen', String(value)); } catch { /* private mode */ }
      return value;
    });
  }, []);
  const [channelDirectory, setChannelDirectory] = useState<ChannelDirectoryEntry[]>([]);
  const [channelSections, setChannelSections] = useState<ChannelSectionEntry[]>([]);
  // Collapsed rail sections, persisted per browser (keyed by section id, '__none__' = unfiled).
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null);
  // Channel-header extras: icon picker + saved-messages dropdown panel.
  const [showHeaderIconPicker, setShowHeaderIconPicker] = useState(false);
  const [headerPanel, setHeaderPanel] = useState<'saved' | null>(null);
  const [panelItems, setPanelItems] = useState<SavedMessageEntry[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<SerializedReplyTo | null>(null);
  const [unreadMarker, setUnreadMarker] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [newMessagesPending, setNewMessagesPending] = useState(0);
  const [announce, setAnnounce] = useState('');

  const sidebarSearchRef = useRef<HTMLInputElement>(null);
  const selectedConversationRef = useRef<string | null>(selectedConversationId);
  const stopTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasTypingSignalRef = useRef(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Per-conversation message cache: revisiting a chat renders instantly from
  // here while a silent refresh runs in the background (no skeleton flash).
  const messageCacheRef = useRef(new Map<string, {
    messages: SerializedMessage[];
    cursor: string | null;
    hasMore: boolean;
  }>());
  // Which conversation the current `messages` state belongs to — guards the
  // cache against being written with another conversation's rows mid-switch.
  const messagesConvoRef = useRef<string | null>(null);
  const lastAppliedSearchRef = useRef('');
  // Whether the current `messages` state came from a search-filtered fetch.
  // State alone can't tell: after clearing the search box the filtered rows
  // linger until the debounced unfiltered reload lands, and caching them as
  // the conversation's history would truncate the thread on the next visit.
  const messagesFilteredRef = useRef(false);

  // Virtuoso: first item index for prepending older messages without scroll jump
  const INITIAL_FIRST_INDEX = 100000;
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_INDEX);

  // Pretext-powered height calculation for virtualized message list
  const { getItemHeight } = useMessageHeights(messages, messagesContainerRef, isMobile);

  // A conversation-list refetch showed the selected conversation is gone —
  // clear the selection and return to the bare list URL.
  const handleSelectionLost = useCallback(() => {
    setSelectedConversationId(null);
    selectedConversationRef.current = null;
    setActiveConversation(null);
    setMessages([]);
    window.history.replaceState(null, '', basePath);
  }, [basePath]);

  const {
    conversations,
    setConversations,
    conversationsRef,
    conversationsLoading,
    conversationSearch,
    setConversationSearch,
    fetchConversations,
  } = useConversations({ selectedConversationRef, onSelectionLost: handleSelectionLost, setError });

  const selectedConversation = useMemo(() => {
    if (!selectedConversationId) return null;
    return activeConversation ?? conversations.find((c) => c.id === selectedConversationId) ?? null;
  }, [activeConversation, conversations, selectedConversationId]);

  const typingLabel = useMemo(() => {
    const names = Object.values(typingUsers);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} is typing…`;
    return `${names.length} people are typing…`;
  }, [typingUsers]);

  const sendTypingState = useCallback(async (conversationId: string, isTyping: boolean) => {
    try {
      await fetchJsonBody(`/api/messages/conversations/${conversationId}/typing`, 'POST', { isTyping });
      hasTypingSignalRef.current = isTyping;
    } catch { /* best-effort */ }
  }, []);

  const clearTypingSignal = useCallback((conversationId: string | null) => {
    if (hasTypingSignalRef.current && conversationId) {
      void sendTypingState(conversationId, false);
    }
    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current);
      stopTypingTimeoutRef.current = null;
    }
  }, [sendTypingState]);

  const markConversationRead = useCallback(async (conversationId: string) => {
    // The sidebar's count is patched here rather than refetched: the read
    // route answers only this user, and the list already knows the rest.
    setConversations((prev) => prev.some((c) => c.id === conversationId && c.unreadCount > 0)
      ? prev.map((c) => c.id === conversationId ? { ...c, unreadCount: 0 } : c)
      : prev);
    try {
      await fetchJsonBody(`/api/messages/conversations/${conversationId}/read`, 'POST', {});
    } catch { /* best-effort */ }
  }, [setConversations]);

  const spaceId = spaceCtx?.currentSpace?.id;

  const fetchChannels = useCallback(async () => {
    if (!spaceId) return;
    try {
      const url = `/api/messages/channels?spaceId=${encodeURIComponent(spaceId)}`;
      const payload = await inflightFetch(url, () => fetchJson<{ channels?: ChannelDirectoryEntry[]; sections?: ChannelSectionEntry[] }>(url, { cache: 'no-store' }));
      setChannelDirectory(payload.channels ?? []);
      setChannelSections(payload.sections ?? []);
    } catch { /* best-effort */ }
  }, [spaceId]);

  // Collapsed rail sections survive reloads (client-only read to avoid SSR mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('visvine.channels.collapsed');
      if (raw) setCollapsedSections(JSON.parse(raw));
    } catch { /* best-effort */ }
  }, []);

  const toggleSectionCollapsed = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('visvine.channels.collapsed', JSON.stringify(next)); } catch { /* best-effort */ }
      return next;
    });
  }, []);

  const loadMessages = useCallback(async (
    conversationId: string,
    options?: { cursor?: string | null; prepend?: boolean; query?: string; silent?: boolean },
  ) => {
    const isPrepend = Boolean(options?.prepend);
    try {
      setError(null);
      if (isPrepend) setLoadingOlderMessages(true);
      else if (!options?.silent) setMessagesLoading(true);
      const params = new URLSearchParams();
      params.set('limit', '30');
      if (options?.cursor) params.set('cursor', options.cursor);
      if (options?.query?.trim()) params.set('query', options.query.trim());
      const payload = await fetchJson<{ messages?: SerializedMessage[]; conversation?: ConversationSummary | null; nextCursor?: string | null; hasMore?: boolean }>(
        `/api/messages/conversations/${conversationId}/messages?${params.toString()}`, { cache: 'no-store' });
      // The user switched conversations while this request was in flight —
      // applying it now would flash another thread's messages.
      if (selectedConversationRef.current !== conversationId) return;
      const nextMessages: SerializedMessage[] = (payload.messages ?? []).map((m: SerializedMessage) => ({
        ...m,
        isOwn: m.sender.id === currentUser.id,
      }));
      let keepCursor = false;
      if (isPrepend) {
        setMessages((prev) => {
          const merged = mergeMessages([...nextMessages, ...prev]);
          return merged;
        });
        // Adjust firstItemIndex to prevent scroll jump
        setFirstItemIndex((prev) => prev - nextMessages.length);
      } else {
        const isFilteredFetch = Boolean(options?.query?.trim());
        if (options?.silent && !isFilteredFetch && !messagesFilteredRef.current) {
          // Background refresh of an already-rendered thread: merge the newest
          // page into what's shown so older pages loaded via "Load earlier"
          // survive (replacing would truncate the thread and jump the scroll).
          const shownCount = messageCacheRef.current.get(conversationId)?.messages.length ?? 0;
          keepCursor = shownCount > nextMessages.length;
          setMessages((prev) => (prev.length > 0 ? mergeMessages([...prev, ...nextMessages]) : nextMessages));
        } else {
          // Replacing the list (initial load, applying or clearing a search) —
          // re-anchor virtuoso to match.
          setMessages(nextMessages);
          setFirstItemIndex(INITIAL_FIRST_INDEX);
        }
        messagesFilteredRef.current = isFilteredFetch;
        messagesConvoRef.current = conversationId;
      }
      setActiveConversation(payload.conversation ?? null);
      if (!keepCursor) {
        setMessageCursor(payload.nextCursor ?? null);
        setHasMoreMessages(Boolean(payload.hasMore));
      }
    } catch (loadError) {
      if (selectedConversationRef.current === conversationId) {
        setError((loadError as Error).message || 'Failed to load messages.');
      }
    } finally {
      if (selectedConversationRef.current === conversationId) {
        setMessagesLoading(false);
        setLoadingOlderMessages(false);
      }
    }
  }, [currentUser.id]);

  // Header: inject nothing for the channels page — the page is self-contained
  useEffect(() => {
    setHeaderContent(null);
    return () => setHeaderContent(null);
  }, [setHeaderContent]);

  useEffect(() => { selectedConversationRef.current = selectedConversationId; }, [selectedConversationId]);
  useEffect(() => { setSelectedConversationId(initialConversationId ?? null); }, [initialConversationId]);

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    const update = () => {
      setIsMobile(window.innerWidth < 768);
      setIsWide(window.innerWidth >= 1024);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        sidebarSearchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Layout effect so the cached messages / loading skeleton are applied
  // before the browser paints — otherwise the previous thread's messages
  // flash for one frame under the new conversation's header.
  useLayoutEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setMessageCursor(null);
      setHasMoreMessages(false);
      setMessageSearch('');
      setTypingUsers({});
      setReplyTo(null);
      messagesConvoRef.current = null;
      return;
    }
    // Search is per-conversation — reset it on switch.
    setMessageSearch('');
    setShowMessageSearch(false);
    setHeaderPanel(null);
    setShowHeaderIconPicker(false);
    lastAppliedSearchRef.current = '';
    messagesFilteredRef.current = false;
    setTypingUsers({});
    // Serve cached messages instantly and refresh silently in the background;
    // the skeleton only shows for conversations we've never opened.
    const cached = messageCacheRef.current.get(selectedConversationId);
    if (cached) {
      messagesConvoRef.current = selectedConversationId;
      setMessages(cached.messages);
      setMessageCursor(cached.cursor);
      setHasMoreMessages(cached.hasMore);
      setFirstItemIndex(INITIAL_FIRST_INDEX);
    }
    void loadMessages(selectedConversationId, { silent: Boolean(cached) });
    void markConversationRead(selectedConversationId);
  }, [selectedConversationId, loadMessages, markConversationRead]);

  // Keep the cache in sync with whatever the open thread currently shows.
  useEffect(() => {
    const convoId = selectedConversationRef.current;
    if (!convoId || messagesConvoRef.current !== convoId || messages.length === 0) return;
    // Never cache a filtered view — checking the ref as well as the input
    // covers the window after the search box is cleared but before the
    // unfiltered reload lands (the rows shown are still the filtered subset).
    if (messageSearch.trim() || messagesFilteredRef.current) return;
    messageCacheRef.current.set(convoId, {
      messages,
      cursor: messageCursor,
      hasMore: hasMoreMessages,
    });
  }, [messages, messageCursor, hasMoreMessages, messageSearch]);

  // Set unread divider anchor on first message load for a conversation
  useEffect(() => {
    if (!selectedConversationId || messages.length === 0) return;
    setUnreadMarker((prev) => {
      if (prev !== null) return prev; // already set for this convo
      const conv = conversations.find((c) => c.id === selectedConversationId);
      const unread = conv?.unreadCount ?? 0;
      if (unread > 0 && messages.length >= unread) {
        return messages[messages.length - unread].id;
      }
      return null;
    });
  }, [selectedConversationId, messages, conversations]);

  useEffect(() => { setUnreadMarker(null); }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) return;
    // Only refetch when the search term actually changed: the conversation
    // switch itself already loads messages.
    if (messageSearch === lastAppliedSearchRef.current) return;
    const t = setTimeout(() => {
      lastAppliedSearchRef.current = messageSearch;
      void loadMessages(selectedConversationId, { query: messageSearch, silent: true });
    }, 250);
    return () => clearTimeout(t);
  }, [messageSearch, selectedConversationId, loadMessages]);

  // Realtime SSE: message/reaction/typing events patched into local state,
  // with a debounced full refetch reserved for unpatchable events.
  useMessagesRealtime({
    currentUserId: currentUser.id,
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
  });

  // Typing composer side-effect
  const handleComposerTyping = useCallback(() => {
    if (!selectedConversationId) return;
    if (!hasTypingSignalRef.current) void sendTypingState(selectedConversationId, true);
    if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    stopTypingTimeoutRef.current = setTimeout(() => void sendTypingState(selectedConversationId, false), 1400);
  }, [selectedConversationId, sendTypingState]);

  // ─── Action handlers ────────────────────────────────────────────────────────

  const handleSelectConversation = (id: string) => {
    if (id === selectedConversationRef.current) return;
    clearTypingSignal(selectedConversationRef.current);
    setSelectedConversationId(id);
    selectedConversationRef.current = id;
    setActiveConversation(conversations.find((c) => c.id === id) ?? null);
    setReplyTo(null);
    // Shallow URL update — a router.push here remounts the whole page
    // (different route segment + force-dynamic), which is what caused the
    // flash on every chat click. pushState keeps the component alive and
    // Next syncs usePathname automatically.
    window.history.pushState(null, '', `${basePath}/${id}`);
  };

  const handleBackToList = () => {
    clearTypingSignal(selectedConversationRef.current);
    setSelectedConversationId(null);
    selectedConversationRef.current = null;
    setMessages([]);
    setActiveConversation(null);
    setTypingUsers({});
    setReplyTo(null);
    window.history.pushState(null, '', basePath);
  };

  const handleJoinChannel = async (channelId: string) => {
    try {
      setJoiningChannelId(channelId);
      await fetchJson(`/api/messages/conversations/${channelId}/join`, { method: 'POST' });
      await fetchConversations(conversationSearch);
      await fetchChannels();
      handleSelectConversation(channelId);
    } catch (e) {
      setError((e as Error).message || 'Unable to join the channel.');
    } finally {
      setJoiningChannelId(null);
    }
  };

  const handleRenameSection = useCallback(async (sectionId: string, name: string) => {
    try {
      // Renaming touches only the name; the icon is set from its own picker
      // and must survive a rename.
      await fetchJsonBody(`/api/messages/sections/${sectionId}`, 'PATCH', { name });
      await fetchChannels();
    } catch (e) {
      setError((e as Error).message || 'Unable to rename the section.');
      throw e;
    }
  }, [fetchChannels]);

  const handleDeleteSection = useCallback(async (sectionId: string) => {
    if (!window.confirm('Delete this section? Its channels will move to the Channels list.')) return;
    try {
      await fetchJson(`/api/messages/sections/${sectionId}`, { method: 'DELETE' });
      // Deleting a section unfiles its channels (sectionId → null), so refresh both lists.
      await fetchChannels();
      await fetchConversations(conversationSearch);
    } catch (e) {
      setError((e as Error).message || 'Unable to delete the section.');
    }
  }, [fetchChannels, fetchConversations, conversationSearch]);

  /** PATCH the open channel (icon / section / view style) and refresh everything that shows it. */
  const updateSelectedChannel = useCallback(async (patch: { icon?: string | null; sectionId?: string | null; viewMode?: ChannelViewMode; visibility?: ChannelVisibility }) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    try {
      const payload = await fetchJsonBody<{ conversation: ConversationSummary }>(`/api/messages/conversations/${conversationId}`, 'PATCH', patch);
      setActiveConversation(payload.conversation);
      await fetchConversations(conversationSearch);
      await fetchChannels();
    } catch (e) {
      setError((e as Error).message || 'Unable to update the channel.');
    }
  }, [conversationSearch, fetchChannels, fetchConversations]);

  const openHeaderPanel = useCallback(async (panel: 'saved') => {
    if (headerPanel === panel) {
      setHeaderPanel(null);
      return;
    }
    setHeaderPanel(panel);
    setPanelItems([]);
    setPanelLoading(true);
    try {
      const payload = await fetchJson<{ messages?: SavedMessageEntry[] }>('/api/messages/starred', { cache: 'no-store' });
      setPanelItems(payload.messages ?? []);
    } catch {
      setPanelItems([]);
    } finally {
      setPanelLoading(false);
    }
  }, [headerPanel]);

  const handlePanelItemClick = (item: SavedMessageEntry) => {
    setHeaderPanel(null);
    if (item.conversationId === selectedConversationRef.current) {
      handleScrollToMessage(item.id);
    } else {
      handleSelectConversation(item.conversationId);
    }
  };

  const handleLoadOlder = useCallback(async () => {
    if (!selectedConversationId || !hasMoreMessages || !messageCursor || loadingOlderMessages) return;
    await loadMessages(selectedConversationId, { cursor: messageCursor, prepend: true, query: messageSearch });
  }, [selectedConversationId, hasMoreMessages, messageCursor, loadingOlderMessages, loadMessages, messageSearch]);

  const handleSendMessage = async (payload: ComposerPayload) => {
    if (!selectedConversationId) return;
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: SerializedMessage = {
      id: tempId,
      text: payload.text,
      attachmentUrl: null,
      createdAt: new Date().toISOString(),
      sender: { id: currentUser.id, name: currentUser.name, image: currentUser.image },
      isOwn: true,
      readByCount: 0,
      recipientCount: Math.max((selectedConversation?.participants.length ?? 1) - 1, 0),
      isFullyReadByRecipients: false,
      images: payload.imageUrls?.map((url, i) => ({ id: `temp-img-${i}`, imageUrl: url, position: i })),
      files: payload.files,
      reactions: [],
      replyTo: replyTo,
    };
    setMessages((prev) => [...prev, optimistic]);
    setReplyTo(null);
    clearTypingSignal(selectedConversationId);

    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
    });

    try {
      const respPayload = await fetchJsonBody<{ message: SerializedMessage }>(`/api/messages/conversations/${selectedConversationId}/messages`, 'POST', withoutDraftFiles(payload));
      const sent: SerializedMessage = { ...respPayload.message, isOwn: respPayload.message.sender.id === currentUser.id };
      // The SSE stream may have already delivered this message — drop the
      // optimistic copy instead of replacing it, or the id appears twice.
      setMessages((prev) => prev.some((m) => m.id === sent.id)
        ? prev.filter((m) => m.id !== tempId)
        : prev.map((m) => m.id === tempId ? sent : m));
      await fetchConversations(conversationSearch);
    } catch (sendError) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setError((sendError as Error).message || 'Unable to send message.');
    }
  };

  // Per-message actions passed to every (memoized) MessageRow — stable
  // callbacks so the memo holds (see useMessageActions).
  const {
    handleReaction,
    handleToggleStar,
    handleEdit,
    handleDelete,
    handleScrollToMessage,
  } = useMessageActions({ selectedConversationRef, virtuosoRef, messages, setMessages });

  // `?message=<id>` (the viewer's "View in channel") lands on that message
  // once it is loaded, then leaves the URL as it was.
  useEffect(() => {
    const url = new URL(window.location.href);
    const target = url.searchParams.get('message');
    if (!target || !messages.some((m) => m.id === target)) return;
    handleScrollToMessage(target);
    url.searchParams.delete('message');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [messages, handleScrollToMessage]);

  const handleLeaveChannel = async () => {
    if (!selectedConversationId) return;
    if (!window.confirm('Leave this channel?')) return;
    try {
      await fetchJson(`/api/messages/conversations/${selectedConversationId}/leave`, { method: 'POST' });
      handleBackToList();
      await fetchConversations(conversationSearch, false);
    } catch (e) { setError((e as Error).message || 'Unable to leave the channel.'); }
  };

  const handleRenameChannel = async () => {
    if (!selectedConversationId || !selectedConversation) return;
    const nextName = window.prompt('Enter a new channel name', selectedConversation.name);
    if (!nextName?.trim()) return;
    try {
      const payload = await fetchJsonBody<{ conversation: ConversationSummary }>(`/api/messages/conversations/${selectedConversationId}`, 'PATCH', { name: nextName.trim() });
      await fetchConversations(conversationSearch);
      setActiveConversation(payload.conversation);
    } catch (e) { setError((e as Error).message || 'Unable to rename the channel.'); }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!selectedConversationId || !selectedConversation) return;
    const target = selectedConversation.participants.find((p) => p.id === memberUserId);
    if (!target || !window.confirm(`Remove ${target.name} from the channel?`)) return;
    try {
      await fetchJson(`/api/messages/conversations/${selectedConversationId}/members/${memberUserId}`, { method: 'DELETE' });
      await fetchConversations(conversationSearch);
      await loadMessages(selectedConversationId, { query: messageSearch });
    } catch (e) { setError((e as Error).message || 'Unable to remove member.'); }
  };

  // ─── Derived data ───────────────────────────────────────────────────────────

  const filteredConversations = useMemo(
    () => conversations.filter((c) => c.type === 'CHANNEL'),
    [conversations],
  );

  // Channels in the space directory the user hasn't joined yet.
  const browsableChannels = useMemo(() => {
    const joined = new Set(conversations.map((c) => c.id));
    const q = conversationSearch.trim().toLowerCase();
    return channelDirectory
      .filter((ch) => !ch.isMember && !joined.has(ch.id))
      .filter((ch) => !q || ch.name.toLowerCase().includes(q) || (ch.description?.toLowerCase().includes(q) ?? false));
  }, [channelDirectory, conversations, conversationSearch]);

  // Circle-style rail sections: one per section (joined + browsable channels filed
  // there, empty sections still shown so they can be filled/renamed/deleted), then
  // an unfiled bucket.
  const channelGroups = useMemo(() => {
    const joined = filteredConversations.filter((c) => c.type === 'CHANNEL');
    const sectionIds = new Set(channelSections.map((s) => s.id));
    const sections: ChannelListGroup[] = [];
    for (const section of channelSections) {
      const joinedHere = joined.filter((c) => c.sectionId === section.id);
      const browsableHere = browsableChannels.filter((ch) => ch.sectionId === section.id);
      // While searching, hide sections with no matches so results stay scannable.
      if (joinedHere.length || browsableHere.length || !conversationSearch.trim()) {
        sections.push({ key: section.id, name: section.name, icon: section.icon, joined: joinedHere, browsable: browsableHere });
      }
    }
    const joinedUnfiled = joined.filter((c) => !c.sectionId || !sectionIds.has(c.sectionId));
    const browsableUnfiled = browsableChannels.filter((ch) => !ch.sectionId || !sectionIds.has(ch.sectionId));
    if (joinedUnfiled.length || browsableUnfiled.length) {
      sections.push({ key: '__none__', name: 'Channels', icon: null, joined: joinedUnfiled, browsable: browsableUnfiled });
    }
    return sections;
  }, [filteredConversations, browsableChannels, channelSections, conversationSearch]);

  // Slack-style default: on desktop /channels, land in the first joined channel
  // instead of an empty "No channel selected" pane. replaceState (not push) so
  // Back doesn't step through the auto-selection. Skipped on mobile, where
  // selecting would immediately hide the channel list.
  useEffect(() => {
    if (isMobile || conversationsLoading) return;
    if (selectedConversationRef.current) return;
    const first = channelGroups.find((s) => s.joined.length > 0)?.joined[0];
    if (!first) return;
    setSelectedConversationId(first.id);
    selectedConversationRef.current = first.id;
    setActiveConversation(first);
    window.history.replaceState(null, '', `${basePath}/${first.id}`);
  }, [isMobile, conversationsLoading, channelGroups, basePath]);

  const isAdmin = selectedConversation?.currentUserRole === 'ADMIN';

  // Feed-style channels have no bottom scroll anchor (newest renders at the
  // top), so treat the viewer as permanently "at bottom": incoming realtime
  // messages patch straight into the feed and reads keep being marked instead
  // of accumulating in the new-messages pill (which only exists in chat mode).
  const feedActive = selectedConversation?.type === 'CHANNEL' && selectedConversation.viewMode === 'FEED';
  useEffect(() => {
    if (feedActive) {
      atBottomRef.current = true;
      setNewMessagesPending(0);
    }
  }, [feedActive]);
  // Whether the centre column has an open thread. Desktop always shows the centre
  // beside the rail; mobile shows it only once the user opens a channel/chat.
  const hasOpenThread = Boolean(selectedConversationId);
  const showInbox = !isMobile || !hasOpenThread;
  const showThread = !isMobile || hasOpenThread;
  const showProfile = !isMobile && Boolean(selectedConversation) && detailsOpen;
  // On mobile, give the open thread the full viewport — hide the centered controls.

  // Whether to dock the channel rail into the Sidebar (wide viewport, host
  // mounted). When docked we hide the page's title/search chrome (it moves into
  // the docked panel) and pad the thread to clear the docked card.
  const docked = isWide && Boolean(host);

  // The inbox / channel list. When docked it portals into the Sidebar host;
  // un-docked it renders inline beside the thread.
  const listPanel = (
    <ConversationListPanel
      docked={docked}
      host={host}
      sidebarSearchRef={sidebarSearchRef}
      conversationSearch={conversationSearch}
      setConversationSearch={setConversationSearch}
      conversationsLoading={conversationsLoading}
      channelGroups={channelGroups}
      channelSections={channelSections}
      collapsedSections={collapsedSections}
      toggleSectionCollapsed={toggleSectionCollapsed}
      selectedConversationId={selectedConversationId}
      onSelectConversation={handleSelectConversation}
      onJoinChannel={handleJoinChannel}
      joiningChannelId={joiningChannelId}
      spaceIsAdmin={spaceCtx?.isAdmin}
      onRenameSection={handleRenameSection}
      onDeleteSection={handleDeleteSection}
    />
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  // Channels is full-bleed Slack-style: the shell gives us the whole area below
  // the navbar (h-full, no gutters) and we pad left by exactly CHANNELS_PANEL_W
  // (Sidebar.tsx) so the thread's border lands on the docked card's right edge.
  return (
    <div
      className={`flex h-full min-h-0 w-full flex-col ${docked ? 'lg:pl-[300px]' : ''}`}
      style={{ transition: `padding-left ${motion.duration.base}ms ${motion.easeCss.gentle}` }}
    >

      {/* ╭── List box — docked: portals into the Sidebar ──╮ */}
      {docked && listPanel}

      {/* ── List · open channel · details — three columns on hairlines. The
             same shape whether the list is docked into the sidebar or inline. */}
      <div className="flex min-h-0 w-full flex-1 items-stretch">

      {/* Un-docked: the list renders inline beside the thread */}
      {!docked && showInbox && listPanel}

      {/* ╭── Thread — the open channel, chat thread or feed ───────────────╮ */}
      {showThread && (
        <ThreadPanel
          selectedConversation={selectedConversation}
          selectedConversationId={selectedConversationId}
          currentUser={currentUser}
          isMobile={isMobile}
          isAdmin={isAdmin}
          spaceId={spaceCtx?.currentSpace?.id}
          onShowAddMembers={() => setShowAddMembersModal(true)}
          onBackToList={handleBackToList}
          showHeaderIconPicker={showHeaderIconPicker}
          setShowHeaderIconPicker={setShowHeaderIconPicker}
          updateSelectedChannel={updateSelectedChannel}
          headerPanel={headerPanel}
          setHeaderPanel={setHeaderPanel}
          openHeaderPanel={openHeaderPanel}
          panelItems={panelItems}
          panelLoading={panelLoading}
          onPanelItemClick={handlePanelItemClick}
          showMessageSearch={showMessageSearch}
          setShowMessageSearch={setShowMessageSearch}
          messageSearch={messageSearch}
          setMessageSearch={setMessageSearch}
          messagesContainerRef={messagesContainerRef}
          messagesLoading={messagesLoading}
          messages={messages}
          virtuosoRef={virtuosoRef}
          firstItemIndex={firstItemIndex}
          hasMoreMessages={hasMoreMessages}
          loadingOlderMessages={loadingOlderMessages}
          onLoadOlder={handleLoadOlder}
          unreadMarker={unreadMarker}
          getItemHeight={getItemHeight}
          atBottom={atBottom}
          atBottomRef={atBottomRef}
          setAtBottom={setAtBottom}
          newMessagesPending={newMessagesPending}
          setNewMessagesPending={setNewMessagesPending}
          announce={announce}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          onReaction={handleReaction}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onScrollToMessage={handleScrollToMessage}
          onToggleStar={handleToggleStar}
          onSendMessage={handleSendMessage}
          typingLabel={typingLabel}
          onComposerTyping={handleComposerTyping}
          onLeaveChannel={handleLeaveChannel}
          onRenameChannel={handleRenameChannel}
          detailsShown={showProfile}
          onToggleDetails={() => toggleDetails()}
        />
      )}

      {/* ╭── Details box — the open channel's members and settings ────────╮ */}
      {showProfile && selectedConversation && (
        <aside className="hidden w-80 shrink-0 flex-col overflow-hidden border-l border-line-subtle xl:flex">
          <ProfilePanel
            conversation={selectedConversation}
            currentUserId={currentUser.id}
            isAdmin={isAdmin}
            onAddMembers={() => setShowAddMembersModal(true)}
            onRename={handleRenameChannel}
            onLeave={handleLeaveChannel}
            onRemoveMember={handleRemoveMember}
            onChangeViewMode={(mode) => void updateSelectedChannel({ viewMode: mode })}
            onChangeVisibility={(visibility) => void updateSelectedChannel({ visibility })}
            onClose={() => toggleDetails(false)}
          />
        </aside>
      )}

      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      <AddMembersModal
        isOpen={showAddMembersModal}
        existingMemberIds={selectedConversation?.participants.map((p) => p.id) ?? []}
        conversationId={selectedConversationId ?? undefined}
        onClose={() => setShowAddMembersModal(false)}
        onMembersUpdated={() => {
          if (selectedConversationId) {
            void fetchConversations(conversationSearch);
            void loadMessages(selectedConversationId, { query: messageSearch });
          }
        }}
      />

      {/* Toast error */}
      {error && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-fg px-5 py-2.5 text-sm font-medium text-surface shadow-float">
          {error}
        </div>
      )}
    </div>
  );
}
