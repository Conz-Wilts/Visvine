'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Plus, Search, X, ArrowLeft, UserPlus, Pencil, LogOut, Hash, MessageCircle, ChevronDown, ChevronRight, Pin, Star } from 'lucide-react';
import { useHeader } from '@/lib/contexts/HeaderContext';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useMessageHeights } from '@/hooks/useMessageHeights';
import type {
  ChannelDirectoryEntry,
  ChannelSpaceEntry,
  ConversationSummary,
  RealtimeEvent,
  SavedMessageEntry,
  SerializedMessage,
  SerializedReplyTo,
} from '@/lib/messages/types';
import NewChatModal from './NewChatModal';
import { ChannelIcon, EmojiIconPicker } from './ChannelIcon';
import MessageComposer from './MessageComposer';
import MessageRow, { formatChatTimestamp, mergeMessages } from './MessageRow';
import ProfilePanel from './ProfilePanel';
import Avatar from '@/components/ui/Avatar';
import PageTitle from '@/components/ui/PageTitle';
import { MessagesTabSelector, MESSAGE_TABS, formatDateLabel, type MessageTab } from './messagesTabs';
import {
  IntroBanner,
  IntroRequestCard,
  flattenIntroInbox,
  isIntroActionable,
  type IntroAction,
  type IntroItem,
} from './IntroPanel';
import type { ConversationIntroContext, IntroInbox } from '@/lib/intros/types';

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

