'use client';

import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { ViewToggle } from '@/components/ui';
import { ChevronDownIcon, ChevronRightIcon, HashIcon, Icon, MessageCircleIcon, NewspaperIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from '@/features/shared/icons';
import { useCreateModal } from '@/features/shared/contexts/CreateModalContext';
import { ChannelIcon, ChannelIconPicker } from './ChannelIcon';
import type { ChannelDirectoryEntry, ChannelSectionEntry, ChannelViewMode, ConversationSummary } from '@/lib/messages/types';

/** Circle-style rail section: one per section (joined + browsable channels filed there), then an unfiled bucket. */
export interface ChannelListGroup {
  key: string;
  name: string;
  icon: string | null;
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
  channelGroups: ChannelListGroup[];
  channelSections: ChannelSectionEntry[];
  collapsedSections: Record<string, boolean>;
  toggleSectionCollapsed: (key: string) => void;
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onJoinChannel: (channelId: string) => Promise<void>;
  joiningChannelId: string | null;
  spaceIsAdmin: boolean | undefined;
  // Channel-creation form (space admins only)
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
  channelSectionId: string;
  setChannelSectionId: (value: string) => void;
  showIconPicker: boolean;
  setShowIconPicker: Dispatch<SetStateAction<boolean>>;
  creatingChannel: boolean;
  // Inline "new section" form (space admins only)
  showSectionForm: boolean;
  setShowSectionForm: Dispatch<SetStateAction<boolean>>;
  sectionName: string;
  setSectionName: (value: string) => void;
  creatingSection: boolean;
  onCreateSection: (e: FormEvent) => Promise<void>;
  // Section rename/delete (space admins only)
  onRenameSection: (sectionId: string, name: string) => Promise<void>;
  onDeleteSection: (sectionId: string) => Promise<void>;
}

/**
 * Channel rail — the space's channels grouped by section. On the Channels
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
  channelGroups,
  channelSections,
  collapsedSections,
  toggleSectionCollapsed,
  selectedConversationId,
  onSelectConversation,
  onJoinChannel,
  joiningChannelId,
  spaceIsAdmin,
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
  channelSectionId,
  setChannelSectionId,
  showIconPicker,
  setShowIconPicker,
  creatingChannel,
  showSectionForm,
  setShowSectionForm,
  sectionName,
  setSectionName,
  creatingSection,
  onCreateSection,
  onRenameSection,
  onDeleteSection,
}: ConversationListPanelProps) {
  // Creating channels + sections lives in the global "Create new" (+) modal.
  const { open: openCreateModal } = useCreateModal();
  // Inline section rename (space admins): which section header is being edited.
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState('');
  const [sectionActionBusy, setSectionActionBusy] = useState(false);

  const submitRenameSection = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingSectionId || !editingSectionName.trim() || sectionActionBusy) return;
    setSectionActionBusy(true);
    try {
      await onRenameSection(editingSectionId, editingSectionName.trim());
      setEditingSectionId(null);
      setEditingSectionName('');
    } catch { /* error surfaced by the parent; keep the form open */ } finally {
      setSectionActionBusy(false);
    }
  };

  const deleteSection = async (sectionId: string) => {
    if (sectionActionBusy) return;
    setSectionActionBusy(true);
    try {
      await onDeleteSection(sectionId);
    } finally {
      setSectionActionBusy(false);
    }
  };

  // The list's own header: channel search up top, wherever the list lives.
  // Channel creation lives in the global sidebar "+" (Create new → Channel),
  // not here.
  const channelControls = (
    <div className="px-3 pb-2 pt-3">
      <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 transition-colors focus-within:bg-surface-1 focus-within:ring-1 focus-within:ring-border-default">
        <SearchIcon className="h-4 w-4 shrink-0 text-text-muted" />
        <input
          ref={sidebarSearchRef}
          value={conversationSearch}
          onChange={(e) => setConversationSearch(e.target.value)}
          placeholder="Search channels…"
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {conversationSearch && (
          <button type="button" onClick={() => setConversationSearch('')} className="text-text-muted hover:text-text-secondary">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  const inbox = (
    <>
    {channelControls}

    {/* Channel creation (space admins only) */}
    {showChannelForm && (
      <form onSubmit={onCreateChannel} className="section-y-2 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowIconPicker((v) => !v)}
              title="Channel icon (default #)"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-text-secondary transition-colors hover:bg-surface-3"
            >
              <ChannelIcon icon={channelIcon} className="h-4 w-4" />
            </button>
            {showIconPicker && (
              <div className="absolute left-0 top-10 z-30">
                <ChannelIconPicker
                  onSelect={(icon) => setChannelIcon(icon)}
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
            className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:bg-surface-1 focus:outline-none focus:ring-1 focus:ring-border-default"
          />
        </div>
        <input
          value={channelDescription}
          onChange={(e) => setChannelDescription(e.target.value)}
          placeholder="Description (optional)"
          maxLength={500}
          className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:bg-surface-1 focus:outline-none focus:ring-1 focus:ring-border-default"
        />
        {/* View style: classic chat thread vs social-feed posts */}
          <ViewToggle
          size="sm"
          value={channelViewMode}
          onChange={setChannelViewMode}
          options={[
            { id: 'CHAT' as const, label: 'Chat', icon: <MessageCircleIcon className="h-3.5 w-3.5" /> },
            { id: 'FEED' as const, label: 'Feed', icon: <NewspaperIcon className="h-3.5 w-3.5" /> },
          ]}
        />
        {channelSections.length > 0 && (
          <select
            value={channelSectionId}
            onChange={(e) => setChannelSectionId(e.target.value)}
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-primary focus:bg-surface-1 focus:outline-none focus:ring-1 focus:ring-border-default"
          >
            <option value="">No section</option>
            {channelSections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => { setShowChannelForm(false); setChannelName(''); setChannelDescription(''); setChannelIcon(null); setChannelViewMode('CHAT'); setChannelSectionId(''); setShowIconPicker(false); }}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!channelName.trim() || creatingChannel}
            className="rounded-md bg-brand-green px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
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
            <div className="section-y-1 px-3 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl p-3">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-surface-3" />
                  <div className="flex-1 section-y-2">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-surface-3" />
                    <div className="h-2.5 w-1/2 animate-pulse rounded bg-surface-3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!conversationsLoading && channelGroups.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">
                <HashIcon className="h-6 w-6 text-text-muted" />
              </div>
              <p className="text-sm font-medium text-text-secondary">No channels yet</p>
              <p className="mt-1 text-xs text-text-muted">
                {spaceIsAdmin
                  ? 'Create the first channel with the + button in the sidebar.'
                  : 'Channels created by your section admins will appear here.'}
              </p>
            </div>
          )}

          {/* ── Channels grouped by section (Circle-style) ── */}
          {!conversationsLoading && channelGroups.length > 0 && (
            <div className="px-2.5 py-1">
              {channelGroups.map((section) => {
                const hasSections = channelSections.length > 0;
                const isSection = section.key !== '__none__';
                const collapsed = Boolean(collapsedSections[section.key]);
                const sectionUnread = section.joined.reduce(
                  (sum, c) => sum + (selectedConversationId === c.id ? 0 : c.unreadCount),
                  0,
                );
                return (
                  <div key={section.key} className="pb-1.5">
                    {editingSectionId === section.key ? (
                      /* Just an input — Enter saves, Escape cancels (no buttons). */
                      <form onSubmit={submitRenameSection} className="px-2 py-1">
                        <input
                          value={editingSectionName}
                          onChange={(e) => setEditingSectionName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setEditingSectionId(null); setEditingSectionName(''); } }}
                          autoFocus
                          disabled={sectionActionBusy}
                          maxLength={80}
                          className="w-full rounded-lg border border-border-default bg-surface-1 px-3 py-2 text-[15px] text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none disabled:opacity-50"
                        />
                      </form>
                    ) : (
                      <div className="group flex w-full items-center gap-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                        <button
                          type="button"
                          onClick={() => toggleSectionCollapsed(section.key)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          {collapsed
                            ? <ChevronRightIcon className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={2.5} />
                            : <ChevronDownIcon className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={2.5} />}
                          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[15px] font-semibold text-text-secondary group-hover:text-text-primary">
                            {section.icon && <Icon name={section.icon} className="h-4 w-4 shrink-0" strokeWidth={2} />}
                            <span className="truncate">{section.name}</span>
                          </span>
                        </button>
                        {collapsed && sectionUnread > 0 && (
                          <span className="shrink-0 rounded-full bg-brand-green px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            {sectionUnread > 99 ? '99+' : sectionUnread}
                          </span>
                        )}
                        {spaceIsAdmin && isSection && (
                          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              title="Rename section"
                              onClick={() => { setEditingSectionId(section.key); setEditingSectionName(section.name); }}
                              className="rounded p-0.5 text-text-muted hover:text-text-secondary"
                            >
                              <PencilIcon className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              title="Delete section"
                              disabled={sectionActionBusy}
                              onClick={() => void deleteSection(section.key)}
                              className="rounded p-0.5 text-text-muted hover:text-red-500 disabled:opacity-50"
                            >
                              <Trash2Icon className="h-3 w-3" />
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
                                isActive ? 'bg-surface-3' : 'hover:bg-surface-2'
                              }`}
                            >
                              <ChannelIcon
                                icon={conversation.icon}
                                fallback={conversation.viewMode === 'FEED' ? 'feed' : 'hash'}
                                className={`h-[18px] w-[18px] ${isActive || hasUnread ? 'text-text-primary' : 'text-text-muted'}`}
                              />
                              <p className={`min-w-0 flex-1 truncate text-[15px] ${
                                isActive || hasUnread ? 'font-semibold text-text-primary'
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
                            {!hasSections && (
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
                                  className="shrink-0 rounded-md border border-brand-green/40 px-3 py-1 text-xs font-semibold text-brand-dark-green transition-colors hover:bg-brand-green/10 disabled:opacity-50"
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

          {/* ── New section (space admins) ── */}
          {spaceIsAdmin && (
            <div className="px-2.5 pt-1">
              {/* Section form is just an input — Enter creates, Escape cancels. */}
              {showSectionForm ? (
                <form onSubmit={onCreateSection} className="px-3 py-1">
                  <input
                    value={sectionName}
                    onChange={(e) => setSectionName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setShowSectionForm(false); setSectionName(''); } }}
                    placeholder="Section name"
                    autoFocus
                    disabled={creatingSection}
                    maxLength={80}
                    className="w-full rounded-lg border border-border-default bg-surface-1 px-3 py-2 text-[15px] text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none disabled:opacity-50"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => openCreateModal('section')}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
                >
                  <PlusIcon className="h-[18px] w-[18px]" strokeWidth={2.5} />
                  New section
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
        // border-r: the channel list's right edge inside the shell card. The
        // docked column itself carries no seam, so the line lives on the
        // channel panel — without it the list bleeds into the thread.
        <div
          className="flex h-full min-h-0 flex-col overflow-hidden border-r border-border-subtle"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          {inbox}
        </div>,
        host as HTMLElement,
      )
    : (
      <aside className="flex w-full min-h-0 flex-col overflow-hidden border-r border-border-subtle md:w-80 md:shrink-0">
        {inbox}
      </aside>
    );
}
