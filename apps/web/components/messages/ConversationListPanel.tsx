'use client';

import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { Plus, Search, X, Hash, MessageCircle, ChevronDown, ChevronRight, Pencil, Trash2, Newspaper } from 'lucide-react';
import { useCreateModal } from '@/lib/contexts/CreateModalContext';
import { ChannelIcon, EmojiIconPicker } from './ChannelIcon';
import type { ChannelDirectoryEntry, ChannelSpaceEntry, ChannelViewMode, ConversationSummary } from '@/lib/messages/types';

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
  // Sidebar search (docked panel header)
  sidebarSearchRef: RefObject<HTMLInputElement | null>;
  conversationSearch: string;
  setConversationSearch: (value: string) => void;
  // List data
  conversationsLoading: boolean;
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
  channelViewMode: ChannelViewMode;
  setChannelViewMode: (value: ChannelViewMode) => void;
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
 * Channel rail — the community's channels grouped by space. On the Channels
 * page (wide) this content is portaled into the Sidebar dock instead of
 * floating as its own box (see dockChannels).
 */
export default function ConversationListPanel({
  docked,
  host,
  sidebarSearchRef,
  conversationSearch,
  setConversationSearch,
  conversationsLoading,
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
  channelViewMode,
  setChannelViewMode,
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
  // Creating channels + spaces lives in the global "Create new" (+) modal.
  const { open: openCreateModal } = useCreateModal();
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
  const channelControls = (
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
  );

  const inbox = (
    <>
    {/* Docked panel gets its own search up top */}
    {docked && channelControls}

    {/* Channel creation (community admins only) */}
    {showChannelForm && (
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
        {/* View style: classic chat thread vs social-feed post cards */}
        <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          {([
            { mode: 'CHAT' as const, label: 'Chat', icon: MessageCircle, title: 'Classic channel thread' },
            { mode: 'FEED' as const, label: 'Feed', icon: Newspaper, title: 'Post cards with comments' },
          ]).map(({ mode, label, icon: Icon, title }) => {
            const active = channelViewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                title={title}
                onClick={() => setChannelViewMode(mode)}
                className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  active ? 'bg-brand-green text-white shadow-sm' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
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
            onClick={() => { setShowChannelForm(false); setChannelName(''); setChannelDescription(''); setChannelIcon(null); setChannelViewMode('CHAT'); setChannelSpaceId(''); setShowIconPicker(false); }}
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

          {!conversationsLoading && channelSections.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">
                <Hash className="h-6 w-6 text-text-muted" />
              </div>
              <p className="text-sm font-medium text-text-secondary">No channels yet</p>
              <p className="mt-1 text-xs text-text-muted">
                {communityIsAdmin
                  ? 'Create the first channel with the + button in the sidebar.'
                  : 'Channels created by your community admins will appear here.'}
              </p>
            </div>
          )}

          {/* ── Channels grouped by space (Circle-style) ── */}
          {!conversationsLoading && channelSections.length > 0 && (
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
                      /* Just an input — Enter saves, Escape cancels (no buttons). */
                      <form onSubmit={submitRenameSpace} className="px-2 py-1">
                        <input
                          value={editingSpaceName}
                          onChange={(e) => setEditingSpaceName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setEditingSpaceId(null); setEditingSpaceName(''); } }}
                          autoFocus
                          disabled={spaceActionBusy}
                          maxLength={80}
                          className="w-full rounded-lg border border-border-default bg-surface-1 px-3 py-2 text-[15px] text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none disabled:opacity-50"
                        />
                      </form>
                    ) : (
                      <div className="group flex w-full items-center gap-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                        <button
                          type="button"
                          onClick={() => toggleSpaceCollapsed(section.key)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          {collapsed
                            ? <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={2.5} />
                            : <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={2.5} />}
                          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-secondary group-hover:text-text-primary">
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
                              onClick={() => { setEditingSpaceId(section.key); setEditingSpaceName(`${section.emoji ? `${section.emoji} ` : ''}${section.name}`); }}
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
                              className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors duration-150 ${
                                isActive ? 'bg-brand-green text-white' : 'hover:bg-surface-2'
                              }`}
                            >
                              <ChannelIcon
                                icon={conversation.icon}
                                fallback={conversation.viewMode === 'FEED' ? 'feed' : 'hash'}
                                className={`h-[18px] w-[18px] ${isActive ? 'text-white' : hasUnread ? 'text-text-primary' : 'text-text-muted'}`}
                              />
                              <p className={`min-w-0 flex-1 truncate text-[15px] ${
                                isActive ? 'font-semibold text-white'
                                : hasUnread ? 'font-semibold text-text-primary'
                                : 'font-normal text-text-secondary'}`}>
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
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-surface-2"
                              >
                                <ChannelIcon icon={channel.icon} fallback={channel.viewMode === 'FEED' ? 'feed' : 'hash'} className="mt-0.5 h-[18px] w-[18px] self-start text-text-muted" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[15px] font-normal text-text-secondary">{channel.name}</p>
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
          {communityIsAdmin && (
            <div className="px-2.5 pt-1">
              {/* Space form is just an input — Enter creates, Escape cancels. */}
              {showSpaceForm ? (
                <form onSubmit={onCreateSpace} className="px-3 py-1">
                  <input
                    value={spaceName}
                    onChange={(e) => setSpaceName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setShowSpaceForm(false); setSpaceName(''); } }}
                    placeholder="Space name"
                    autoFocus
                    disabled={creatingSpace}
                    maxLength={80}
                    className="w-full rounded-lg border border-border-default bg-surface-1 px-3 py-2 text-[15px] text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none disabled:opacity-50"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => openCreateModal('space')}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
                >
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} />
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
