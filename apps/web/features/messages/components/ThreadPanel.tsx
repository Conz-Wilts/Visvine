'use client';

import type { Dispatch, KeyboardEvent, MutableRefObject, RefObject, SetStateAction } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ArrowLeftIcon, HashIcon, LogOutIcon, PencilIcon, PlusIcon, SearchIcon, StarIcon, UserPlusIcon, XIcon } from '@/features/shared/icons';
import Avatar from '@/components/ui/Avatar';
import { ChannelIcon, ChannelIconPicker } from './ChannelIcon';
import MessageComposer from './MessageComposer';
import MessageRow from './MessageRow';
import FeedView from './FeedView';
import { formatChatTimestamp, formatDateLabel } from '@/lib/date';
import type {
  ConversationSummary,
  SavedMessageEntry,
  SerializedMessage,
  SerializedReplyTo,
} from '@/lib/messages/types';

/** Messages within this window of the previous message from the same sender share a header. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

interface ThreadPanelProps {
  selectedConversation: ConversationSummary | null;
  selectedConversationId: string | null;
  currentUser: { id: string; name: string; image: string | null };
  isMobile: boolean;
  isAdmin: boolean;
  spaceIsAdmin: boolean | undefined;
  spaceId: string | undefined;
  /** Whether the channel list has any joined channels (drives the empty-state copy). */
  hasChannelsInList: boolean;
  onShowChannelForm: () => void;
  onShowAddMembers: () => void;
  onBackToList: () => void;
  // Channel header extras
  showHeaderIconPicker: boolean;
  setShowHeaderIconPicker: Dispatch<SetStateAction<boolean>>;
  updateSelectedChannel: (patch: { icon?: string | null; viewMode?: 'CHAT' | 'FEED' }) => Promise<void>;
  headerPanel: 'saved' | null;
  setHeaderPanel: Dispatch<SetStateAction<'saved' | null>>;
  openHeaderPanel: (panel: 'saved') => Promise<void>;
  panelItems: SavedMessageEntry[];
  panelLoading: boolean;
  onPanelItemClick: (item: SavedMessageEntry) => void;
  // In-conversation search
  showMessageSearch: boolean;
  setShowMessageSearch: Dispatch<SetStateAction<boolean>>;
  messageSearch: string;
  setMessageSearch: (value: string) => void;
  // Thread content
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesLoading: boolean;
  messages: SerializedMessage[];
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  firstItemIndex: number;
  hasMoreMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlder: () => Promise<void>;
  unreadMarker: string | null;
  getItemHeight: (index: number) => number;
  atBottom: boolean;
  atBottomRef: MutableRefObject<boolean>;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  newMessagesPending: number;
  setNewMessagesPending: Dispatch<SetStateAction<number>>;
  announce: string;
  // Message actions
  replyTo: SerializedReplyTo | null;
  setReplyTo: Dispatch<SetStateAction<SerializedReplyTo | null>>;
  onReaction: (messageId: string, emoji: string) => Promise<void>;
  onEdit: (messageId: string, text: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onScrollToMessage: (messageId: string) => void;
  onToggleStar: (messageId: string) => Promise<void>;
  // Composer
  onSendMessage: (payload: {
    text: string;
    imageUrls?: string[];
    mentions?: Array<{ mentionedUserId?: string; mentionedNodeId?: string; mentionType: string }>;
    replyToId?: string;
  }) => Promise<void>;
  typingLabel: string | null;
  onComposerTyping: () => void;
  // Channel management
  onLeaveChannel: () => Promise<void>;
  onRenameChannel: () => Promise<void>;
  // Slack-style docked details pane
  detailsShown?: boolean;
  onToggleDetails?: () => void;
}

