'use client';

/**
 * ProfilePanel — the right-hand details layer on the Channels page: the open
 * channel's description, view style and member list, with admin management
 * actions.
 */

import { Tabs, Avatar } from '@visvine/ui';
import { HashIcon, LogOutIcon, MessageCircleIcon, FeedIcon, PencilIcon, UserPlusIcon, XIcon } from '@/features/shared/icons';
import type { ChannelViewMode, ConversationSummary } from '@/lib/messages/types';

export interface ProfilePanelProps {
  conversation: ConversationSummary;
  currentUserId: string;
  isAdmin: boolean;
  onAddMembers: () => void;
  onRename: () => void;
  onLeave: () => void;
  onRemoveMember: (memberUserId: string) => void;
  /** Change a channel's rendering style (chat thread vs feed cards); admin-only UI. */
  onChangeViewMode?: (mode: ChannelViewMode) => void;
  /** When set (docked Slack-style pane), the header gains a close button. */
  onClose?: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{children}</p>;
}

function ChannelDetails({ conversation, currentUserId, isAdmin, onAddMembers, onRename, onLeave, onRemoveMember, onChangeViewMode }: ProfilePanelProps) {
  const viewMode: ChannelViewMode = conversation.viewMode ?? 'CHAT';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Identity */}
      <div className="flex flex-col items-center px-6 pb-5 pt-7 text-center">
        <p className="flex items-center gap-1 text-base font-semibold text-fg">
          <HashIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />
          <span>{conversation.name}</span>
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {conversation.participants.length} member{conversation.participants.length === 1 ? '' : 's'}
        </p>
        {conversation.description && (
          <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{conversation.description}</p>
        )}
      </div>

      {/* View style (channel admins): chat thread vs feed cards — lossless
          rendering switch over the same messages, flip any time. */}
      {isAdmin && onChangeViewMode && (
        <div className="section-y-1.5 px-5 pb-4">
          <SectionLabel>View style</SectionLabel>
          <Tabs
            size="sm"
            value={viewMode}
            onChange={(mode) => { if (mode !== viewMode) onChangeViewMode(mode); }}
            options={[
              { id: 'CHAT' as const, label: 'Chat', icon: <MessageCircleIcon className="h-3.5 w-3.5" /> },
              { id: 'FEED' as const, label: 'Feed', icon: <FeedIcon className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>
      )}

      {/* Members */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="px-2.5 pb-1.5"><SectionLabel>Members</SectionLabel></div>
        {conversation.participants.map((p) => (
          <div key={p.id} className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-subtle">
            <Avatar name={p.name} imageUrl={p.image} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">
                {p.id === currentUserId ? `${p.name} (you)` : p.name}
              </p>
              {p.role === 'ADMIN' && <p className="text-[11px] text-fg-muted">Admin</p>}
            </div>
            {isAdmin && p.id !== currentUserId && (
              <button
                type="button"
                onClick={() => onRemoveMember(p.id)}
                className="hidden rounded-full p-1 text-fg-muted hover:bg-surface-muted hover:text-danger-bright group-hover:block"
                aria-label={`Remove ${p.name}`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="section-y-0.5 border-t border-line-subtle px-3 py-3">
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={onAddMembers}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-fg-secondary transition-colors hover:bg-surface-subtle hover:text-fg"
            >
              <UserPlusIcon className="h-4 w-4 text-fg-muted" />
              Add members
            </button>
            <button
              type="button"
              onClick={onRename}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-fg-secondary transition-colors hover:bg-surface-subtle hover:text-fg"
            >
              <PencilIcon className="h-4 w-4 text-fg-muted" />
              Rename channel
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onLeave}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-danger-bright transition-colors hover:bg-danger-wash"
        >
          <LogOutIcon className="h-4 w-4" />
          Leave channel
        </button>
      </div>
    </div>
  );
}

export default function ProfilePanel(props: ProfilePanelProps) {
  const { onClose } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onClose ? (
        <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
          <p className="text-sm font-semibold text-fg">Details</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-fg-muted transition-colors hover:bg-surface-subtle hover:text-fg"
            aria-label="Close details"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="px-6 pt-5">
          <p className="text-sm font-semibold text-fg">Details</p>
        </div>
      )}
      <ChannelDetails {...props} />
    </div>
  );
}
