import type { ConversationMemberRole, ConversationType } from '@prisma/client';
import type { ConversationIntroContext } from '@/lib/intros/types';

export interface ConversationParticipant {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: ConversationMemberRole;
  lastReadAt: string | null;
}

export interface SerializedMessageImage {
  id: string;
  imageUrl: string;
  position: number;
}

export interface SerializedMessageMention {
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
  participants: ConversationParticipant[];
  lastMessage: SerializedMessage | null;
  unreadCount: number;
  updatedAt: string;
  currentUserRole: ConversationMemberRole;
}

/** One row in a community's channel directory (joined or not). */
export interface ChannelDirectoryEntry {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  isMember: boolean;
}

export interface ConversationMessagesPage {
  conversation: ConversationSummary;
  messages: SerializedMessage[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Present when this DM exists because of an accepted introduction. */
  intro?: ConversationIntroContext | null;
}

export interface RealtimeMessageEvent {
  type: 'message.new';
  conversationId: string;
  message: SerializedMessage;
}

export interface RealtimeMessageUpdatedEvent {
  type: 'message.updated';
  conversationId: string;
  message: SerializedMessage;
}

export interface RealtimeMessageDeletedEvent {
  type: 'message.deleted';
  conversationId: string;
  messageId: string;
}

export interface RealtimeConversationEvent {
  type: 'conversation.updated';
  conversationId: string;
}

export interface RealtimeTypingEvent {
  type: 'typing';
  conversationId: string;
  userId: string;
  userName: string;
  isTyping: boolean;
}

export interface RealtimeReactionEvent {
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
