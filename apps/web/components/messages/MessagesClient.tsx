'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { VirtuosoHandle } from 'react-virtuoso';
import { Plus, Search, X } from 'lucide-react';
import { useHeader } from '@/lib/contexts/HeaderContext';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useMessageHeights } from '@/hooks/useMessageHeights';
import type {
  ChannelDirectoryEntry,
  ChannelSpaceEntry,
  ConversationSummary,
  SavedMessageEntry,
  SerializedMessage,
  SerializedReplyTo,
} from '@/lib/messages/types';
import NewChatModal from './NewChatModal';
import { mergeMessages } from './MessageRow';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import ProfilePanel from './ProfilePanel';
import PageTitle from '@/components/ui/PageTitle';
import { MessagesTabSelector, MESSAGE_TABS, type MessageTab } from './messagesTabs';
import {
  IntroRequestCard,
  flattenIntroInbox,
  isIntroActionable,
  type IntroAction,
  type IntroItem,
} from './IntroPanel';
import type { ConversationIntroContext, IntroInbox } from '@/lib/intros/types';
import ConversationListPanel, { type ChannelSection } from './ConversationListPanel';
import ThreadPanel from './ThreadPanel';
import { useConversations } from './useConversations';
import { useMessagesRealtime } from './useMessagesRealtime';
import { useMessageActions } from './useMessageActions';

