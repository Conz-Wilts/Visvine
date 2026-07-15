import { ConversationMemberRole, ConversationType, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type {
  ConversationSummary,
  SerializedMessage,
  SerializedReaction,
} from './types';
import { toIsoStringOrNull } from './utils';

export const CONVERSATION_INCLUDE = {
  members: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  },
  messages: {
    take: 1,
    orderBy: {
      createdAt: 'desc' as const,
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          image: true,
        },
      },
    },
  },
};

export type ConversationWithContext = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

export const MESSAGE_INCLUDE = {
  sender: {
    select: {
      id: true,
      name: true,
      image: true,
    },
  },
  images: {
    orderBy: { position: 'asc' as const },
  },
  mentions: true,
  reactions: true,
  replyTo: {
    include: {
      sender: {
        select: { id: true, name: true, image: true },
      },
    },
  },
  linkPreviews: {
    include: {
      linkPreview: true,
    },
  },
  stars: {
    select: { userId: true },
  },
} satisfies Prisma.MessageInclude;

export type MessageWithRelations = Prisma.MessageGetPayload<{
  include: typeof MESSAGE_INCLUDE;
}>;

export class MessagingError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getConversationDisplayName(conversation: ConversationWithContext, currentUserId: string): string {
  if (conversation.type === ConversationType.CHANNEL) {
    return conversation.name?.trim() || 'Unnamed channel';
  }

  if (conversation.type === ConversationType.GROUP) {
    return conversation.name?.trim() || 'Unnamed group';
  }

  const peer = conversation.members.find((member) => member.userId !== currentUserId);
  return peer?.user.name || peer?.user.email || 'Direct message';
}

function getConversationAvatar(conversation: ConversationWithContext, currentUserId: string): string | null {
  if (conversation.type !== ConversationType.DM) {
    return conversation.avatarUrl;
  }

  const peer = conversation.members.find((member) => member.userId !== currentUserId);
  return peer?.user.image ?? null;
}

export function serializeMessage(
  message: MessageWithRelations,
  currentUserId: string,
  members: ConversationWithContext['members'],
): SerializedMessage {
  const recipients = members.filter((member) => member.userId !== message.senderId);
  const readByCount = recipients.filter((member) => {
    if (!member.lastReadAt) {
      return false;
    }

    return member.lastReadAt >= message.createdAt;
  }).length;

  const recipientCount = recipients.length;

  // Aggregate reactions: group by emoji, count, and check if current user reacted
  const reactionMap = new Map<string, { count: number; reacted: boolean }>();
  for (const r of message.reactions) {
    const existing = reactionMap.get(r.emoji);
    if (existing) {
      existing.count++;
      if (r.userId === currentUserId) existing.reacted = true;
    } else {
      reactionMap.set(r.emoji, { count: 1, reacted: r.userId === currentUserId });
    }
  }
  const reactions: SerializedReaction[] = Array.from(reactionMap.entries()).map(
    ([emoji, { count, reacted }]) => ({ emoji, count, reacted }),
  );

  return {
    id: message.id,
    text: message.deletedAt ? '' : message.text,
    attachmentUrl: message.attachmentUrl,
    createdAt: message.createdAt.toISOString(),
    sender: {
      id: message.sender.id,
      name: message.sender.name,
      image: message.sender.image,
    },
    isOwn: message.senderId === currentUserId,
    readByCount,
    recipientCount,
    isFullyReadByRecipients: recipientCount > 0 && readByCount === recipientCount,
    pinnedAt: message.pinnedAt?.toISOString() ?? null,
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    images: message.images.map((img) => ({
      id: img.id,
      imageUrl: img.imageUrl,
      position: img.position,
    })),
    mentions: message.mentions.map((m) => ({
      id: m.id,
      mentionedUserId: m.mentionedUserId,
      mentionedNodeId: m.mentionedNodeId,
      mentionType: m.mentionType,
    })),
    reactions,
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          text: message.replyTo.text.slice(0, 200),
          senderName: message.replyTo.sender.name,
        }
      : null,
    linkPreviews: message.linkPreviews.map((lp) => ({
      url: lp.linkPreview.url,
      title: lp.linkPreview.title,
      description: lp.linkPreview.description,
      imageUrl: lp.linkPreview.imageUrl,
      siteName: lp.linkPreview.siteName,
    })),
    starred: message.stars.some((star) => star.userId === currentUserId),
  };
}

/** Lightweight serializer for conversation list (last message only, no rich relations) */
function serializeMessageLight(
  message: Prisma.MessageGetPayload<{ include: { sender: { select: { id: true; name: true; image: true } } } }>,
  currentUserId: string,
  members: ConversationWithContext['members'],
): SerializedMessage {
  const recipients = members.filter((member) => member.userId !== message.senderId);
  const readByCount = recipients.filter((member) => {
    if (!member.lastReadAt) return false;
    return member.lastReadAt >= message.createdAt;
  }).length;
  const recipientCount = recipients.length;

  return {
    id: message.id,
    text: message.text,
    attachmentUrl: message.attachmentUrl,
    createdAt: message.createdAt.toISOString(),
    sender: {
      id: message.sender.id,
      name: message.sender.name,
      image: message.sender.image,
    },
    isOwn: message.senderId === currentUserId,
    readByCount,
    recipientCount,
    isFullyReadByRecipients: recipientCount > 0 && readByCount === recipientCount,
  };
}

export function serializeConversation(
  conversation: ConversationWithContext,
  currentUserId: string,
  unreadCount: number,
  currentUserRole: ConversationMemberRole,
): ConversationSummary {
  const lastMessage = conversation.messages[0]
    ? serializeMessageLight(conversation.messages[0], currentUserId, conversation.members)
    : null;

  const updatedAt = lastMessage
    ? (new Date(Math.max(
      conversation.updatedAt.getTime(),
      new Date(lastMessage.createdAt).getTime(),
    ))).toISOString()
    : conversation.updatedAt.toISOString();

  return {
    id: conversation.id,
    type: conversation.type,
    name: getConversationDisplayName(conversation, currentUserId),
    description: conversation.description,
    avatarUrl: getConversationAvatar(conversation, currentUserId),
    icon: conversation.icon,
    spaceId: conversation.spaceId,
    participants: conversation.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      role: member.role,
      lastReadAt: toIsoStringOrNull(member.lastReadAt),
    })),
    lastMessage,
    unreadCount,
    updatedAt,
    currentUserRole,
  };
}

export async function ensureConversationMember(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
    include: {
      conversation: {
        include: CONVERSATION_INCLUDE,
      },
    },
  });

  if (!member) {
    throw new MessagingError(403, 'You are not a member of this conversation');
  }

  return member;
}

export async function getUnreadCount(conversationId: string, userId: string, lastReadAt: Date | null): Promise<number> {
  return prisma.message.count({
    where: {
      conversationId,
      senderId: {
        not: userId,
      },
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    },
  });
}
