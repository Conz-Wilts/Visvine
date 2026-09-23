import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type {
  ConversationMessagesPage,
  SavedMessageEntry,
  SerializedMessage,
} from './types';
import {
  MESSAGE_INCLUDE,
  MessagingError,
  ensureConversationMember,
  getUnreadCount,
  serializeConversation,
  serializeMessage,
} from './core';
import { takeToken } from '@/lib/rateLimit';
import { attachPreviewsToMessage } from '@/lib/linkPreview';
import { messageFilesDenial } from '@/lib/resources/shared/messageFiles';

export async function listMessagesForConversation(
  currentUserId: string,
  conversationId: string,
  options?: {
    cursor?: string;
    limit?: number;
    query?: string;
  },
): Promise<ConversationMessagesPage> {
  const membership = await ensureConversationMember(conversationId, currentUserId);
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 50);
  const query = options?.query?.trim();

  const messageWhere: Prisma.MessageWhereInput = {
    conversationId,
    ...(query ? {
      text: {
        contains: query,
        mode: 'insensitive',
      },
    } : {}),
  };

  const records = await prisma.message.findMany({
    where: messageWhere,
    include: MESSAGE_INCLUDE,
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    ...(options?.cursor ? {
      cursor: { id: options.cursor },
      skip: 1,
    } : {}),
    take: limit + 1,
  });

  const hasMore = records.length > limit;
  const pageItems = hasMore ? records.slice(0, limit) : records;
  const nextCursor = hasMore ? pageItems[pageItems.length - 1]?.id ?? null : null;

  const serializedMessages = [...pageItems]
    .reverse()
    .map((message) => serializeMessage(message, currentUserId, membership.conversation.members));

  const unreadCount = await getUnreadCount(conversationId, currentUserId, membership.lastReadAt);

  return {
    conversation: serializeConversation(membership.conversation, currentUserId, unreadCount, membership.role),
    messages: serializedMessages,
    nextCursor,
    hasMore,
  };
}

export async function sendMessage(
  currentUserId: string,
  conversationId: string,
  payload: {
    text: string;
    attachmentUrl?: string;
    imageUrls?: string[];
    fileIds?: string[];
    mentions?: Array<{ mentionedUserId?: string; mentionedNodeId?: string; mentionType?: string }>;
    replyToId?: string;
  },
): Promise<{ message: SerializedMessage; memberIds: string[] }> {
  await ensureConversationMember(conversationId, currentUserId);

  const fileIds = Array.from(new Set(payload.fileIds ?? []));
  if (fileIds.length) {
    const rows = await prisma.resource.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, uploadedBy: true, conversationId: true },
    });
    const denial = messageFilesDenial(fileIds, rows, { userId: currentUserId, conversationId });
    if (denial) throw new MessagingError(400, denial);
  }

  const limit = await takeToken(`msg:${currentUserId}`);
  if (!limit.ok) {
    throw new MessagingError(429, `Slow down. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`);
  }

  const messageId = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId,
        senderId: currentUserId,
        text: payload.text,
        attachmentUrl: payload.attachmentUrl,
        replyToId: payload.replyToId,
      },
    });

    if (payload.imageUrls?.length) {
      await tx.messageImage.createMany({
        data: payload.imageUrls.map((url, i) => ({
          messageId: message.id,
          imageUrl: url,
          position: i,
        })),
      });
    }

    if (fileIds.length) {
      await tx.messageFile.createMany({
        data: fileIds.map((resourceId, i) => ({ messageId: message.id, resourceId, position: i })),
      });
    }

    if (payload.mentions?.length) {
      await tx.messageMention.createMany({
        data: payload.mentions.map((m) => ({
          messageId: message.id,
          mentionedUserId: m.mentionedUserId ?? null,
          mentionedNodeId: m.mentionedNodeId ?? null,
          mentionType: m.mentionType ?? 'user',
        })),
      });
    }

    await tx.conversationMember.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId: currentUserId,
        },
      },
      data: { lastReadAt: message.createdAt },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: message.createdAt },
    });

    return message.id;
  });

  const fullMessage = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: MESSAGE_INCLUDE,
  });

  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    include: {
      user: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
  });

  const message = serializeMessage(fullMessage, currentUserId, members);

  // Link previews (fire-and-forget, best-effort)
  void attachPreviewsToMessage(messageId, payload.text).catch(() => {});

  return {
    message,
    memberIds: members.map((member) => member.userId),
  };
}

// ─── Edit / Delete / Reactions ─────────────────────────────────────────────

