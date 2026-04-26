import { ConversationMemberRole, ConversationType, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { ConversationSummary } from './types';
import { createDmKey } from './utils';
import {
  CONVERSATION_INCLUDE,
  MessagingError,
  ensureConversationMember,
  getUnreadCount,
  serializeConversation,
} from './serializers';

export async function listConversationsForUser(userId: string, searchQuery?: string): Promise<ConversationSummary[]> {
  const query = searchQuery?.trim();

  const memberships = await prisma.conversationMember.findMany({
    where: {
      userId,
      conversation: query ? {
        OR: [
          {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            members: {
              some: {
                user: {
                  OR: [
                    {
                      name: {
                        contains: query,
                        mode: 'insensitive',
                      },
                    },
                    {
                      email: {
                        contains: query,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            },
          },
          {
            messages: {
              some: {
                text: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      } : undefined,
    },
    include: {
      conversation: {
        include: CONVERSATION_INCLUDE,
      },
    },
  });

  if (memberships.length === 0) {
    return [];
  }

  // Batch unread counts in a single query instead of N+1
  const conversationIds = memberships.map((m) => m.conversationId);
  const unreadCountRows = await prisma.$queryRaw<Array<{ conversation_id: string; count: bigint }>>`
    SELECT m.conversation_id, COUNT(*) as count
    FROM messages m
    JOIN conversation_members cm
      ON cm.conversation_id = m.conversation_id AND cm.user_id = ${userId}
    WHERE m.sender_id != ${userId}
      AND m.conversation_id IN (${Prisma.join(conversationIds)})
      AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
    GROUP BY m.conversation_id
  `;
  const unreadMap = new Map(unreadCountRows.map((r) => [r.conversation_id, Number(r.count)]));

  return memberships
    .map((membership) => serializeConversation(
      membership.conversation,
      userId,
      unreadMap.get(membership.conversationId) ?? 0,
      membership.role,
    ))
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));
}

export async function getConversationSummaryForUser(userId: string, conversationId: string): Promise<ConversationSummary> {
  const membership = await ensureConversationMember(conversationId, userId);
  const unreadCount = await getUnreadCount(conversationId, userId, membership.lastReadAt);

  return serializeConversation(
    membership.conversation,
    userId,
    unreadCount,
    membership.role,
  );
}

export async function createDmConversation(currentUserId: string, peerUserId: string): Promise<ConversationSummary> {
  if (currentUserId === peerUserId) {
    throw new MessagingError(400, 'Cannot create a DM with yourself');
  }

  const peer = await prisma.user.findUnique({
    where: { id: peerUserId },
    select: { id: true },
  });

  if (!peer) {
    throw new MessagingError(404, 'User not found');
  }

  const dmKey = createDmKey(currentUserId, peerUserId);

  const existing = await prisma.conversation.findUnique({
    where: { dmKey },
    include: CONVERSATION_INCLUDE,
  });

  if (existing) {
    const currentUserMembership = existing.members.find((member) => member.userId === currentUserId);

    if (!currentUserMembership) {
      throw new MessagingError(403, 'You cannot access this conversation');
    }

    const unreadCount = await getUnreadCount(existing.id, currentUserId, currentUserMembership.lastReadAt);
    return serializeConversation(existing, currentUserId, unreadCount, currentUserMembership.role);
  }

  try {
    const created = await prisma.conversation.create({
      data: {
        type: ConversationType.DM,
        dmKey,
        createdById: currentUserId,
        members: {
          create: [
            {
              userId: currentUserId,
              role: ConversationMemberRole.MEMBER,
              lastReadAt: new Date(),
            },
            {
              userId: peerUserId,
              role: ConversationMemberRole.MEMBER,
            },
          ],
        },
      },
      include: CONVERSATION_INCLUDE,
    });

    const currentUserMembership = created.members.find((member) => member.userId === currentUserId);

    if (!currentUserMembership) {
      throw new MessagingError(500, 'Failed to initialize conversation membership');
    }

    return serializeConversation(created, currentUserId, 0, currentUserMembership.role);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const raceWinner = await prisma.conversation.findUnique({
        where: { dmKey },
        include: CONVERSATION_INCLUDE,
      });

      if (!raceWinner) {
        throw new MessagingError(500, 'Failed to resolve existing DM conversation');
      }

      const currentUserMembership = raceWinner.members.find((member) => member.userId === currentUserId);

      if (!currentUserMembership) {
        throw new MessagingError(403, 'You cannot access this conversation');
      }

      const unreadCount = await getUnreadCount(raceWinner.id, currentUserId, currentUserMembership.lastReadAt);
      return serializeConversation(raceWinner, currentUserId, unreadCount, currentUserMembership.role);
    }

    throw error;
  }
}

export async function createGroupConversation(
  currentUserId: string,
  name: string,
  memberIds: string[],
  avatarUrl?: string,
): Promise<ConversationSummary> {
  const uniqueMemberIds = [...new Set([currentUserId, ...memberIds])];

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueMemberIds } },
    select: { id: true },
  });

  if (users.length !== uniqueMemberIds.length) {
    throw new MessagingError(400, 'One or more selected users were not found');
  }

  const created = await prisma.conversation.create({
    data: {
      type: ConversationType.GROUP,
      name,
      avatarUrl: avatarUrl ?? null,
      createdById: currentUserId,
      members: {
        create: uniqueMemberIds.map((memberId) => ({
          userId: memberId,
          role: memberId === currentUserId ? ConversationMemberRole.ADMIN : ConversationMemberRole.MEMBER,
          lastReadAt: memberId === currentUserId ? new Date() : null,
        })),
      },
    },
    include: CONVERSATION_INCLUDE,
  });

  const currentUserMembership = created.members.find((member) => member.userId === currentUserId);

  if (!currentUserMembership) {
    throw new MessagingError(500, 'Failed to initialize group membership');
  }

  return serializeConversation(created, currentUserId, 0, currentUserMembership.role);
}

export async function addMembersToGroup(
  currentUserId: string,
  conversationId: string,
  memberIds: string[],
): Promise<ConversationSummary> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  if (membership.conversation.type !== ConversationType.GROUP) {
    throw new MessagingError(400, 'Members can only be added to group chats');
  }

  if (membership.role !== ConversationMemberRole.ADMIN) {
    throw new MessagingError(403, 'Only admins can add members');
  }

  const existingMembers = new Set(membership.conversation.members.map((member) => member.userId));
  const uniqueIncoming = [...new Set(memberIds)].filter((memberId) => !existingMembers.has(memberId));

  if (uniqueIncoming.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: uniqueIncoming } },
      select: { id: true },
    });

    if (users.length !== uniqueIncoming.length) {
      throw new MessagingError(400, 'One or more selected users were not found');
    }

    await prisma.conversationMember.createMany({
      data: uniqueIncoming.map((memberId) => ({
        conversationId,
        userId: memberId,
        role: ConversationMemberRole.MEMBER,
      })),
      skipDuplicates: true,
    });
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
    select: { id: true },
  });

  return getConversationSummaryForUser(currentUserId, conversationId);
}