/** Thread — the open channel, as a chat thread or a flat feed. */
export default function ThreadPanel({
  selectedConversation,
  selectedConversationId,
  currentUser,
  isMobile,
  isAdmin,
  spaceIsAdmin,
  spaceId,
  hasChannelsInList,
  onShowChannelForm,
  onShowAddMembers,
  onBackToList,
  showHeaderIconPicker,
  setShowHeaderIconPicker,
  updateSelectedChannel,
  headerPanel,
  setHeaderPanel,
  openHeaderPanel,
  panelItems,
  panelLoading,
  onPanelItemClick,
  showMessageSearch,
  setShowMessageSearch,
  messageSearch,
  setMessageSearch,
  messagesContainerRef,
  messagesLoading,
  messages,
  virtuosoRef,
  firstItemIndex,
  hasMoreMessages,
  loadingOlderMessages,
  onLoadOlder,
  unreadMarker,
  getItemHeight,
  atBottom,
  atBottomRef,
  setAtBottom,
  newMessagesPending,
  setNewMessagesPending,
  announce,
  replyTo,
  setReplyTo,
  onReaction,
  onEdit,
  onDelete,
  onScrollToMessage,
  onToggleStar,
  onSendMessage,
  typingLabel,
  onComposerTyping,
  onLeaveChannel,
  onRenameChannel,
  detailsShown,
  onToggleDetails,
}: ThreadPanelProps) {
  // Feed-style channels swap the chat thread + bottom composer for FeedView
  // (post cards, composer on top); the header/search chrome stays shared.
  const isFeed = selectedConversation?.viewMode === 'FEED';

  return (
    <section className="flex w-full min-w-0 flex-1 flex-col overflow-hidden bg-surface-1">

      {/* ── Empty state when no channel is open ── */}
      {!selectedConversation && (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-surface-2">
            <HashIcon className="h-9 w-9 text-text-muted" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-base font-semibold text-text-primary">No channel selected</p>
            <p className="mt-1 text-sm text-text-muted">
              {hasChannelsInList
                ? 'Pick a channel from the list to open its feed.'
                : spaceIsAdmin
                  ? 'Create your first channel to start a feed.'
                  : 'Channels created by your section admins will appear here.'}
            </p>
          </div>
          {spaceIsAdmin && (
            <button
              type="button"
              onClick={onShowChannelForm}
              className="mt-2 flex items-center gap-2 rounded-lg bg-brand-green px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
              New channel
            </button>
          )}
        </div>
      )}

      {selectedConversation && (
        <>
          {/* Channel header */}
          <header className="relative flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {isMobile && (
                <button
                  type="button"
                  onClick={onBackToList}
                  className="mr-1 rounded-lg p-1.5 text-text-muted hover:bg-surface-3"
                >
                  <ArrowLeftIcon className="h-5 w-5" />
                </button>
              )}
              <div
                className={`min-w-0 ${onToggleDetails ? 'cursor-pointer rounded-lg px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors hover:bg-surface-2' : ''}`}
                {...(onToggleDetails ? {
                  role: 'button' as const,
                  tabIndex: 0,
                  title: detailsShown ? 'Hide channel details' : 'Show channel details',
                  onClick: onToggleDetails,
                  onKeyDown: (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleDetails(); }
                  },
                } : {})}
              >
                <p className="flex items-center gap-1.5 truncate text-lg font-bold text-text-primary">
                  {isAdmin ? (
                    <span className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setShowHeaderIconPicker((v) => !v)}
                        title="Change channel icon"
                        className="flex items-center justify-center rounded-md p-0.5 transition-colors hover:bg-surface-2"
                      >
                        <ChannelIcon icon={selectedConversation.icon} fallback={isFeed ? 'feed' : 'hash'} className="h-5 w-5" />
                      </button>
                      {showHeaderIconPicker && (
                        <span className="absolute left-0 top-7 z-30">
                          <ChannelIconPicker
                            onSelect={(icon) => void updateSelectedChannel({ icon })}
                            onClear={selectedConversation.icon ? () => void updateSelectedChannel({ icon: null }) : undefined}
                            onClose={() => setShowHeaderIconPicker(false)}
                          />
                        </span>
                      )}
                    </span>
                  ) : (
                    <ChannelIcon icon={selectedConversation.icon} fallback={isFeed ? 'feed' : 'hash'} className="h-5 w-5" />
                  )}
                  <span className="truncate">{selectedConversation.name}</span>
                </p>
                {/* Only the icon + name here — members/description live in the
                    Details pane and the member cluster on the right. */}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {/* Slack-style member cluster — toggles the docked Details pane */}
              {onToggleDetails && (
                <button
                  type="button"
                  onClick={onToggleDetails}
                  aria-pressed={detailsShown}
                  title={detailsShown ? 'Hide channel details' : 'Show channel details'}
                  className={`hidden items-center gap-1.5 rounded-lg border border-border-subtle px-2 py-1 transition-colors xl:flex ${detailsShown ? 'bg-brand-green/10' : 'hover:bg-surface-2'}`}
                >
                  <span className="flex -section-x-1.5">
                    {selectedConversation.participants.slice(0, 3).map((p) => (
                      <Avatar key={p.id} name={p.name} imageUrl={p.image} size="sm" className="!h-5 !w-5 !text-[9px] ring-2 ring-surface-1" />
                    ))}
                  </span>
                  <span className="text-xs font-medium text-text-secondary">{selectedConversation.participants.length}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void openHeaderPanel('saved')}
                className={`rounded-lg p-2 transition-colors ${headerPanel === 'saved' ? 'bg-brand-green/10 text-brand-dark-green' : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'}`}
                title="Saved messages"
              >
                <StarIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowMessageSearch((v) => !v)}
                className={`rounded-lg p-2 transition-colors ${showMessageSearch ? 'bg-brand-green/10 text-brand-dark-green' : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'}`}
                title="Search in conversation"
              >
                <SearchIcon className="h-4 w-4" />
              </button>

              {/* Below xl the details layer is hidden — keep management actions here */}
              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={onShowAddMembers}
                    className="hidden rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-secondary md:block xl:hidden"
                    title="Add members"
                  >
                    <UserPlusIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onRenameChannel}
                    className="hidden rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-secondary md:block xl:hidden"
                    title="Rename channel"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={onLeaveChannel}
                className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 xl:hidden"
                title="Leave channel"
              >
                <LogOutIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Saved-messages dropdown panel */}
            {headerPanel && (
              <div className="custom-scrollbar absolute right-4 top-full z-30 max-h-96 w-80 overflow-y-auto rounded-xl bg-surface-1 p-2 shadow-float">
                <div className="flex items-center justify-between px-2 pb-1 pt-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Your saved messages
                  </p>
                  <button type="button" onClick={() => setHeaderPanel(null)} className="text-text-muted hover:text-text-secondary">
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                {panelLoading && (
                  <p className="px-2 py-4 text-center text-xs text-text-muted">Loading…</p>
                )}
                {!panelLoading && panelItems.length === 0 && (
                  <p className="px-2 py-4 text-center text-xs text-text-muted">
                    Nothing saved yet — hover a message and hit the star.
                  </p>
                )}
                {!panelLoading && panelItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onPanelItemClick(item)}
                    className="block w-full rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2"
                  >
                    <p className="truncate text-xs font-semibold text-text-primary">
                      {item.senderName}
                      <span className="font-normal text-text-muted">
                        {' · '}{formatChatTimestamp(item.createdAt)}
                        {item.conversationId !== selectedConversationId
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
                <SearchIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <input
                  value={messageSearch}
                  onChange={(e) => setMessageSearch(e.target.value)}
                  placeholder="Search in this conversation…"
                  autoFocus
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                />
                {messageSearch && (
                  <button type="button" onClick={() => setMessageSearch('')} className="text-text-muted hover:text-text-secondary">
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Feed-style channel: post cards with composer on top */}
          {isFeed && (
            <div ref={messagesContainerRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <FeedView
                conversation={selectedConversation}
                messages={messages}
                messagesLoading={messagesLoading}
                currentUser={currentUser}
                hasMoreMessages={hasMoreMessages}
                loadingOlderMessages={loadingOlderMessages}
                onLoadOlder={onLoadOlder}
                onSendMessage={onSendMessage}
                onReaction={onReaction}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleStar={onToggleStar}
                spaceId={spaceId}
              />
            </div>
          )}

          {/* Linear message feed */}
          {!isFeed && (
          <div ref={messagesContainerRef} className="relative flex-1 overflow-hidden">
            {messagesLoading && (
              <div className="w-full section-y-4 px-6 py-5 md:px-8">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-surface-3" />
                    <div className="flex-1 section-y-2 pt-1">
                      <div className="h-3 w-40 animate-pulse rounded bg-surface-3" />
                      <div className="h-3 animate-pulse rounded bg-surface-3" style={{ width: `${85 - i * 12}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!messagesLoading && messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-sm text-text-muted">
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
                    void onLoadOlder();
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
                      className="w-full px-2 md:px-4"
                      data-message-id={message.id}
                    >
                      {showDateSeparator && (
                        <div className="my-4 flex items-center gap-0 px-3">
                          <div className="h-px flex-1 bg-border-subtle" />
                          <span className="px-3 text-xs font-semibold text-text-muted">
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
                        variant="feed"
                        onReply={setReplyTo}
                        onReaction={onReaction}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onScrollToMessage={onScrollToMessage}
                        onToggleStar={onToggleStar}
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
                            onClick={() => void onLoadOlder()}
                            className="rounded-md bg-surface-2 px-4 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-3"
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
                className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-brand-green px-4 py-1.5 text-xs font-semibold text-white shadow-float hover:opacity-90"
              >
                ↓ {newMessagesPending} new message{newMessagesPending > 1 ? 's' : ''}
              </button>
            )}
          </div>
          )}

          {/* Accessibility: announce incoming messages */}
          <div role="status" aria-live="polite" className="sr-only">{announce}</div>

          {/* Composer — slim feed bar. Feed mode has its own top composer
              inside FeedView. */}
          {!isFeed && (
          <MessageComposer
            onSend={onSendMessage}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            spaceId={spaceId}
            typingLabel={typingLabel}
            onTyping={onComposerTyping}
            conversationId={selectedConversationId}
            variant="slim"
            currentUser={currentUser}
            placeholder={`${selectedConversation.name}…`}
          />
          )}
        </>
      )}
    </section>
  );
}
