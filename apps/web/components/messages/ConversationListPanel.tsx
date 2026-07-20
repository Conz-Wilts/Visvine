'use client';

import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { Dispatch, ElementType, FormEvent, RefObject, SetStateAction } from 'react';
import { Plus, Search, X, Hash, MessageCircle, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { ChannelIcon, EmojiIconPicker } from './ChannelIcon';
import { formatChatTimestamp } from '@/lib/date';
import type { ChannelDirectoryEntry, ChannelSpaceEntry, ConversationSummary } from '@/lib/messages/types';
import type { MessageTab } from './messagesTabs';

/** Circle-style rail section: one per space (joined + browsable channels filed there), then an unfiled bucket. */
export interface ChannelSection {
  key: string;
  name: string;
  emoji: string | null;
  joined: ConversationSummary[];
  browsable: ChannelDirectoryEntry[];
}

interface ConversationListPanelProps {
  // Layout / docking
  docked: boolean;
  host: HTMLElement | null;
  channelsVariant: boolean;
  // Docked messages-variant header (title / new chat / tab switcher)
  onShowNewChat?: () => void;
  onTabChange?: (tab: MessageTab) => void;
  tabCounts?: Record<MessageTab, number>;
  tabs?: { id: MessageTab; label: string; icon: ElementType }[];
  // Sidebar search (docked panel header)
  sidebarSearchRef: RefObject<HTMLInputElement | null>;
  conversationSearch: string;
  setConversationSearch: (value: string) => void;
  // Tab + list data
  activeTab: MessageTab;
  conversationsLoading: boolean;
  filteredConversations: ConversationSummary[];
  channelSections: ChannelSection[];
  channelSpaces: ChannelSpaceEntry[];
  collapsedSpaces: Record<string, boolean>;
  toggleSpaceCollapsed: (key: string) => void;
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onJoinChannel: (channelId: string) => Promise<void>;
  joiningChannelId: string | null;
  communityIsAdmin: boolean | undefined;
  // Channel-creation form (community admins only)
  showChannelForm: boolean;
  setShowChannelForm: Dispatch<SetStateAction<boolean>>;
  onCreateChannel: (e: FormEvent) => Promise<void>;
  channelName: string;
  setChannelName: (value: string) => void;
  channelDescription: string;
  setChannelDescription: (value: string) => void;
  channelIcon: string | null;
  setChannelIcon: (value: string | null) => void;
  channelSpaceId: string;
  setChannelSpaceId: (value: string) => void;
  showIconPicker: boolean;
  setShowIconPicker: Dispatch<SetStateAction<boolean>>;
  creatingChannel: boolean;
  // Inline "new space" form (community admins only)
  showSpaceForm: boolean;
  setShowSpaceForm: Dispatch<SetStateAction<boolean>>;
  spaceName: string;
  setSpaceName: (value: string) => void;
  creatingSpace: boolean;
  onCreateSpace: (e: FormEvent) => Promise<void>;
  // Space rename/delete (community admins only)
  onRenameSpace: (spaceId: string, name: string) => Promise<void>;
  onDeleteSpace: (spaceId: string) => Promise<void>;
}

/**
 * List box — users or channels depending on the selected chip. On the
 * Channels page (wide) this same content is portaled into the Sidebar dock
 * instead of floating as its own box (see dockChannels).
 */
export default function ConversationListPanel({
  docked,
  host,
  channelsVariant,
  onShowNewChat,
  onTabChange,
  tabCounts,
  tabs,
  sidebarSearchRef,
  conversationSearch,
  setConversationSearch,
  activeTab,
  conversationsLoading,
  filteredConversations,
  channelSections,
  channelSpaces,
  collapsedSpaces,
  toggleSpaceCollapsed,
  selectedConversationId,
  onSelectConversation,
  onJoinChannel,
  joiningChannelId,
  communityIsAdmin,
  showChannelForm,
  setShowChannelForm,
  onCreateChannel,
  channelName,
  setChannelName,
  channelDescription,
  setChannelDescription,
  channelIcon,
  setChannelIcon,
  channelSpaceId,
  setChannelSpaceId,
  showIconPicker,
  setShowIconPicker,
  creatingChannel,
  showSpaceForm,
  setShowSpaceForm,
  spaceName,
  setSpaceName,
  creatingSpace,
  onCreateSpace,
  onRenameSpace,
  onDeleteSpace,
}: ConversationListPanelProps) {
  // Inline space rename (community admins): which space header is being edited.
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editingSpaceName, setEditingSpaceName] = useState('');
  const [spaceActionBusy, setSpaceActionBusy] = useState(false);

  const submitRenameSpace = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingSpaceId || !editingSpaceName.trim() || spaceActionBusy) return;
    setSpaceActionBusy(true);
    try {
      await onRenameSpace(editingSpaceId, editingSpaceName.trim());
      setEditingSpaceId(null);
      setEditingSpaceName('');
    } catch { /* error surfaced by the parent; keep the form open */ } finally {
      setSpaceActionBusy(false);
    }
  };

  const deleteSpace = async (spaceId: string) => {
    if (spaceActionBusy) return;
    setSpaceActionBusy(true);
    try {
      await onDeleteSpace(spaceId);
    } finally {
      setSpaceActionBusy(false);
    }
  };

  // The docked panel's own header: channel search up top. Channel creation
  // lives in the global sidebar "+" (Create new → Channel), not here. Only
  // rendered inside the Sidebar dock (the page's centered controls cover the
  // un-docked cases).
  const channelControls = channelsVariant ? (
    <div className="px-3 pb-2 pt-3">
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

  // The docked messages panel's header: title + "new chat" button and search —
  // everything that floats centered on the page in the un-docked layout moves
  // in here so the inbox reads as one attached sidebar (mirrors what other
  // pages do with the Sidebar dock).
  const messagesControls = !channelsVariant ? (
    <div className="space-y-2.5 px-3 pb-2 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary">Messages</span>
        {onShowNewChat && (
          <button
            type="button"
            onClick={onShowNewChat}
            title="New chat"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-green text-white shadow-sm transition-opacity hover:opacity-90 active:scale-95"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-border-default bg-surface-1 px-3 py-2 transition-colors focus-within:border-brand-green/40">
        <Search className="h-4 w-4 shrink-0 text-text-muted" />
        <input
          ref={sidebarSearchRef}
          value={conversationSearch}
          onChange={(e) => setConversationSearch(e.target.value)}
          placeholder="Search conversations…"
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {conversationSearch && (
          <button type="button" onClick={() => setConversationSearch('')} className="text-text-muted hover:text-text-secondary">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {onTabChange && tabs && tabs.length > 1 && (
        <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            const count = tabCounts?.[id] ?? 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onTabChange(id)}
                className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  active ? 'bg-brand-green text-white shadow-sm' : 'text-text-muted hover:text-text-secondary'
                }`}
                aria-label={`${label} tab`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                    active ? 'bg-white/25 text-white' : 'bg-brand-green/15 text-brand-dark-green'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const inbox = (
    <>
    {/* Docked panel gets its own title + New button + search up top */}
    {docked && (channelsVariant ? channelControls : messagesControls)}

    {/* Channel creation (community admins only) */}
    {activeTab === 'channels' && showChannelForm && (
      <form onSubmit={onCreateChannel} className="space-y-2 border-b border-border-subtle px-4 py-3">
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

          {!conversationsLoading && (activeTab === 'channels'
            ? channelSections.length === 0
            : filteredConversations.length === 0) && (
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
                  ? (communityIsAdmin
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
                    onClick={() => onSelectConversation(conversation.id)}
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
                const isSpace = section.key !== '__none__';
                const collapsed = Boolean(collapsedSpaces[section.key]);
                const sectionUnread = section.joined.reduce(
                  (sum, c) => sum + (selectedConversationId === c.id ? 0 : c.unreadCount),
                  0,
                );
                return (
                  <div key={section.key} className="pb-1.5">
                    {editingSpaceId === section.key ? (
                      <form onSubmit={submitRenameSpace} className="flex items-center gap-1.5 px-2 py-1">
                        <input
                          value={editingSpaceName}
                          onChange={(e) => setEditingSpaceName(e.target.value)}
                          autoFocus
                          maxLength={80}
                          className="min-w-0 flex-1 rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!editingSpaceName.trim() || spaceActionBusy}
                          className="shrink-0 rounded-full bg-brand-green px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                        >
                          {spaceActionBusy ? '…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingSpaceId(null); setEditingSpaceName(''); }}
                          className="shrink-0 text-text-muted hover:text-text-secondary"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    ) : (
                      <div className="group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
                        <button
                          type="button"
                          onClick={() => toggleSpaceCollapsed(section.key)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          {collapsed
                            ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2.5} />
                            : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2.5} />}
                          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted group-hover:text-text-secondary">
                            {section.emoji ? `${section.emoji} ` : ''}{section.name}
                          </span>
                        </button>
                        {collapsed && sectionUnread > 0 && (
                          <span className="shrink-0 rounded-full bg-brand-green px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            {sectionUnread > 99 ? '99+' : sectionUnread}
                          </span>
                        )}
                        {communityIsAdmin && isSpace && (
                          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              title="Rename space"
                              onClick={() => { setEditingSpaceId(section.key); setEditingSpaceName(section.name); }}
                              className="rounded p-0.5 text-text-muted hover:text-text-secondary"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              title="Delete space"
                              disabled={spaceActionBusy}
                              onClick={() => void deleteSpace(section.key)}
                              className="rounded p-0.5 text-text-muted hover:text-red-500 disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </div>
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
                              onClick={() => onSelectConversation(conversation.id)}
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
                                  onClick={() => void onJoinChannel(channel.id)}
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
          {activeTab === 'channels' && communityIsAdmin && (
            <div className="px-2.5 pt-1">
              {showSpaceForm ? (
                <form onSubmit={onCreateSpace} className="flex items-center gap-1.5 px-3 py-1">
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

    </div>
    </>
  );

  return docked
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
}
