import { ConversationMemberRole, ConversationType, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { ChannelDirectoryEntry, ChannelSpaceEntry, ConversationSummary } from './types';
import {
  CONVERSATION_INCLUDE,
  MessagingError,
  ensureConversationMember,
  getUnreadCount,
  serializeConversation,
} from './core';
import {
  communityNodeId,
  removeEntityNode,
  reparentEntityNode,
  syncEntityNodeSafe,
} from '@/lib/notes/context/entityNodes';

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

async function getConversationSummaryForUser(userId: string, conversationId: string): Promise<ConversationSummary> {
  const membership = await ensureConversationMember(conversationId, userId);
  const unreadCount = await getUnreadCount(conversationId, userId, membership.lastReadAt);

  return serializeConversation(
    membership.conversation,
    userId,
    unreadCount,
    membership.role,
  );
}

/**
 * Create a community channel. Authorization (community admin) is enforced by the route;
 * this only validates the community exists and seeds the creator as channel admin.
 */
export async function createChannelConversation(
  currentUserId: string,
  communityId: string,
  name: string,
  description?: string,
  icon?: string,
  spaceId?: string,
  viewMode?: 'CHAT' | 'FEED',
  context?: string,
): Promise<ConversationSummary> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { id: true },
  });

  if (!community) {
    throw new MessagingError(404, 'Space not found');
  }

  if (spaceId) {
    await ensureSpaceInCommunity(spaceId, communityId);
  }

  const created = await prisma.conversation.create({
    data: {
      type: ConversationType.CHANNEL,
      name: name.trim(),
      description: description?.trim() || null,
      icon: icon ?? null,
      viewMode: viewMode ?? 'CHAT',
      spaceId: spaceId ?? null,
      communityId,
      createdById: currentUserId,
      members: {
        create: [
          {
            userId: currentUserId,
            role: ConversationMemberRole.ADMIN,
            lastReadAt: new Date(),
          },
        ],
      },
    },
    include: CONVERSATION_INCLUDE,
  });

  // A channel is a thing you can hold context about, so it gets a graph node and
  // a channels/<slug>.md note, contained by its space (or by the community when
  // it's unfiled). Best-effort: a channel without context still works.
  await syncEntityNodeSafe({
    communityId,
    type: 'channel',
    name: created.name?.trim() || 'Channel',
    recordId: created.id,
    subtitle: created.description,
    body: context,
    metadata: { viewMode: created.viewMode, icon: created.icon },
    parentNodeId: await parentNodeForChannel(communityId, created.spaceId),
    actor: { id: currentUserId, name: '' },
  });

  return serializeConversation(created, currentUserId, 0, ConversationMemberRole.ADMIN);
}

/**
 * What contains a channel in the graph: its space when it's filed, otherwise the
 * community itself. Returns null when the space has no node yet — syncEntityNode
 * skips a missing parent rather than failing.
 */
async function parentNodeForChannel(
  communityId: string,
  spaceId: string | null,
): Promise<string | null> {
  if (!spaceId) return communityNodeId(communityId);
  const node = await prisma.node.findFirst({
    where: { communityId, type: 'section', metadata: { path: ['spaceId'], equals: spaceId } },
    select: { id: true },
  });
  return node?.id ?? communityNodeId(communityId);
}