/** Messages within this window of the previous message from the same sender share a header. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

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

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<SerializedMessage[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId ?? null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [conversationsLoading, setConversationsLoading] = useState(true);
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
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
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
  // Mirror of `messages` for stable callbacks that only need to read it.
  const messagesRef = useRef<SerializedMessage[]>([]);
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
        setSelectedConversationId(null);
        selectedConversationRef.current = null;
        setActiveConversation(null);
        setMessages([]);
        window.history.replaceState(null, '', basePath);
      }
    } catch (fetchError) {
      setError((fetchError as Error).message || 'Failed to load conversations.');
    } finally {
      setConversationsLoading(false);
    }
  }, [basePath]);

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
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { setSelectedConversationId(initialConversationId ?? null); }, [initialConversationId]);
  useEffect(() => {
    if (channelsVariant) return; // locked to 'channels'
    if (initialTab && initialTab !== 'channels') setActiveTab(initialTab);
  }, [initialTab, channelsVariant]);

  // Intro inbox: load on mount, refresh on a slow poll (no SSE channel for intros).
  useEffect(() => {
    void fetchIntros();
    const t = setInterval(() => void fetchIntros(), 60_000);
    return () => clearInterval(t);
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

  // Presence heartbeat every 30s while tab open
  useEffect(() => {
    const beat = () => { void fetch('/api/presence/heartbeat', { method: 'POST' }).catch(() => {}); };
    beat();
    const iv = setInterval(beat, 30_000);
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

  useEffect(() => {
    const t = setTimeout(() => void fetchConversations(conversationSearch), 200);
    return () => clearTimeout(t);
  }, [conversationSearch, fetchConversations]);

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

  // Realtime SSE
  useEffect(() => {
    const typingTimers = typingTimersRef.current;
    const source = new EventSource('/api/messages/stream');
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent;
        if (payload.type === 'message.new') {
          const normalized: SerializedMessage = { ...payload.message, isOwn: payload.message.sender.id === currentUser.id };
          if (payload.conversationId === selectedConversationRef.current) {
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
          void fetchConversations(conversationSearch);
        }
        if (payload.type === 'message.updated') {
          if (payload.conversationId === selectedConversationRef.current) {
            const updated = { ...payload.message, isOwn: payload.message.sender.id === currentUser.id };
            // `starred` is per-user but the broadcast is serialized for the editor —
            // keep the local flag so someone else's edit doesn't clear your star.
            setMessages((prev) => prev.map((m) => m.id === updated.id ? { ...updated, starred: m.starred } : m));
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
            setMessages((prev) => prev.map((m) => {
              if (m.id !== payload.messageId) return m;
              const reactions = [...(m.reactions ?? [])];
              const existing = reactions.find((r) => r.emoji === payload.emoji);
              if (payload.type === 'reaction.added') {
                if (existing) {
                  existing.count++;
                  if (payload.userId === currentUser.id) existing.reacted = true;
                } else {
                  reactions.push({ emoji: payload.emoji, count: 1, reacted: payload.userId === currentUser.id });
                }
              } else {
                if (existing) {
                  existing.count--;
                  if (payload.userId === currentUser.id) existing.reacted = false;
                  if (existing.count <= 0) {
                    const idx = reactions.indexOf(existing);
                    reactions.splice(idx, 1);
                  }
                }
              }
              return { ...m, reactions };
            }));
          }
        }
        if (payload.type === 'conversation.updated') void fetchConversations(conversationSearch);
        if (payload.type === 'typing') {
          if (payload.userId === currentUser.id || payload.conversationId !== selectedConversationRef.current) return;
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
    return () => { source.close(); typingTimers.forEach(clearTimeout); typingTimers.clear(); };
  }, [conversationSearch, currentUser.id, fetchConversations, markConversationRead]);

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
      const response = await fetch('/api/messages/conversations/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to open the conversation');
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
      const response = await fetch(`/api/messages/conversations/${channelId}/join`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Unable to join the channel');
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
      const response = await fetch('/api/messages/conversations/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communityId,
          name: channelName.trim(),
          description: channelDescription.trim() || undefined,
          icon: channelIcon ?? undefined,
          spaceId: channelSpaceId || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create the channel');
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
      const response = await fetch('/api/messages/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ communityId, name: spaceName.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create the space');
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
      const response = await fetch(`/api/messages/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update the channel');
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
    const response = await fetch(`/api/intros/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, endorsement }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? 'Action failed');
    await fetchIntros();
    // Accepting seeds a DM — drop the user straight into the new conversation.
    if (action === 'accept' && payload.conversationId) {
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
      const response = await fetch(`/api/messages/conversations/${selectedConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const respPayload = await response.json();
      if (!response.ok) throw new Error(respPayload.error ?? 'Failed to send message');
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

  // These four are passed to every (memoized) MessageRow — keep them stable
  // via useCallback + refs or the memo never holds and each state change
  // re-parses markdown for all visible rows.
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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

  const handleScrollToMessage = useCallback((messageId: string) => {
    const idx = messagesRef.current.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: idx, behavior: 'smooth', align: 'center' });
    }
  }, []);

  const handleLeaveGroup = async () => {
    if (!selectedConversationId) return;
    const prompt = selectedConversation?.type === 'CHANNEL' ? 'Leave this channel?' : 'Leave this group chat?';
    if (!window.confirm(prompt)) return;
    try {
      const response = await fetch(`/api/messages/conversations/${selectedConversationId}/leave`, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Failed to leave group');
      }
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
      const response = await fetch(`/api/messages/conversations/${selectedConversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to rename group');
      await fetchConversations(conversationSearch);
      setActiveConversation(payload.conversation);
    } catch (e) { setError((e as Error).message || 'Unable to rename group.'); }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!selectedConversationId || !selectedConversation) return;
    const target = selectedConversation.participants.find((p) => p.id === memberUserId);
    if (!target || !window.confirm(`Remove ${target.name} from the group?`)) return;
    try {
      const response = await fetch(`/api/messages/conversations/${selectedConversationId}/members/${memberUserId}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Failed to remove member');
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
    const sections: Array<{
      key: string;
      name: string;
      emoji: string | null;
      joined: ConversationSummary[];
      browsable: ChannelDirectoryEntry[];
    }> = [];
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

  // The docked panel's own header: title and channel search. Channel creation
  // lives in the global sidebar "+" (Create new → Channel), not here. Only
  // rendered inside the Sidebar dock (the page's centered controls cover the
  // un-docked cases).
  const channelControls = channelsVariant ? (
    <div className="space-y-2 px-3 pb-2 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary">Channels</span>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-border-default bg-surface-1 px-3 py-2 transition-colors focus-within:border-brand-green/40">
        <Search className="h-4 w-4 shrink-0 text-text-muted" />
        <input
          ref={sidebarSearchRef}
          value={conversationSearch}
          onChange={(e) => setConversationSearch(e.target.value)}
          placeholder="Search channels…"
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {conversationSearch && (
          <button type="button" onClick={() => setConversationSearch('')} className="text-text-muted hover:text-text-secondary">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  ) : null;

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
      {showInbox && (() => {
        const inbox = (
          <>
          {/* Docked panel gets its own title + New button + search up top */}
          {dockChannels && channelControls}

          {/* Channel creation (community admins only) */}
          {activeTab === 'channels' && showChannelForm && (
            <form onSubmit={handleCreateChannel} className="space-y-2 border-b border-border-subtle px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowIconPicker((v) => !v)}
                    title="Channel icon (default #)"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-default bg-surface-1 text-text-secondary transition-colors hover:border-brand-green/40"
                  >
                    <ChannelIcon icon={channelIcon} className="h-4 w-4" />
                  </button>
                  {showIconPicker && (
                    <div className="absolute left-0 top-10 z-30">
                      <EmojiIconPicker
                        onSelect={(emoji) => setChannelIcon(emoji)}
                        onClear={channelIcon ? () => setChannelIcon(null) : undefined}
                        onClose={() => setShowIconPicker(false)}
                      />
                    </div>
                  )}
                </div>
                <input
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  placeholder="Channel name"
                  autoFocus
                  maxLength={80}
                  className="min-w-0 flex-1 rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none"
                />
              </div>
              <input
                value={channelDescription}
                onChange={(e) => setChannelDescription(e.target.value)}
                placeholder="Description (optional)"
                maxLength={500}
                className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none"
              />
              {channelSpaces.length > 0 && (
                <select
                  value={channelSpaceId}
                  onChange={(e) => setChannelSpaceId(e.target.value)}
                  className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary focus:border-brand-green/40 focus:outline-none"
                >
                  <option value="">No space</option>
                  {channelSpaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.emoji ? `${space.emoji} ` : ''}{space.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowChannelForm(false); setChannelName(''); setChannelDescription(''); setChannelIcon(null); setChannelSpaceId(''); setShowIconPicker(false); }}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!channelName.trim() || creatingChannel}
                  className="rounded-full bg-brand-green px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {creatingChannel ? 'Creating…' : 'Create channel'}
                </button>
              </div>
            </form>
          )}

          {/* List area */}
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pb-3">

            {/* ── Conversations (Chats / Channels tabs) ── */}
            {(
              <>
                {conversationsLoading && (
                  <div className="space-y-1 px-3 py-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-2xl p-3">
                        <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-surface-3" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-3" />
                          <div className="h-2.5 w-1/2 animate-pulse rounded bg-surface-3" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!conversationsLoading && filteredConversations.length === 0
                  && (activeTab !== 'channels' || browsableChannels.length === 0) && (
                  <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">
                      {activeTab === 'channels'
                        ? <Hash className="h-6 w-6 text-text-muted" />
                        : <MessageCircle className="h-6 w-6 text-text-muted" />}
                    </div>
                    <p className="text-sm font-medium text-text-secondary">
                      {activeTab === 'channels' ? 'No channels yet' : 'No conversations yet'}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      {activeTab === 'channels'
                        ? (communityCtx?.isAdmin
                          ? 'Create the first channel with the + button in the sidebar.'
                          : 'Channels created by your community admins will appear here.')
                        : 'Start one with the + button above.'}
                    </p>
                  </div>
                )}

                {!conversationsLoading && activeTab !== 'channels' && filteredConversations.length > 0 && (
                  <div className="px-2.5 py-1">
                    {filteredConversations.map((conversation) => {
                      const isActive = selectedConversationId === conversation.id;
                      const hasUnread = conversation.unreadCount > 0 && !isActive;
                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => handleSelectConversation(conversation.id)}
                          className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-150 ${
                            isActive ? 'bg-brand-green/10 ring-1 ring-brand-green/20' : 'hover:bg-surface-2'
                          }`}
                        >
                          <div className="relative shrink-0">
                            <Avatar name={conversation.name} />
                            {hasUnread && (
                              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface-1 bg-brand-green" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className={`truncate text-sm ${isActive || conversation.unreadCount > 0 ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary'}`}>
                                {conversation.name}
                              </p>
                              <span className="shrink-0 text-[11px] text-text-muted">
                                {formatChatTimestamp(conversation.lastMessage?.createdAt ?? conversation.updatedAt)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className={`truncate text-xs ${hasUnread ? 'font-medium text-text-secondary' : 'text-text-muted'}`}>
                                {conversation.lastMessage?.text ?? 'No messages yet'}
                              </p>
                              {hasUnread && (
                                <span className="shrink-0 rounded-full bg-brand-green px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                  {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── Channels tab: sections grouped by space (Circle-style) ── */}
                {!conversationsLoading && activeTab === 'channels' && channelSections.length > 0 && (
                  <div className="px-2.5 py-1">
                    {channelSections.map((section) => {
                      const hasSpaces = channelSpaces.length > 0;
                      const collapsed = hasSpaces && Boolean(collapsedSpaces[section.key]);
                      const sectionUnread = section.joined.reduce(
                        (sum, c) => sum + (selectedConversationId === c.id ? 0 : c.unreadCount),
                        0,
                      );
                      return (
                        <div key={section.key} className="pb-1.5">
                          {hasSpaces && (
                            <button
                              type="button"
                              onClick={() => toggleSpaceCollapsed(section.key)}
                              className="group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                            >
                              {collapsed
                                ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2.5} />
                                : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2.5} />}
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted group-hover:text-text-secondary">
                                {section.emoji ? `${section.emoji} ` : ''}{section.name}
                              </span>
                              {collapsed && sectionUnread > 0 && (
                                <span className="shrink-0 rounded-full bg-brand-green px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                  {sectionUnread > 99 ? '99+' : sectionUnread}
                                </span>
                              )}
                            </button>
                          )}
                          {!collapsed && (
                            <>
                              {section.joined.map((conversation) => {
                                const isActive = selectedConversationId === conversation.id;
                                const hasUnread = conversation.unreadCount > 0 && !isActive;
                                return (
                                  <button
                                    key={conversation.id}
                                    type="button"
                                    onClick={() => handleSelectConversation(conversation.id)}
                                    className={`group flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors duration-150 ${
                                      isActive ? 'bg-brand-green/10' : 'hover:bg-surface-2'
                                    }`}
                                  >
                                    <ChannelIcon
                                      icon={conversation.icon}
                                      className={`h-4 w-4 ${isActive || hasUnread ? 'text-text-primary' : 'text-text-muted'}`}
                                    />
                                    <p className={`min-w-0 flex-1 truncate text-sm ${isActive || hasUnread ? 'font-semibold text-text-primary' : 'font-normal text-text-secondary'}`}>
                                      {conversation.name}
                                    </p>
                                    {hasUnread && (
                                      <span className="shrink-0 rounded-full bg-brand-green px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                        {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                              {section.browsable.length > 0 && (
                                <>
                                  {!hasSpaces && (
                                    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                                      Browse channels
                                    </p>
                                  )}
                                  {section.browsable.map((channel) => (
                                    <div
                                      key={channel.id}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-surface-2"
                                    >
                                      <ChannelIcon icon={channel.icon} className="mt-0.5 h-4 w-4 self-start text-text-muted" />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-normal text-text-secondary">{channel.name}</p>
                                        <p className="truncate text-xs text-text-muted">
                                          {channel.description || `${channel.memberCount} member${channel.memberCount === 1 ? '' : 's'}`}
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void handleJoinChannel(channel.id)}
                                        disabled={joiningChannelId === channel.id}
                                        className="shrink-0 rounded-full border border-brand-green/40 px-3 py-1 text-xs font-semibold text-brand-dark-green transition-colors hover:bg-brand-green/10 disabled:opacity-50"
                                      >
                                        {joiningChannelId === channel.id ? 'Joining…' : 'Join'}
                                      </button>
                                    </div>
                                  ))}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── New space (community admins) ── */}
                {activeTab === 'channels' && communityCtx?.isAdmin && (
                  <div className="px-2.5 pt-1">
                    {showSpaceForm ? (
                      <form onSubmit={handleCreateSpace} className="flex items-center gap-1.5 px-3 py-1">
                        <input
                          value={spaceName}
                          onChange={(e) => setSpaceName(e.target.value)}
                          placeholder="Space name"
                          autoFocus
                          maxLength={80}
                          className="min-w-0 flex-1 rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!spaceName.trim() || creatingSpace}
                          className="shrink-0 rounded-full bg-brand-green px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                        >
                          {creatingSpace ? '…' : 'Add'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowSpaceForm(false); setSpaceName(''); }}
                          className="shrink-0 text-text-muted hover:text-text-secondary"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowSpaceForm(true)}
                        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                        New space
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

          </div>
          </>
        );
        return dockChannels
          ? createPortal(
              <div
                className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-1"
                style={{ animation: 'fadeIn 0.3s ease-out' }}
              >
                {inbox}
              </div>,
              host as HTMLElement,
            )
          : (
            <aside className="flex w-full min-h-0 flex-col overflow-hidden rounded-3xl bg-surface-1 shadow-float md:w-80 md:shrink-0">
              {inbox}
            </aside>
          );
      })()}

      {/* ╭── Thread — open on the page, just floating message bubbles ─────╮ */}
      {showThread && (
        <section className="flex w-full min-w-0 flex-1 flex-col overflow-hidden">

          {/* ── Channels: empty state when no channel feed is open ── */}
          {!selectedConversation && channelsVariant && (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-2">
                <Hash className="h-9 w-9 text-text-muted" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-base font-semibold text-text-primary">No channel selected</p>
                <p className="mt-1 text-sm text-text-muted">
                  {filteredConversations.length > 0
                    ? 'Pick a channel from the list to open its feed.'
                    : communityCtx?.isAdmin
                      ? 'Create your first channel to start a feed.'
                      : 'Channels created by your community admins will appear here.'}
                </p>
              </div>
              {communityCtx?.isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowChannelForm(true)}
                  className="mt-2 flex items-center gap-2 rounded-full bg-brand-green px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  New channel
                </button>
              )}
            </div>
          )}

          {/* ── Conversation thread ── */}
          {!selectedConversation && !channelsVariant && (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-2">
                <MessageCircle className="h-9 w-9 text-text-muted" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-base font-semibold text-text-primary">No conversation selected</p>
                <p className="mt-1 text-sm text-text-muted">Pick a chat from the list or start a new one.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewChatModal(true)}
                className="mt-2 flex items-center gap-2 rounded-full bg-brand-green px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                Start a new chat
              </button>
            </div>
          )}

          {selectedConversation && (
            <>
              {/* Conversation header */}
              <header className="relative flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {isMobile && (
                    <button
                      type="button"
                      onClick={handleBackToList}
                      className="mr-1 rounded-lg p-1.5 text-text-muted hover:bg-surface-3"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                  )}
                  {selectedConversation.type !== 'CHANNEL' && (
                    <div className="hidden sm:block">
                      <Avatar name={selectedConversation.name} size="lg" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 truncate text-sm font-semibold text-text-primary">
                      {selectedConversation.type === 'CHANNEL' && (
                        isAdmin ? (
                          <span className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => setShowHeaderIconPicker((v) => !v)}
                              title="Change channel icon"
                              className="flex items-center justify-center rounded-md p-0.5 transition-colors hover:bg-surface-2"
                            >
                              <ChannelIcon icon={selectedConversation.icon} className="h-4 w-4" />
                            </button>
                            {showHeaderIconPicker && (
                              <span className="absolute left-0 top-7 z-30">
                                <EmojiIconPicker
                                  onSelect={(emoji) => void updateSelectedChannel({ icon: emoji })}
                                  onClear={selectedConversation.icon ? () => void updateSelectedChannel({ icon: null }) : undefined}
                                  onClose={() => setShowHeaderIconPicker(false)}
                                />
                              </span>
                            )}
                          </span>
                        ) : (
                          <ChannelIcon icon={selectedConversation.icon} className="h-4 w-4" />
                        )
                      )}
                      <span className="truncate">{selectedConversation.name}</span>
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {selectedConversation.type === 'CHANNEL'
                        ? [
                            `${selectedConversation.participants.length} member${selectedConversation.participants.length === 1 ? '' : 's'}`,
                            selectedConversation.description,
                          ].filter(Boolean).join(' · ')
                        : selectedConversation.participants.map((p) => p.name).join(', ')}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Move channel between spaces (community/channel admins) */}
                  {selectedConversation.type === 'CHANNEL' && isAdmin && channelSpaces.length > 0 && (
                    <select
                      value={selectedConversation.spaceId ?? ''}
                      onChange={(e) => void updateSelectedChannel({ spaceId: e.target.value || null })}
                      title="Move to space"
                      className="hidden max-w-36 rounded-lg border border-border-subtle bg-surface-1 px-2 py-1.5 text-xs text-text-secondary focus:border-brand-green/40 focus:outline-none md:block"
                    >
                      <option value="">No space</option>
                      {channelSpaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.emoji ? `${space.emoji} ` : ''}{space.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => void openHeaderPanel('pins')}
                    className={`rounded-lg p-2 transition-colors ${headerPanel === 'pins' ? 'bg-brand-green/10 text-brand-dark-green' : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'}`}
                    title="Pinned messages"
                  >
                    <Pin className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void openHeaderPanel('saved')}
                    className={`rounded-lg p-2 transition-colors ${headerPanel === 'saved' ? 'bg-brand-green/10 text-brand-dark-green' : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'}`}
                    title="Saved messages"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMessageSearch((v) => !v)}
                    className={`rounded-lg p-2 transition-colors ${showMessageSearch ? 'bg-brand-green/10 text-brand-dark-green' : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'}`}
                    title="Search in conversation"
                  >
                    <Search className="h-4 w-4" />
                  </button>

                  {/* Below xl the profile/details layer is hidden — keep management actions here */}
                  {selectedConversation.type !== 'DM' && isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowAddMembersModal(true)}
                        className="hidden rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-secondary md:block xl:hidden"
                        title="Add members"
                      >
                        <UserPlus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleRenameGroup}
                        className="hidden rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-secondary md:block xl:hidden"
                        title={selectedConversation.type === 'CHANNEL' ? 'Rename channel' : 'Rename group'}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </>
                  )}

                  {selectedConversation.type !== 'DM' && (
                    <button
                      type="button"
                      onClick={handleLeaveGroup}
                      className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 xl:hidden"
                      title={selectedConversation.type === 'CHANNEL' ? 'Leave channel' : 'Leave group'}
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Pinned / saved dropdown panel */}
                {headerPanel && (
                  <div className="custom-scrollbar absolute right-4 top-full z-30 max-h-96 w-80 overflow-y-auto rounded-2xl border border-border-subtle bg-surface-1 p-2 shadow-float">
                    <div className="flex items-center justify-between px-2 pb-1 pt-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {headerPanel === 'pins' ? 'Pinned in this conversation' : 'Your saved messages'}
                      </p>
                      <button type="button" onClick={() => setHeaderPanel(null)} className="text-text-muted hover:text-text-secondary">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {panelLoading && (
                      <p className="px-2 py-4 text-center text-xs text-text-muted">Loading…</p>
                    )}
                    {!panelLoading && panelItems.length === 0 && (
                      <p className="px-2 py-4 text-center text-xs text-text-muted">
                        {headerPanel === 'pins'
                          ? 'Nothing pinned yet — hover a message and hit the pin.'
                          : 'Nothing saved yet — hover a message and hit the star.'}
                      </p>
                    )}
                    {!panelLoading && panelItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handlePanelItemClick(item)}
                        className="block w-full rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <p className="truncate text-xs font-semibold text-text-primary">
                          {item.senderName}
                          <span className="font-normal text-text-muted">
                            {' · '}{formatChatTimestamp(item.createdAt)}
                            {headerPanel === 'saved' && item.conversationId !== selectedConversationId
                              ? ` · ${item.conversationName}` : ''}
                          </span>
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{item.text || '(attachment)'}</p>
                      </button>
                    ))}
                  </div>
                )}
              </header>

              {/* In-conversation search */}
              {showMessageSearch && (
                <div className="px-5 py-2.5">
                  <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                    <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    <input
                      value={messageSearch}
                      onChange={(e) => setMessageSearch(e.target.value)}
                      placeholder="Search in this conversation…"
                      autoFocus
                      className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                    />
                    {messageSearch && (
                      <button type="button" onClick={() => setMessageSearch('')} className="text-text-muted hover:text-text-secondary">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Provenance: this DM exists because of an accepted introduction */}
              {threadIntro && selectedConversation.type === 'DM' && (
                <IntroBanner context={threadIntro} />
              )}

              {/* Linear message feed */}
              <div ref={messagesContainerRef} className="relative flex-1 overflow-hidden">
                {messagesLoading && (
                  <div className="w-full space-y-4 px-6 py-5 md:px-8">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-surface-3" />
                        <div className="flex-1 space-y-2 pt-1">
                          <div className="h-3 w-40 animate-pulse rounded bg-surface-3" />
                          <div className="h-3 animate-pulse rounded bg-surface-3" style={{ width: `${85 - i * 12}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!messagesLoading && messages.length === 0 && (
                  <div className="flex h-full items-center justify-center">
                    <div className="rounded-2xl bg-surface-2 px-5 py-4 text-center text-sm text-text-muted">
                      <p className="font-medium text-text-secondary">No messages yet</p>
                      <p className="mt-0.5 text-xs text-text-muted">Say hello to start the conversation!</p>
                    </div>
                  </div>
                )}

                {!messagesLoading && messages.length > 0 && (
                  <Virtuoso
                    key={selectedConversation.id}
                    ref={virtuosoRef}
                    data={messages}
                    firstItemIndex={firstItemIndex}
                    initialTopMostItemIndex={messages.length - 1}
                    defaultItemHeight={48}
                    computeItemKey={(_index, message) => message.id}
                    increaseViewportBy={{ top: 200, bottom: 200 }}
                    scrollSeekConfiguration={{
                      enter: (velocity) => Math.abs(velocity) > 800,
                      exit: (velocity) => Math.abs(velocity) < 100,
                    }}
                    followOutput="smooth"
                    atBottomStateChange={(bottom) => {
                      atBottomRef.current = bottom;
                      setAtBottom(bottom);
                      if (bottom) setNewMessagesPending(0);
                    }}
                    startReached={() => {
                      if (hasMoreMessages && !loadingOlderMessages) {
                        void handleLoadOlder();
                      }
                    }}
                    itemContent={(_index, message) => {
                      const adjustedIdx = _index - firstItemIndex;
                      const prevMsg = messages[adjustedIdx - 1];
                      const prevDay = prevMsg ? new Date(prevMsg.createdAt).toDateString() : null;
                      const thisDay = new Date(message.createdAt).toDateString();
                      const showDateSeparator = prevDay !== thisDay;
                      const closeInTime = prevMsg
                        ? new Date(message.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() < GROUP_WINDOW_MS
                        : false;
                      const showHeader = !prevMsg
                        || prevMsg.sender.id !== message.sender.id
                        || !closeInTime
                        || showDateSeparator;
                      const showUnreadDivider = unreadMarker === message.id;
                      return (
                        <div
                          className={channelsVariant ? 'mx-auto w-full max-w-3xl px-2 md:px-3' : 'w-full px-3 md:px-6'}
                          data-message-id={message.id}
                        >
                          {showDateSeparator && (
                            <div className="my-4 flex items-center gap-3 px-3">
                              <div className="h-px flex-1 bg-border-subtle" />
                              <span className="text-[11px] font-medium text-text-muted">
                                {formatDateLabel(message.createdAt)}
                              </span>
                              <div className="h-px flex-1 bg-border-subtle" />
                            </div>
                          )}
                          {showUnreadDivider && (
                            <div className="my-2 flex items-center gap-3 px-3">
                              <div className="h-px flex-1 bg-red-500/50" />
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-red-500">
                                New
                              </span>
                              <div className="h-px flex-1 bg-red-500/50" />
                            </div>
                          )}
                          <MessageRow
                            message={message}
                            showHeader={showHeader}
                            variant={channelsVariant ? 'feed' : 'bubble'}
                            onReply={setReplyTo}
                            onReaction={handleReaction}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onScrollToMessage={handleScrollToMessage}
                            onToggleStar={handleToggleStar}
                            onTogglePin={handleTogglePin}
                          />
                        </div>
                      );
                    }}
                    style={{ height: '100%' }}
                    className="custom-scrollbar px-0 py-2"
                    components={{
                      Header: () => (
                        hasMoreMessages ? (
                          <div className="flex justify-center py-3">
                            {loadingOlderMessages ? (
                              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleLoadOlder()}
                                className="rounded-full bg-surface-2 px-4 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-3"
                              >
                                Load earlier messages
                              </button>
                            )}
                          </div>
                        ) : null
                      ),
                      ScrollSeekPlaceholder: ({ height, index }: { height: number; index: number }) => {
                        // During fast scrolling, render lightweight placeholder at pretext height
                        const adjustedIndex = index - firstItemIndex;
                        const msg = messages[adjustedIndex];
                        const h = msg ? getItemHeight(adjustedIndex) : (height || 48);
                        return (
                          <div className="w-full px-3 md:px-6" style={{ height: h }}>
                            <div className="flex gap-3 px-3 py-1">
                              <div className="h-9 w-9 shrink-0 rounded-full bg-surface-2" />
                              <div className="flex-1 rounded-lg bg-surface-2" style={{ height: Math.max(h - 16, 16), maxWidth: '70%' }} />
                            </div>
                          </div>
                        );
                      },
                    }}
                  />
                )}

                {/* New-messages pill — floats over the feed */}
                {newMessagesPending > 0 && !atBottom && (
                  <button
                    type="button"
                    onClick={() => {
                      virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
                      setNewMessagesPending(0);
                    }}
                    className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-brand-green px-4 py-1.5 text-xs font-semibold text-white shadow-float hover:opacity-90"
                  >
                    ↓ {newMessagesPending} new message{newMessagesPending > 1 ? 's' : ''}
                  </button>
                )}
              </div>

              {/* Accessibility: announce incoming messages */}
              <div role="status" aria-live="polite" className="sr-only">{announce}</div>

              {/* Composer — slim feed bar on Channels, full card on DMs */}
              <MessageComposer
                onSend={handleSendMessage}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                communityId={communityCtx?.currentCommunity?.id}
                typingLabel={typingLabel}
                onTyping={handleComposerTyping}
                conversationId={selectedConversationId}
                variant={channelsVariant ? 'slim' : 'full'}
                currentUser={channelsVariant ? currentUser : undefined}
                placeholder={
                  channelsVariant && selectedConversation
                    ? `Message #${selectedConversation.name}…`
                    : undefined
                }
              />
            </>
          )}
        </section>
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
