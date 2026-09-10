import type { ConversationMemberRole, ConversationType } from '@prisma/client';

/** How a channel renders: classic chat thread or social-feed post cards. */
export type ChannelViewMode = 'CHAT' | 'FEED';

interface ConversationParticipant {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: ConversationMemberRole;
  lastReadAt: string | null;
}

interface SerializedMessageImage {
  id: string;
  imageUrl: string;
  position: number;
}

interface SerializedMessageMention {
  id: string;
  mentionedUserId: string | null;
  mentionedNodeId: string | null;
  mentionType: string;
}

export interface SerializedReaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

export interface SerializedReplyTo {
  id: string;
  text: string;
  senderName: string;
}

export interface SerializedLinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

export interface SerializedMessage {
  id: string;
  text: string;
  attachmentUrl: string | null;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    image: string | null;
  };
  isOwn: boolean;
  readByCount: number;
  recipientCount: number;
  isFullyReadByRecipients: boolean;
  // Rich messaging fields (optional for backward compat)
  editedAt?: string | null;
  deletedAt?: string | null;
  images?: SerializedMessageImage[];
  mentions?: SerializedMessageMention[];
  reactions?: SerializedReaction[];
  replyTo?: SerializedReplyTo | null;
  linkPreviews?: SerializedLinkPreview[];
  pinnedAt?: string | null;
  starred?: boolean;
}

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  name: string;
  description?: string | null;
  avatarUrl: string | null;
  /** Channel icon — the name of an owned icon; null renders the default hashtag. */
  icon?: string | null;
  /** Channel rendering style — absent means 'CHAT' (classic thread). */
  viewMode?: ChannelViewMode;
  /** Channel section (section) this channel is filed under, if any. */
  sectionId?: string | null;
  participants: ConversationParticipant[];
  lastMessage: SerializedMessage | null;
  unreadCount: number;
  updatedAt: string;
  currentUserRole: ConversationMemberRole;
}

/** A person from a space directory (Node of type "person"), surfaced in user search. */
export interface DirectoryPerson {
  id: string;
  name: string;
  subtitle: string | null;
  email: string | null;
  imageUrl: string | null;
  spaceName: string | null;
}

/** One row in a space's channel directory (joined or not). */
export interface ChannelDirectoryEntry {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  viewMode: ChannelViewMode;
  sectionId: string | null;
  memberCount: number;
  isMember: boolean;
}

/** A named section grouping channels in the rail (Circle-style section). */
export interface ChannelSectionEntry {
  id: string;
  name: string;
  /** Name of an owned icon shown before the section name, or null for none. */
  icon: string | null;
  position: number;
}

/** A pinned or saved message shown in the channel header panels. */
export interface SavedMessageEntry {
  id: string;
  conversationId: string;
  conversationName: string;
  text: string;
  senderName: string;
  createdAt: string;
  pinnedAt: string | null;
}

export interface ConversationMessagesPage {
  conversation: ConversationSummary;
  messages: SerializedMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface RealtimeMessageEvent {
  type: 'message.new';
  conversationId: string;
  message: SerializedMessage;
}

interface RealtimeMessageUpdatedEvent {
  type: 'message.updated';
  conversationId: string;
  message: SerializedMessage;
}

interface RealtimeMessageDeletedEvent {
  type: 'message.deleted';
  conversationId: string;
  messageId: string;
}

interface RealtimeConversationEvent {
  type: 'conversation.updated';
  conversationId: string;
  /** Set when the change is one member's own read marker: the tab that
   *  wrote it has already patched its list and need not ask again. */
  readBy?: string;
}

interface RealtimeTypingEvent {
  type: 'typing';
  conversationId: string;
  userId: string;
  userName: string;
  isTyping: boolean;
}

interface RealtimeReactionEvent {
  type: 'reaction.added' | 'reaction.removed';
  conversationId: string;
  messageId: string;
  emoji: string;
  userId: string;
}

export type RealtimeEvent =
  | RealtimeMessageEvent
  | RealtimeMessageUpdatedEvent
  | RealtimeMessageDeletedEvent
  | RealtimeConversationEvent
  | RealtimeTypingEvent
  | RealtimeReactionEvent;