/** All channels in a community, flagged with whether the user has joined. */
export async function listChannelsForCommunity(
  userId: string,
  communityId: string,
): Promise<ChannelDirectoryEntry[]> {
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { id: true },
  });

  if (!membership) {
    return [];
  }

  const channels = await prisma.conversation.findMany({
    where: { type: ConversationType.CHANNEL, communityId },
    select: {
      id: true,
      name: true,
      description: true,
      icon: true,
      viewMode: true,
      spaceId: true,
      _count: { select: { members: true } },
      members: {
        where: { userId },
        select: { id: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return channels.map((channel) => ({
    id: channel.id,
    name: channel.name?.trim() || 'Unnamed channel',
    description: channel.description,
    icon: channel.icon,
    viewMode: channel.viewMode,
    spaceId: channel.spaceId,
    memberCount: channel._count.members,
    isMember: channel.members.length > 0,
  }));
}

// ─── Channel spaces (Circle-style sections) ─────────────────────────────────

function serializeSpace(space: { id: string; name: string; emoji: string | null; position: number }): ChannelSpaceEntry {
  return { id: space.id, name: space.name, emoji: space.emoji, position: space.position };
}

async function ensureSpaceInCommunity(spaceId: string, communityId: string) {
  const space = await prisma.channelSpace.findUnique({
    where: { id: spaceId },
    select: { id: true, communityId: true },
  });
  if (!space || space.communityId !== communityId) {
    throw new MessagingError(404, 'Section not found in this space');
  }
}

export async function listChannelSpaces(communityId: string): Promise<ChannelSpaceEntry[]> {
  const spaces = await prisma.channelSpace.findMany({
    where: { communityId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  return spaces.map(serializeSpace);
}

export async function createChannelSpace(
  communityId: string,
  name: string,
  emoji?: string,
  context?: string,
  actorId?: string,
): Promise<ChannelSpaceEntry> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { id: true },
  });
  if (!community) {
    throw new MessagingError(404, 'Space not found');
  }
  const last = await prisma.channelSpace.findFirst({
    where: { communityId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const created = await prisma.channelSpace.create({
    data: {
      communityId,
      name: name.trim(),
      emoji: emoji ?? null,
      position: (last?.position ?? -1) + 1,
    },
  });
  await syncEntityNodeSafe({
    communityId,
    type: 'section',
    name: created.name,
    recordId: created.id,
    body: context,
    metadata: { emoji: created.emoji },
    parentNodeId: communityNodeId(communityId),
    ...(actorId ? { actor: { id: actorId, name: '' } } : {}),
  });
  return serializeSpace(created);
}

export async function updateChannelSpace(
  spaceId: string,
  payload: { name?: string; emoji?: string | null; position?: number },
): Promise<ChannelSpaceEntry> {
  const existing = await prisma.channelSpace.findUnique({ where: { id: spaceId } });
  if (!existing) {
    throw new MessagingError(404, 'Section not found');
  }
  const updated = await prisma.channelSpace.update({
    where: { id: spaceId },
    data: {
      ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
      ...(payload.emoji !== undefined ? { emoji: payload.emoji } : {}),
      ...(payload.position !== undefined ? { position: payload.position } : {}),
    },
  });
  // Keep the graph label in step with the rename. The node id (and so the note
  // path) is deliberately NOT re-derived — the note is the section's history, and
  // moving it on every rename would break links into it.
  if (payload.name !== undefined || payload.emoji !== undefined) {
    await syncEntityNodeSafe({
      communityId: updated.communityId,
      type: 'section',
      name: updated.name,
      recordId: updated.id,
      metadata: { emoji: updated.emoji },
    });
  }
  return serializeSpace(updated);
}

/** Delete a section — its channels are unfiled (spaceId → null), not deleted. */
export async function deleteChannelSpace(spaceId: string): Promise<void> {
  const existing = await prisma.channelSpace.findUnique({
    where: { id: spaceId },
    select: { id: true, communityId: true },
  });
  if (!existing) {
    throw new MessagingError(404, 'Section not found');
  }
  // Channels survive the section, so their containment edge has to move up to the
  // community before the section's node (and its cascading edges) goes away.
  const orphaned = await prisma.conversation.findMany({
    where: { spaceId, type: ConversationType.CHANNEL },
    select: { id: true },
  });
  for (const channel of orphaned) {
    const node = await prisma.node.findFirst({
      where: {
        communityId: existing.communityId,
        type: 'channel',
        metadata: { path: ['conversationId'], equals: channel.id },
      },
      select: { id: true },
    });
    if (node) {
      await reparentEntityNode(existing.communityId, node.id, communityNodeId(existing.communityId));
    }
  }
  await prisma.channelSpace.delete({ where: { id: spaceId } });
  await removeEntityNode(existing.communityId, 'section', spaceId);
}

/** Join a community channel (any member of the channel's community can join). */
export async function joinChannel(userId: string, conversationId: string): Promise<ConversationSummary> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true, communityId: true },
  });

  if (!conversation || conversation.type !== ConversationType.CHANNEL) {
    throw new MessagingError(404, 'Channel not found');
  }

  if (conversation.communityId) {
    const membership = await prisma.userCommunity.findUnique({
      where: { userId_communityId: { userId, communityId: conversation.communityId } },
      select: { id: true },
    });

    if (!membership) {
      throw new MessagingError(403, 'You must be a member of this space to join its channels');
    }
  }

  await prisma.conversationMember.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    update: {},
    create: {
      conversationId,
      userId,
      role: ConversationMemberRole.MEMBER,
    },
  });

  return getConversationSummaryForUser(userId, conversationId);
}

export async function addMembersToGroup(
  currentUserId: string,
  conversationId: string,
  memberIds: string[],
): Promise<ConversationSummary> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  if (membership.conversation.type === ConversationType.DM) {
    throw new MessagingError(400, 'Members cannot be added to direct messages');
  }

  if (membership.role !== ConversationMemberRole.ADMIN) {
    throw new MessagingError(403, 'Only admins can add members');
  }

  const existingMembers = new Set(membership.conversation.members.map((member) => member.userId));
  const uniqueIncoming = [...new Set(memberIds)].filter((memberId) => !existingMembers.has(memberId));

  if (uniqueIncoming.length > 0) {
    // A community channel's members must belong to that community — otherwise an
    // admin could pull an outsider into the channel and hand them its full
    // message history. Ad-hoc groups (no communityId) keep the platform-wide add.
    const channelCommunityId = membership.conversation.communityId;
    const users = await prisma.user.findMany({
      where: {
        id: { in: uniqueIncoming },
        ...(channelCommunityId
          ? { userCommunities: { some: { communityId: channelCommunityId, status: 'active' } } }
          : {}),
      },
      select: { id: true },
    });

    if (users.length !== uniqueIncoming.length) {
      throw new MessagingError(
        400,
        channelCommunityId
          ? 'One or more selected users are not members of this community'
          : 'One or more selected users were not found',
      );
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

  if (membership.conversation.type === ConversationType.DM) {
    throw new MessagingError(400, 'Members cannot be removed from direct messages');
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
      membership.conversation.type !== ConversationType.DM &&
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

    // Channels persist even when the last member leaves — they stay discoverable
    // in the community's channel directory.
    if (otherMembers.length === 0 && membership.conversation.type !== ConversationType.CHANNEL) {
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
  payload: { name?: string; description?: string | null; avatarUrl?: string | null; icon?: string | null; spaceId?: string | null; viewMode?: 'CHAT' | 'FEED' },
): Promise<ConversationSummary> {
  const membership = await ensureConversationMember(conversationId, currentUserId);

  if (membership.conversation.type === ConversationType.DM) {
    throw new MessagingError(400, 'Direct messages cannot be updated');
  }

  if (membership.role !== ConversationMemberRole.ADMIN) {
    throw new MessagingError(403, 'Only admins can update group details');
  }

  const isChannel = membership.conversation.type === ConversationType.CHANNEL;

  if ((payload.icon !== undefined || payload.spaceId !== undefined || payload.viewMode !== undefined) && !isChannel) {
    throw new MessagingError(400, 'Icons, sections and view styles only apply to channels');
  }

  if (payload.spaceId) {
    const communityId = membership.conversation.communityId;
    if (!communityId) {
      throw new MessagingError(400, 'Channel has no space');
    }
    await ensureSpaceInCommunity(payload.spaceId, communityId);
  }

  const updates: Prisma.ConversationUpdateInput = {};

  if (payload.name !== undefined) {
    updates.name = payload.name.trim();
  }

  if (payload.description !== undefined) {
    updates.description = payload.description?.trim() || null;
  }

  if (payload.avatarUrl !== undefined) {
    updates.avatarUrl = payload.avatarUrl;
  }

  if (payload.icon !== undefined) {
    updates.icon = payload.icon;
  }

  if (payload.viewMode !== undefined) {
    updates.viewMode = payload.viewMode;
  }

  if (payload.spaceId !== undefined) {
    updates.space = payload.spaceId
      ? { connect: { id: payload.spaceId } }
      : { disconnect: true };
  }

  if (Object.keys(updates).length === 0) {
    return getConversationSummaryForUser(currentUserId, conversationId);
  }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { ...updates, updatedAt: new Date() },
    select: { id: true, name: true, description: true, icon: true, viewMode: true, spaceId: true, communityId: true },
  });

  // Keep the channel's node in step: the label follows a rename, and moving the
  // channel between spaces moves its containment edge with it.
  if (isChannel && updated.communityId) {
    const result = await syncEntityNodeSafe({
      communityId: updated.communityId,
      type: 'channel',
      name: updated.name?.trim() || 'Channel',
      recordId: updated.id,
      subtitle: updated.description,
      metadata: { viewMode: updated.viewMode, icon: updated.icon },
    });
    if (result && payload.spaceId !== undefined) {
      const parent = await parentNodeForChannel(updated.communityId, updated.spaceId);
      if (parent) await reparentEntityNode(updated.communityId, result.nodeId, parent);
    }
  }

  return getConversationSummaryForUser(currentUserId, conversationId);
}