export async function removeMemberFromGroup(
  currentUserId: string,
  conversationId: string,
  memberUserId: string,
): Promise<ConversationSummary> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  if (membership.conversation.type !== ConversationType.GROUP) {
    throw new MessagingError(400, 'Members can only be removed from group chats');
  }

  if (membership.role !== ConversationMemberRole.ADMIN) {
    throw new MessagingError(403, 'Only admins can remove members');
  }

  const targetMember = membership.conversation.members.find((member) => member.userId === memberUserId);

  if (!targetMember) {
    throw new MessagingError(404, 'Target member not found');
  }

  if (memberUserId === currentUserId) {
    throw new MessagingError(400, 'Use leave group instead of removing yourself');
  }

  if (membership.conversation.members.length <= 1) {
    throw new MessagingError(400, 'Cannot remove the last group member');
  }

  if (targetMember.role === ConversationMemberRole.ADMIN) {
    const otherAdminCount = membership.conversation.members.filter((member) => {
      return member.userId !== memberUserId && member.role === ConversationMemberRole.ADMIN;
    }).length;

    if (otherAdminCount === 0 && membership.conversation.members.length > 1) {
      throw new MessagingError(400, 'Group must retain at least one admin');
    }
  }

  await prisma.conversationMember.delete({
    where: {
      conversationId_userId: {
        conversationId,
        userId: memberUserId,
      },
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
    select: { id: true },
  });

  return getConversationSummaryForUser(currentUserId, conversationId);
}

export async function leaveConversation(currentUserId: string, conversationId: string): Promise<void> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  await prisma.$transaction(async (tx) => {
    const members = await tx.conversationMember.findMany({
      where: { conversationId },
      orderBy: { joinedAt: 'asc' },
    });

    const currentMember = members.find((member) => member.userId === currentUserId);

    if (!currentMember) {
      throw new MessagingError(403, 'Membership not found');
    }

    const otherMembers = members.filter((member) => member.userId !== currentUserId);

    if (
      membership.conversation.type === ConversationType.GROUP &&
      currentMember.role === ConversationMemberRole.ADMIN &&
      otherMembers.length > 0
    ) {
      const hasOtherAdmin = otherMembers.some((member) => member.role === ConversationMemberRole.ADMIN);

      if (!hasOtherAdmin) {
        await tx.conversationMember.update({
          where: {
            conversationId_userId: {
              conversationId,
              userId: otherMembers[0].userId,
            },
          },
          data: { role: ConversationMemberRole.ADMIN },
        });
      }
    }

    await tx.conversationMember.delete({
      where: {
        conversationId_userId: {
          conversationId,
          userId: currentUserId,
        },
      },
    });

    if (otherMembers.length === 0) {
      await tx.conversation.delete({ where: { id: conversationId } });
      return;
    }

    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  });
}

export async function updateGroupConversation(
  currentUserId: string,
  conversationId: string,
  payload: { name?: string; avatarUrl?: string | null },
): Promise<ConversationSummary> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  if (membership.conversation.type !== ConversationType.GROUP) {
    throw new MessagingError(400, 'Only group chats can be updated');
  }

  if (membership.role !== ConversationMemberRole.ADMIN) {
    throw new MessagingError(403, 'Only admins can update group details');
  }

  const updates: Prisma.ConversationUpdateInput = {};

  if (payload.name !== undefined) {
    updates.name = payload.name.trim();
  }

  if (payload.avatarUrl !== undefined) {
    updates.avatarUrl = payload.avatarUrl;
  }

  if (Object.keys(updates).length === 0) {
    return getConversationSummaryForUser(currentUserId, conversationId);
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { ...updates, updatedAt: new Date() },
  });

  return getConversationSummaryForUser(currentUserId, conversationId);
}
