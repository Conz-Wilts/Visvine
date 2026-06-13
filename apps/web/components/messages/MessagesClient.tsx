'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Plus, Search, X, ArrowLeft, UserPlus, Pencil, LogOut, Hash, MessageCircle } from 'lucide-react';
import { useHeader } from '@/lib/contexts/HeaderContext';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useMessageHeights } from '@/hooks/useMessageHeights';
import type {
  ChannelDirectoryEntry,
  ConversationSummary,
  RealtimeEvent,
  SerializedMessage,
  SerializedReplyTo,
} from '@/lib/messages/types';
import NewChatModal from './NewChatModal';
import MessageComposer from './MessageComposer';
import MessageRow, { formatChatTimestamp, mergeMessages } from './MessageRow';
import ProfilePanel from './ProfilePanel';
import Avatar from '@/components/ui/Avatar';
import { MessagesTabSelector, formatDateLabel, type MessageTab } from './messagesTabs';
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
}

/** Messages within this window of the previous message from the same sender share a header. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessagesClient({ currentUser, initialConversationId, initialTab }: MessagesClientProps) {
  const { setHeaderContent } = useHeader();
  const communityCtx = useCommunity();

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
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showAddMembersModal, setShowAddMembersModal] = useState(false);
  const [activeTab, setActiveTab] = useState<MessageTab>(initialTab ?? 'direct');
  const [introItems, setIntroItems] = useState<IntroItem[]>([]);
  const [introsLoading, setIntrosLoading] = useState(true);
  const [channelDirectory, setChannelDirectory] = useState<ChannelDirectoryEntry[]>([]);
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [creatingChannel, setCreatingChannel] = useState(false);
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
        window.history.replaceState(null, '', '/messages');
      }
    } catch (fetchError) {
      setError((fetchError as Error).message || 'Failed to load conversations.');
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  const communityId = communityCtx?.currentCommunity?.id;

  const fetchChannels = useCallback(async () => {
    if (!communityId) return;
    try {
      const res = await fetch(`/api/messages/channels?communityId=${encodeURIComponent(communityId)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      setChannelDirectory(payload.channels ?? []);
    } catch { /* best-effort */ }
  }, [communityId]);

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
      // Deep links to a channel should land on the Channels tab.
      if (payload.conversation?.type === 'CHANNEL') setActiveTab('channels');
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

  // Header: inject nothing for messages page — the page is self-contained
  useEffect(() => {
    setHeaderContent(null);
    return () => setHeaderContent(null);
  }, [setHeaderContent]);

  useEffect(() => { selectedConversationRef.current = selectedConversationId; }, [selectedConversationId]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { setSelectedConversationId(initialConversationId ?? null); }, [initialConversationId]);
  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);

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
    const update = () => setIsMobile(window.innerWidth < 768);
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

  // Web push subscription (best-effort; only if VAPID configured server-side)
  useEffect(() => {
    (async () => {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      try {
        const res = await fetch('/api/push/subscribe');
        const { publicKey } = await res.json();
        if (!publicKey) return;
        const permission = Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
        if (permission !== 'granted') return;
        const reg = await navigator.serviceWorker.register('/sw.js');
        const existing = await reg.pushManager.getSubscription();
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch { /* ignore */ }
    })();
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
            // Report delivered immediately
            if (!normalized.isOwn) {
              void fetch(`/api/messages/conversations/${payload.conversationId}/messages/${normalized.id}/delivery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: 'delivered' }),
              }).catch(() => {});
            }
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
            setMessages((prev) => prev.map((m) => m.id === updated.id ? updated : m));
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
    window.history.pushState(null, '', `/messages/${id}`);
  };

  const handleBackToList = () => {
    clearTypingSignal(selectedConversationRef.current);
    setSelectedConversationId(null);
    selectedConversationRef.current = null;
    setMessages([]);
    setActiveConversation(null);
    setTypingUsers({});
    setReplyTo(null);
    window.history.pushState(null, '', '/messages');
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
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create the channel');
      setChannelName('');
      setChannelDescription('');
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
  // Intros render as a centered list with inline actions — no thread opens there.
  const hasOpenThread = activeTab !== 'intros' && Boolean(selectedConversationId);
  const showInbox = !isMobile || !hasOpenThread;
  const showThread = !isMobile || hasOpenThread;
  const showProfile = !isMobile && activeTab !== 'intros' && Boolean(selectedConversation);
  // On mobile, give the open thread the full viewport — hide the centered controls.
  const showCenterControls = !isMobile || !hasOpenThread;

  // ─── Render ─────────────────────────────────────────────────────────────────

  // The auth shell wraps pages in mt-20 + pt-4 + pb-6 (120px) — fill the rest.
  return (
    <div className="flex h-[calc(100dvh-120px)] min-h-0 w-full flex-col px-6">

      {/* ── Page header — centered title, consistent with other pages ───── */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 pt-2 pb-0">
        <div />
        <h1 className="text-4xl md:text-6xl font-normal tracking-tight text-text-primary font-ginto text-center">Messages</h1>
        <div className="justify-self-end">
          {activeTab === 'channels' ? (
            communityCtx?.isAdmin && (
              <button
                type="button"
                onClick={() => setShowChannelForm((v) => !v)}
                className="flex items-center gap-1.5 rounded-full bg-brand-green px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                <span className="hidden sm:inline">New Channel</span>
              </button>
            )
          ) : (
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

      {/* ── Centered controls: search + tab switcher, same as other pages ── */}
      {showCenterControls && (
        <div className="flex flex-col items-center gap-3 pt-6 pb-5">
          <div className="w-full max-w-2xl">
            <div className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-border-default bg-surface-1 px-4 shadow-sm transition-colors focus-within:border-brand-green/40">
              <Search className="h-4 w-4 shrink-0 text-text-muted" />
              <input
                ref={sidebarSearchRef}
                value={conversationSearch}
                onChange={(e) => setConversationSearch(e.target.value)}
                placeholder={activeTab === 'intros' ? 'Search introductions…' : 'Search conversations…'}
                className="flex-1 bg-transparent text-base text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              {conversationSearch && (
                <button type="button" onClick={() => setConversationSearch('')} className="text-text-muted hover:text-text-secondary">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <MessagesTabSelector activeTab={activeTab} onTabChange={setActiveTab} counts={tabCounts} />
        </div>
      )}

      {/* ── List box · open thread · profile box (Chats / Channels) ───────── */}
      {activeTab !== 'intros' && (
      <div className="flex min-h-0 w-full flex-1 items-stretch gap-6 pb-2 md:gap-12 md:px-6">

      {/* ╭── List box — users or channels depending on the selected chip ──╮ */}
      {showInbox && (
        <aside className="flex w-full min-h-0 flex-col overflow-hidden rounded-3xl bg-surface-1 shadow-float md:w-80 md:shrink-0">

          {/* Channel creation (community admins only) */}
          {activeTab === 'channels' && showChannelForm && (
            <form onSubmit={handleCreateChannel} className="space-y-2 border-b border-border-subtle px-4 py-3">
              <input
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="Channel name"
                autoFocus
                maxLength={80}
                className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none"
              />
              <input
                value={channelDescription}
                onChange={(e) => setChannelDescription(e.target.value)}
                placeholder="Description (optional)"
                maxLength={500}
                className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowChannelForm(false); setChannelName(''); setChannelDescription(''); }}
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
                        <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface-3" />
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
                          ? 'Create the first channel with the + button above.'
                          : 'Channels created by your community admins will appear here.')
                        : 'Start one with the + button above.'}
                    </p>
                  </div>
                )}

                {!conversationsLoading && filteredConversations.length > 0 && (
                  <div className="px-2.5 py-1">
                    {filteredConversations.map((conversation) => {
                      const isActive = selectedConversationId === conversation.id;
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
                            {conversation.unreadCount > 0 && !isActive && (
                              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface-1 bg-brand-green" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className={`truncate text-sm ${isActive || conversation.unreadCount > 0 ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary'}`}>
                                {conversation.type === 'CHANNEL' ? `#${conversation.name}` : conversation.name}
                              </p>
                              <span className="shrink-0 text-[11px] text-text-muted">
                                {formatChatTimestamp(conversation.lastMessage?.createdAt ?? conversation.updatedAt)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className={`truncate text-xs ${conversation.unreadCount > 0 && !isActive ? 'font-medium text-text-secondary' : 'text-text-muted'}`}>
                                {conversation.lastMessage?.text ?? 'No messages yet'}
                              </p>
                              {conversation.unreadCount > 0 && !isActive && (
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

                {/* Channel directory: community channels the user hasn't joined yet */}
                {activeTab === 'channels' && browsableChannels.length > 0 && (
                  <div className="px-2.5 py-1">
                    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      Browse channels
                    </p>
                    {browsableChannels.map((channel) => (
                      <div
                        key={channel.id}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-surface-2"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-sm font-semibold text-text-muted">
                          #
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text-secondary">#{channel.name}</p>
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
                  </div>
                )}
              </>
            )}

          </div>
        </aside>
      )}

      {/* ╭── Thread — open on the page, just floating message bubbles ─────╮ */}
      {showThread && (
        <section className="flex w-full min-w-0 flex-1 flex-col overflow-hidden">

          {/* ── Conversation thread ── */}
          {!selectedConversation && (
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
              <header className="flex items-center justify-between gap-3 px-5 py-3">
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
                  <div className="hidden sm:block">
                    <Avatar name={selectedConversation.name} size="lg" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {selectedConversation.type === 'CHANNEL' ? `#${selectedConversation.name}` : selectedConversation.name}
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
                        <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-surface-3" />
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
                        <div className="w-full px-3 md:px-6" data-message-id={message.id}>
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
                            onReply={setReplyTo}
                            onReaction={handleReaction}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onScrollToMessage={handleScrollToMessage}
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

              {/* Composer — its own floating layer at the bottom of the thread */}
              <MessageComposer
                onSend={handleSendMessage}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                communityId={communityCtx?.currentCommunity?.id}
                typingLabel={typingLabel}
                onTyping={handleComposerTyping}
                conversationId={selectedConversationId}
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