interface MessagesClientProps {
  currentUser: {
    id: string;
    name: string;
    image: string | null;
  };
  initialConversationId?: string;
  initialTab?: MessageTab;
  /**
   * 'messages' (default) → Chats + Intros tabs at /messages (bubble threads).
   * 'channels' → the Channels page at /channels: a channel rail beside the
   * selected channel, each rendered as a flat feed (feed-style rows + slim
   * composer) on the same realtime message backend.
   */
  variant?: 'messages' | 'channels';
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessagesClient({ currentUser, initialConversationId, initialTab, variant = 'messages' }: MessagesClientProps) {
  const { setHeaderContent } = useHeader();
  const communityCtx = useCommunity();
  // On wide viewports the Channels page docks its channel list INTO the global
  // Sidebar (the same portal host the /context notes tree uses), so the rail +
  // channel list read as one connected card instead of a separate floating box.
  const { host } = useContextPanel();

  // The Channels page locks the experience to channels and embeds the posts feed.
  const channelsVariant = variant === 'channels';
  const basePath = channelsVariant ? '/channels' : '/messages';
  // Which conversation tabs this variant exposes (channels has no tab strip —
  // it's channels-only with the posts feed as the default view).
  const availableTabs = useMemo<MessageTab[]>(
    () => (channelsVariant ? ['channels'] : ['direct', 'intros']),
    [channelsVariant],
  );

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
  // ≥1024px: dock the channel list into the Sidebar (must match DOCK_MIN_WIDTH in
  // Sidebar.tsx). Below it, keep the page's own inline list so a 300px panel doesn't
  // crowd the thread.
  const [isWide, setIsWide] = useState(true);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showAddMembersModal, setShowAddMembersModal] = useState(false);
  const [activeTab, setActiveTab] = useState<MessageTab>(
    variant === 'channels' ? 'channels' : (initialTab && initialTab !== 'channels' ? initialTab : 'direct'),
  );
  const [introItems, setIntroItems] = useState<IntroItem[]>([]);
  const [introsLoading, setIntrosLoading] = useState(true);
  const [channelDirectory, setChannelDirectory] = useState<ChannelDirectoryEntry[]>([]);
  const [channelSpaces, setChannelSpaces] = useState<ChannelSpaceEntry[]>([]);
  // Collapsed rail sections, persisted per browser (keyed by space id, '__none__' = unfiled).
  const [collapsedSpaces, setCollapsedSpaces] = useState<Record<string, boolean>>({});
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  // Arriving with ?new=channel (from the global "Create new → Channel" tile)
  // opens the channel-creation form straight away; the param is cleared so a
  // refresh doesn't re-open it.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (channelsVariant && searchParams.get('new') === 'channel') {
      setShowChannelForm(true);
      router.replace(basePath);
    }
  }, [channelsVariant, searchParams, router, basePath]);
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelIcon, setChannelIcon] = useState<string | null>(null);
  const [channelSpaceId, setChannelSpaceId] = useState('');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  // Inline "new space" form in the channel rail (community admins only).
  const [showSpaceForm, setShowSpaceForm] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [creatingSpace, setCreatingSpace] = useState(false);
  // Channel-header extras: emoji-icon picker + pinned/saved dropdown panels.
  const [showHeaderIconPicker, setShowHeaderIconPicker] = useState(false);
  const [headerPanel, setHeaderPanel] = useState<'pins' | 'saved' | null>(null);
  const [panelItems, setPanelItems] = useState<SavedMessageEntry[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [threadIntro, setThreadIntro] = useState<ConversationIntroContext | null>(null);
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
    intro: ConversationIntroContext | null;
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
      await fetch(`/api/messages/conversations/${conversationId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping }),
      });
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
    try {
      await fetch(`/api/messages/conversations/${conversationId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch { /* best-effort */ }
  }, []);

  const communityId = communityCtx?.currentCommunity?.id;

  const fetchChannels = useCallback(async () => {
    if (!communityId) return;
    try {
      const res = await fetch(`/api/messages/channels?communityId=${encodeURIComponent(communityId)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      setChannelDirectory(payload.channels ?? []);
      setChannelSpaces(payload.spaces ?? []);
    } catch { /* best-effort */ }
  }, [communityId]);

  // Collapsed rail sections survive reloads (client-only read to avoid SSR mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('visvine.channels.collapsed');
      if (raw) setCollapsedSpaces(JSON.parse(raw));
    } catch { /* best-effort */ }
  }, []);

  const toggleSpaceCollapsed = useCallback((key: string) => {
    setCollapsedSpaces((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('visvine.channels.collapsed', JSON.stringify(next)); } catch { /* best-effort */ }
      return next;
    });
  }, []);

  const fetchIntros = useCallback(async () => {
    try {
      const res = await fetch('/api/intros', { cache: 'no-store' });
      if (!res.ok) return;
      const inbox: IntroInbox = await res.json();
      setIntroItems(flattenIntroInbox(inbox));
    } catch { /* best-effort */ } finally {
      setIntrosLoading(false);
    }
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
      const response = await fetch(`/api/messages/conversations/${conversationId}/messages?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Failed to load messages');
      }
      const payload = await response.json();
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
        setThreadIntro(payload.intro ?? null);
        messagesConvoRef.current = conversationId;
      }
      setActiveConversation(payload.conversation ?? null);
      // Deep links to a channel should land on the Channels tab (messages variant only —
      // the channels variant is already locked to 'channels').
      if (!channelsVariant && payload.conversation?.type === 'CHANNEL') setActiveTab('channels');
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
  }, [currentUser.id, channelsVariant]);

  // Header: inject nothing for messages page — the page is self-contained
  useEffect(() => {
    setHeaderContent(null);
    return () => setHeaderContent(null);
  }, [setHeaderContent]);

  useEffect(() => { selectedConversationRef.current = selectedConversationId; }, [selectedConversationId]);
  useEffect(() => { setSelectedConversationId(initialConversationId ?? null); }, [initialConversationId]);
  useEffect(() => {
    if (channelsVariant) return; // locked to 'channels'
    if (initialTab && initialTab !== 'channels') setActiveTab(initialTab);
  }, [initialTab, channelsVariant]);

  // Intro inbox: load on mount, refresh on a slow poll (no SSE channel for
  // intros). Skipped while the tab is hidden; catches up on return.
  useEffect(() => {
    void fetchIntros();
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void fetchIntros();
    }, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') void fetchIntros(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchIntros]);

  // Channel directory: refresh whenever the Channels tab is shown.
  useEffect(() => {
    if (activeTab !== 'channels') return;
    void fetchChannels();
  }, [activeTab, fetchChannels]);

  useEffect(() => {
    const update = () => {
      setIsMobile(window.innerWidth < 768);
      setIsWide(window.innerWidth >= 1024);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Presence heartbeat every 30s while the tab is visible; a hidden tab stays
  // quiet and beats once immediately when it becomes visible again.
  useEffect(() => {
    const beat = () => { void fetch('/api/presence/heartbeat', { method: 'POST' }).catch(() => {}); };
    beat();
    const iv = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      beat();
    }, 30_000);
    const onVis = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
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
      setThreadIntro(null);
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
      setThreadIntro(cached.intro);
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
      intro: threadIntro,
    });
  }, [messages, messageCursor, hasMoreMessages, threadIntro, messageSearch]);

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

  // Clear marker when switching convo
  useEffect(() => { setUnreadMarker(null); }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) return;
    // Only refetch when the search term actually changed — the conversation
    // switch itself already loads messages (this used to double-fetch).
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

  /** Open (or lazily create) the DM with a person node — the connected-intro CTA. */
  const openConversationWithNode = async (nodeId: string) => {
    try {
      const payload = await fetchJsonBody<{ conversation: { id: string } }>('/api/messages/conversations/dm', 'POST', { nodeId });
      await fetchConversations(conversationSearch);
      setActiveTab('direct');
      handleSelectConversation(payload.conversation.id);
    } catch (e) {
      setError((e as Error).message || 'Unable to open the conversation.');
    }
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

  const handleCreateChannel = async (e: FormEvent) => {
    e.preventDefault();
    if (!communityId || !channelName.trim() || creatingChannel) return;
    try {
      setCreatingChannel(true);
      const payload = await fetchJsonBody<{ conversation: { id: string } }>('/api/messages/conversations/channel', 'POST', {
        communityId,
        name: channelName.trim(),
        description: channelDescription.trim() || undefined,
        icon: channelIcon ?? undefined,
        spaceId: channelSpaceId || undefined,
      });
      setChannelName('');
      setChannelDescription('');
      setChannelIcon(null);
      setChannelSpaceId('');
      setShowChannelForm(false);
      await fetchConversations(conversationSearch);
      await fetchChannels();
      handleSelectConversation(payload.conversation.id);
    } catch (createError) {
      setError((createError as Error).message || 'Unable to create the channel.');
    } finally {
      setCreatingChannel(false);
    }
  };

  const handleCreateSpace = async (e: FormEvent) => {
    e.preventDefault();
    if (!communityId || !spaceName.trim() || creatingSpace) return;
    try {
      setCreatingSpace(true);
      await fetchJsonBody('/api/messages/spaces', 'POST', { communityId, name: spaceName.trim() });
      setSpaceName('');
      setShowSpaceForm(false);
      await fetchChannels();
    } catch (createError) {
      setError((createError as Error).message || 'Unable to create the space.');
    } finally {
      setCreatingSpace(false);
    }
  };

  /** PATCH the open channel (icon / space) and refresh everything that shows it. */
  const updateSelectedChannel = useCallback(async (patch: { icon?: string | null; spaceId?: string | null }) => {
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

  const openHeaderPanel = useCallback(async (panel: 'pins' | 'saved') => {
    if (headerPanel === panel) {
      setHeaderPanel(null);
      return;
    }
    setHeaderPanel(panel);
    setPanelItems([]);
    setPanelLoading(true);
    try {
      const url = panel === 'pins'
        ? `/api/messages/conversations/${selectedConversationRef.current}/pins`
        : '/api/messages/starred';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load messages');
      const payload = await res.json();
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

  const handleIntroAction = async (id: string, action: IntroAction, endorsement?: string) => {
    const payload = await fetchJsonBody<{ conversationId?: string } | null>(`/api/intros/${id}`, 'PATCH', { action, endorsement });
    await fetchIntros();
    // Accepting seeds a DM — drop the user straight into the new conversation.
    if (action === 'accept' && payload?.conversationId) {
      await fetchConversations(conversationSearch);
      setActiveTab('direct');
      handleSelectConversation(payload.conversationId);
    }
    return payload;
  };

  const handleLoadOlder = useCallback(async () => {
    if (!selectedConversationId || !hasMoreMessages || !messageCursor || loadingOlderMessages) return;
    await loadMessages(selectedConversationId, { cursor: messageCursor, prepend: true, query: messageSearch });
  }, [selectedConversationId, hasMoreMessages, messageCursor, loadingOlderMessages, loadMessages, messageSearch]);

  const handleSendMessage = async (payload: {
    text: string;
    imageUrls?: string[];
    mentions?: Array<{ mentionedUserId?: string; mentionedNodeId?: string; mentionType: string }>;
    replyToId?: string;
  }) => {
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
      const respPayload = await fetchJsonBody<{ message: SerializedMessage }>(`/api/messages/conversations/${selectedConversationId}/messages`, 'POST', payload);
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
    handleTogglePin,
    handleEdit,
    handleDelete,
    handleScrollToMessage,
  } = useMessageActions({ selectedConversationRef, virtuosoRef, messages, setMessages });

  const handleLeaveGroup = async () => {
    if (!selectedConversationId) return;
    const prompt = selectedConversation?.type === 'CHANNEL' ? 'Leave this channel?' : 'Leave this group chat?';
    if (!window.confirm(prompt)) return;
    try {
      await fetchJson(`/api/messages/conversations/${selectedConversationId}/leave`, { method: 'POST' });
      handleBackToList();
      await fetchConversations(conversationSearch, false);
    } catch (e) { setError((e as Error).message || 'Unable to leave group.'); }
  };

  const handleRenameGroup = async () => {
    if (!selectedConversationId || !selectedConversation) return;
    const label = selectedConversation.type === 'CHANNEL' ? 'Enter a new channel name' : 'Enter a new group name';
    const nextName = window.prompt(label, selectedConversation.name);
    if (!nextName?.trim()) return;
    try {
      const payload = await fetchJsonBody<{ conversation: ConversationSummary }>(`/api/messages/conversations/${selectedConversationId}`, 'PATCH', { name: nextName.trim() });
      await fetchConversations(conversationSearch);
      setActiveConversation(payload.conversation);
    } catch (e) { setError((e as Error).message || 'Unable to rename group.'); }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!selectedConversationId || !selectedConversation) return;
    const target = selectedConversation.participants.find((p) => p.id === memberUserId);
    if (!target || !window.confirm(`Remove ${target.name} from the group?`)) return;
    try {
      await fetchJson(`/api/messages/conversations/${selectedConversationId}/members/${memberUserId}`, { method: 'DELETE' });
      await fetchConversations(conversationSearch);
      await loadMessages(selectedConversationId, { query: messageSearch });
    } catch (e) { setError((e as Error).message || 'Unable to remove member.'); }
  };

  // ─── Derived data ───────────────────────────────────────────────────────────

  const filteredConversations = useMemo(() => conversations.filter((c) => {
    if (activeTab === 'direct') return c.type === 'DM' || c.type === 'GROUP';
    if (activeTab === 'channels') return c.type === 'CHANNEL';
    return false;
  }), [conversations, activeTab]);

  // Channels in the community directory the user hasn't joined yet.
  const browsableChannels = useMemo(() => {
    const joined = new Set(conversations.map((c) => c.id));
    const q = conversationSearch.trim().toLowerCase();
    return channelDirectory
      .filter((ch) => !ch.isMember && !joined.has(ch.id))
      .filter((ch) => !q || ch.name.toLowerCase().includes(q) || (ch.description?.toLowerCase().includes(q) ?? false));
  }, [channelDirectory, conversations, conversationSearch]);

  // Circle-style rail sections: one per space (joined + browsable channels filed
  // there), then an unfiled bucket. Sections with nothing to show are skipped.
  const channelSections = useMemo(() => {
    const joined = filteredConversations.filter((c) => c.type === 'CHANNEL');
    const spaceIds = new Set(channelSpaces.map((s) => s.id));
    const sections: ChannelSection[] = [];
    for (const space of channelSpaces) {
      const joinedHere = joined.filter((c) => c.spaceId === space.id);
      const browsableHere = browsableChannels.filter((ch) => ch.spaceId === space.id);
      if (joinedHere.length || browsableHere.length) {
        sections.push({ key: space.id, name: space.name, emoji: space.emoji, joined: joinedHere, browsable: browsableHere });
      }
    }
    const joinedUnfiled = joined.filter((c) => !c.spaceId || !spaceIds.has(c.spaceId));
    const browsableUnfiled = browsableChannels.filter((ch) => !ch.spaceId || !spaceIds.has(ch.spaceId));
    if (joinedUnfiled.length || browsableUnfiled.length) {
      sections.push({ key: '__none__', name: 'Channels', emoji: null, joined: joinedUnfiled, browsable: browsableUnfiled });
    }
    return sections;
  }, [filteredConversations, browsableChannels, channelSpaces]);

  const filteredIntroItems = useMemo(() => {
    const q = conversationSearch.trim().toLowerCase();
    if (!q) return introItems;
    return introItems.filter(({ intro }) => [
      intro.requesterNode?.name,
      intro.introducerNode?.name,
      intro.targetNode?.name,
    ].some((name) => name?.toLowerCase().includes(q)));
  }, [introItems, conversationSearch]);

  const tabCounts = useMemo<Record<MessageTab, number>>(() => ({
    channels: conversations.filter((c) => c.type === 'CHANNEL' && c.unreadCount > 0).length,
    direct: conversations.filter((c) => c.type !== 'CHANNEL' && c.unreadCount > 0).length,
    intros: introItems.filter(isIntroActionable).length,
  }), [conversations, introItems]);

  const isAdmin = selectedConversation?.currentUserRole === 'ADMIN';
  // Whether the centre column has an open thread. Desktop always shows the centre
  // beside the rail; mobile shows it only once the user opens a channel/chat.
  const mobileContentOpen = Boolean(selectedConversationId);
  // Intros render as a centered list with inline actions — no thread opens there.
  const hasOpenThread = activeTab !== 'intros' && mobileContentOpen;
  const showInbox = !isMobile || !hasOpenThread;
  const showThread = !isMobile || hasOpenThread;
  const showProfile = !isMobile && activeTab !== 'intros' && Boolean(selectedConversation);
  // On mobile, give the open thread the full viewport — hide the centered controls.
  const showCenterControls = !isMobile || !hasOpenThread;

  // Whether to dock the channel list into the Sidebar (channels page, wide viewport,
  // host mounted). When docked we hide the page's title/search chrome (it moves into
  // the docked panel) and pad the thread to clear the docked card.
  const dockChannels = channelsVariant && isWide && Boolean(host);

  // ─── Render ─────────────────────────────────────────────────────────────────

  // The auth shell wraps pages in mt-20 + pt-4 + pb-6 (120px) — fill the rest.
  // When the list is docked into the Sidebar, pad the content left so the thread
  // clears the docked card (300px panel + 12px gutter). Kept in sync with
  // CHANNELS_PANEL_W in Sidebar.tsx.
  return (
    <div className={`flex h-[calc(100dvh-120px)] min-h-0 w-full flex-col px-6 ${dockChannels ? 'lg:pl-[312px]' : ''}`}
      style={{ transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' }}
    >

      {/* ── Page header — centered title, consistent with other pages ───── */}
      {!dockChannels && (
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 pt-0 pb-0">
        <div />
        <PageTitle title={channelsVariant ? 'Channels' : 'Messages'} />
        <div className="justify-self-end">
          {/* Channel creation lives in the global sidebar "+" (Create new →
              Channel) — no header button on the channels variant. */}
          {activeTab !== 'channels' && (
            <button
              type="button"
              onClick={() => setShowNewChatModal(true)}
              className="flex items-center gap-1.5 rounded-full bg-brand-green px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              <span className="hidden sm:inline">New Chat</span>
            </button>
          )}
        </div>
      </div>
      )}

      {/* ── Centered controls: search + tab switcher, same as other pages ── */}
      {showCenterControls && !dockChannels && (
        <div className="flex flex-col items-center gap-3 pt-6 pb-5">
          <div className="w-full max-w-2xl">
            <div className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-border-default bg-surface-1 px-4 shadow-sm transition-colors focus-within:border-brand-green/40">
              <Search className="h-4 w-4 shrink-0 text-text-muted" />
              <input
                ref={sidebarSearchRef}
                value={conversationSearch}
                onChange={(e) => setConversationSearch(e.target.value)}
                placeholder={channelsVariant ? 'Search channels…' : activeTab === 'intros' ? 'Search introductions…' : 'Search conversations…'}
                className="flex-1 bg-transparent text-base text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              {conversationSearch && (
                <button type="button" onClick={() => setConversationSearch('')} className="text-text-muted hover:text-text-secondary">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {!channelsVariant && (
            <MessagesTabSelector
              activeTab={activeTab}
              onTabChange={setActiveTab}
              counts={tabCounts}
              tabs={MESSAGE_TABS.filter((t) => availableTabs.includes(t.id))}
            />
          )}
        </div>
      )}

      {/* ── List box · open thread · profile box (Chats / Channels) ───────── */}
      {activeTab !== 'intros' && (
      <div className="flex min-h-0 w-full flex-1 items-stretch gap-6 pb-2 md:gap-12 md:px-6">

      {/* ╭── List box — users or channels depending on the selected chip ──╮
          On the Channels page (wide) this same content is portaled into the
          Sidebar dock instead of floating as its own box (see dockChannels). */}
      {showInbox && (
        <ConversationListPanel
          dockChannels={dockChannels}
          host={host}
          channelsVariant={channelsVariant}
          sidebarSearchRef={sidebarSearchRef}
          conversationSearch={conversationSearch}
          setConversationSearch={setConversationSearch}
          activeTab={activeTab}
          conversationsLoading={conversationsLoading}
          filteredConversations={filteredConversations}
          browsableChannels={browsableChannels}
          channelSections={channelSections}
          channelSpaces={channelSpaces}
          collapsedSpaces={collapsedSpaces}
          toggleSpaceCollapsed={toggleSpaceCollapsed}
          selectedConversationId={selectedConversationId}
          onSelectConversation={handleSelectConversation}
          onJoinChannel={handleJoinChannel}
          joiningChannelId={joiningChannelId}
          communityIsAdmin={communityCtx?.isAdmin}
          showChannelForm={showChannelForm}
          setShowChannelForm={setShowChannelForm}
          onCreateChannel={handleCreateChannel}
          channelName={channelName}
          setChannelName={setChannelName}
          channelDescription={channelDescription}
          setChannelDescription={setChannelDescription}
          channelIcon={channelIcon}
          setChannelIcon={setChannelIcon}
          channelSpaceId={channelSpaceId}
          setChannelSpaceId={setChannelSpaceId}
          showIconPicker={showIconPicker}
          setShowIconPicker={setShowIconPicker}
          creatingChannel={creatingChannel}
          showSpaceForm={showSpaceForm}
          setShowSpaceForm={setShowSpaceForm}
          spaceName={spaceName}
          setSpaceName={setSpaceName}
          creatingSpace={creatingSpace}
          onCreateSpace={handleCreateSpace}
        />
      )}

      {/* ╭── Thread — open on the page, just floating message bubbles ─────╮ */}
      {showThread && (
        <ThreadPanel
          channelsVariant={channelsVariant}
          selectedConversation={selectedConversation}
          selectedConversationId={selectedConversationId}
          currentUser={currentUser}
          isMobile={isMobile}
          isAdmin={isAdmin}
          communityIsAdmin={communityCtx?.isAdmin}
          communityId={communityCtx?.currentCommunity?.id}
          hasChannelsInList={filteredConversations.length > 0}
          onShowChannelForm={() => setShowChannelForm(true)}
          onShowNewChat={() => setShowNewChatModal(true)}
          onShowAddMembers={() => setShowAddMembersModal(true)}
          onBackToList={handleBackToList}
          showHeaderIconPicker={showHeaderIconPicker}
          setShowHeaderIconPicker={setShowHeaderIconPicker}
          updateSelectedChannel={updateSelectedChannel}
          channelSpaces={channelSpaces}
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
          threadIntro={threadIntro}
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
          onTogglePin={handleTogglePin}
          onSendMessage={handleSendMessage}
          typingLabel={typingLabel}
          onComposerTyping={handleComposerTyping}
          onLeaveGroup={handleLeaveGroup}
          onRenameGroup={handleRenameGroup}
        />
      )}

      {/* ╭── Profile box — the person (or group) you're talking to ────────╮ */}
      {showProfile && selectedConversation && (
        <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-3xl bg-surface-1 shadow-float xl:flex">
          <ProfilePanel
            conversation={selectedConversation}
            currentUserId={currentUser.id}
            isAdmin={isAdmin}
            onAddMembers={() => setShowAddMembersModal(true)}
            onRename={handleRenameGroup}
            onLeave={handleLeaveGroup}
            onRemoveMember={handleRemoveMember}
          />
        </aside>
      )}

      </div>
      )}

      {/* ── Intros — centered list of requests with inline actions ────────── */}
      {activeTab === 'intros' && (
        <div className="custom-scrollbar min-h-0 w-full flex-1 overflow-y-auto pb-6">
          <div className="mx-auto w-full max-w-3xl space-y-3 px-1">
            {introsLoading && (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3.5 rounded-3xl border border-border-subtle/70 bg-surface-1 p-5">
                  <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-surface-3" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-surface-3" />
                    <div className="h-2.5 w-1/2 animate-pulse rounded bg-surface-3" />
                  </div>
                </div>
              ))
            )}

            {!introsLoading && filteredIntroItems.length === 0 && (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/10">
                  <svg className="h-7 w-7 text-brand-dark-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-text-secondary">No introductions yet</p>
                <p className="mt-1 text-xs text-text-muted">
                  Open a member&apos;s profile and use Connect → Request an introduction.
                </p>
              </div>
            )}

            {!introsLoading && filteredIntroItems.map((item) => (
              <IntroRequestCard
                key={item.intro.id}
                item={item}
                onAction={handleIntroAction}
                onOpenConversation={(nodeId) => void openConversationWithNode(nodeId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      <NewChatModal
        isOpen={showNewChatModal}
        onClose={() => setShowNewChatModal(false)}
        onConversationSelected={(conversationId) => {
          setShowNewChatModal(false);
          void fetchConversations(conversationSearch).then(() => handleSelectConversation(conversationId));
        }}
      />

      <NewChatModal
        isOpen={showAddMembersModal}
        mode="addMembers"
        existingMemberIds={selectedConversation?.participants.map((p) => p.id) ?? []}
        addMembersConversationId={selectedConversationId ?? undefined}
        onClose={() => setShowAddMembersModal(false)}
        onConversationSelected={(conversationId) => {
          setShowAddMembersModal(false);
          void fetchConversations(conversationSearch);
          void loadMessages(conversationId, { query: messageSearch });
        }}
        onMembersUpdated={() => {
          if (selectedConversationId) {
            void fetchConversations(conversationSearch);
            void loadMessages(selectedConversationId, { query: messageSearch });
          }
        }}
      />

      {/* Toast error */}
      {error && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}
