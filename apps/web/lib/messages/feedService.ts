import { ConversationType, type Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { adminSpaceIdsFrom } from '@/lib/auth';
import { canAccessFeature } from '@/lib/featureAccess';
import type { SpaceFeatureConfig } from '@/lib/types';
import { MESSAGE_INCLUDE, serializeMessage } from './core';
import {
  FEED_PAGE_MAX,
  FEED_PAGE_SIZE,
  decodeFeedCursor,
  encodeFeedCursor,
  filterPlaces,
  groupComments,
  type FeedPage,
  type FeedPlace,
} from './shared/feed';

/**
 * The channels a person's feed draws from: FEED-mode channels they have
 * joined, in spaces they are an active member of, where Channels is a tool
 * they can open. The same set is what they may post into.
 */
async function feedPlaces(userId: string, email?: string | null): Promise<FeedPlace[]> {
  const memberships = await prisma.spaceMember.findMany({
    where: { userId, status: 'active' },
    select: {
      space: {
        select: { id: true, name: true, aliases: true, parentId: true, parentAdmins: true, featureConfig: true },
      },
    },
  });
  if (memberships.length === 0) return [];

  const spaces = memberships.map((m) => m.space);
  const adminIds = await adminSpaceIdsFrom(userId, spaces, email);
  const open = new Map(
    spaces
      .filter((s) => canAccessFeature(s.featureConfig as SpaceFeatureConfig | null, 'channels', adminIds.has(s.id)))
      .map((s) => [s.id, s]),
  );
  if (open.size === 0) return [];

  const channels = await prisma.conversation.findMany({
    where: {
      type: ConversationType.CHANNEL,
      viewMode: 'FEED',
      spaceId: { in: [...open.keys()] },
      members: { some: { userId } },
    },
    select: { id: true, name: true, spaceId: true },
    orderBy: { createdAt: 'asc' },
  });

  return channels.map((channel) => {
    const space = open.get(channel.spaceId!)!;
    return {
      conversationId: channel.id,
      channel: { id: channel.id, name: channel.name?.trim() || 'Unnamed channel' },
      space: { id: space.id, name: space.name },
    };
  });
}

/** One page of the feed, newest post first, each post with its comments. */
export async function listFeedForUser(
  user: { id: string; email?: string | null },
  options?: { cursor?: string | null; limit?: number; spaceId?: string | null },
): Promise<FeedPage> {
  const places = filterPlaces(await feedPlaces(user.id, user.email), options?.spaceId);
  const cursor = decodeFeedCursor(options?.cursor);
  const targets = cursor ? undefined : places;
  if (places.length === 0) return { posts: [], nextCursor: null, targets };

  const limit = Math.min(Math.max(options?.limit ?? FEED_PAGE_SIZE, 1), FEED_PAGE_MAX);
  const where: Prisma.MessageWhereInput = {
    conversationId: { in: places.map((p) => p.conversationId) },
    replyToId: null,
    deletedAt: null,
    ...(cursor ? {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    } : {}),
  };

  const records = await prisma.message.findMany({
    where,
    include: MESSAGE_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = records.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = records.length > limit && last ? encodeFeedCursor(last) : null;

  const replies = page.length
    ? await prisma.message.findMany({
        where: { replyToId: { in: page.map((m) => m.id) } },
        include: MESSAGE_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];

  // No member list: a feed shows no read receipts.
  const posts = page.map((m) => serializeMessage(m, user.id, []));
  const comments = groupComments(posts, replies.map((m) => serializeMessage(m, user.id, [])));
  const placeOf = new Map(places.map((p) => [p.conversationId, p]));

  return {
    posts: posts.map((message, i) => ({
      ...placeOf.get(page[i].conversationId)!,
      message,
      comments: comments.get(message.id) ?? [],
    })),
    nextCursor,
    targets,
  };
}