const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function editMessage(
  currentUserId: string,
  conversationId: string,
  messageId: string,
  text: string,
): Promise<{ message: SerializedMessage; memberIds: string[] }> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.conversationId !== conversationId) {
    throw new MessagingError(404, 'Message not found');
  }
  if (existing.senderId !== currentUserId) {
    throw new MessagingError(403, 'You can only edit your own messages');
  }
  if (existing.deletedAt) {
    throw new MessagingError(400, 'Cannot edit a deleted message');
  }
  if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new MessagingError(400, 'Edit window has expired (15 minutes)');
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { text, editedAt: new Date() },
  });

  const fullMessage = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: MESSAGE_INCLUDE,
  });

  const message = serializeMessage(fullMessage, currentUserId, membership.conversation.members);
  const memberIds = membership.conversation.members.map((m) => m.userId);

  // The cards follow the text: a removed link loses its card, a new one gets one.
  void attachPreviewsToMessage(messageId, text).catch(() => {});

  return { message, memberIds };
}

export async function deleteMessage(
  currentUserId: string,
  conversationId: string,
  messageId: string,
): Promise<{ memberIds: string[] }> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.conversationId !== conversationId) {
    throw new MessagingError(404, 'Message not found');
  }
  if (existing.senderId !== currentUserId) {
    throw new MessagingError(403, 'You can only delete your own messages');
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), text: '' },
  });

  const memberIds = membership.conversation.members.map((m) => m.userId);
  return { memberIds };
}

export async function toggleReaction(
  currentUserId: string,
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<{ added: boolean; memberIds: string[] }> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.conversationId !== conversationId) {
    throw new MessagingError(404, 'Message not found');
  }

  const existingReaction = await prisma.messageReaction.findUnique({
    where: {
      messageId_userId_emoji: { messageId, userId: currentUserId, emoji },
    },
  });

  if (existingReaction) {
    await prisma.messageReaction.delete({ where: { id: existingReaction.id } });
  } else {
    await prisma.messageReaction.create({
      data: { messageId, userId: currentUserId, emoji },
    });
  }

  const memberIds = membership.conversation.members.map((m) => m.userId);
  return { added: !existingReaction, memberIds };
}

/** Toggle a per-user star (saved message) — Slack-style bookmarking. */
export async function toggleStar(
  currentUserId: string,
  conversationId: string,
  messageId: string,
): Promise<{ starred: boolean }> {
  await ensureConversationMember(conversationId, currentUserId);

  const existing = await prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true } });
  if (!existing || existing.conversationId !== conversationId) {
    throw new MessagingError(404, 'Message not found');
  }

  const existingStar = await prisma.messageStar.findUnique({
    where: { messageId_userId: { messageId, userId: currentUserId } },
  });

  if (existingStar) {
    await prisma.messageStar.delete({ where: { id: existingStar.id } });
  } else {
    await prisma.messageStar.create({
      data: { messageId, userId: currentUserId },
    });
  }

  return { starred: !existingStar };
}

type SavedMessageRecord = Prisma.MessageGetPayload<{
  include: {
    sender: { select: { name: true } };
    conversation: { select: { id: true; name: true } };
  };
}>;

function serializeSavedMessage(message: SavedMessageRecord): SavedMessageEntry {
  return {
    id: message.id,
    conversationId: message.conversation.id,
    conversationName: message.conversation.name?.trim() || 'Conversation',
    text: message.deletedAt ? '' : message.text.slice(0, 300),
    senderName: message.sender.name,
    createdAt: message.createdAt.toISOString(),
    pinnedAt: message.pinnedAt?.toISOString() ?? null,
  };
}

/** The user's starred (saved) messages across all their conversations, newest star first. */
export async function listStarredMessages(currentUserId: string): Promise<SavedMessageEntry[]> {
  const stars = await prisma.messageStar.findMany({
    where: {
      userId: currentUserId,
      message: {
        deletedAt: null,
        conversation: { members: { some: { userId: currentUserId } } },
      },
    },
    include: {
      message: {
        include: {
          sender: { select: { name: true } },
          conversation: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return stars.map((star) => serializeSavedMessage(star.message));
}

export async function markConversationRead(
  currentUserId: string,
  conversationId: string,
  readAt?: Date,
): Promise<void> {
  await ensureConversationMember(conversationId, currentUserId);

  await prisma.conversationMember.update({
    where: {
      conversationId_userId: {
        conversationId,
        userId: currentUserId,
      },
    },
    data: { lastReadAt: readAt ?? new Date() },
    select: { id: true },
  });
}

export async function getConversationMemberIds(conversationId: string): Promise<string[]> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });

  return members.map((member) => member.userId);
}
