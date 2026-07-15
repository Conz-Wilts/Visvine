import prisma from '@/lib/prisma';
import type { ConversationSummary, DirectoryPerson } from './types';
import { listConversationsForUser } from './conversationService';

export async function searchConversationsAndMessages(currentUserId: string, query: string) {
  const normalized = query.trim();

  if (!normalized) {
    return {
      conversations: [] as ConversationSummary[],
      messages: [] as Array<{
        id: string;
        text: string;
        createdAt: string;
        conversationId: string;
        conversationName: string;
        sender: {
          id: string;
          name: string;
          image: string | null;
        };
      }>,
    };
  }

  const conversations = await listConversationsForUser(currentUserId, normalized);

  const messages = await prisma.message.findMany({
    where: {
      text: {
        contains: normalized,
        mode: 'insensitive',
      },
      conversation: {
        members: {
          some: {
            userId: currentUserId,
          },
        },
      },
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          image: true,
        },
      },
      conversation: {
        select: {
          id: true,
          name: true,
          type: true,
          avatarUrl: true,
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
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 25,
  });

  return {
    conversations: conversations.slice(0, 20),
    messages: messages.map((message) => ({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
      conversationId: message.conversationId,
      conversationName: message.conversation.type === 'GROUP'
        ? (message.conversation.name?.trim() || 'Unnamed group')
        : (message.conversation.members.find((m) => m.userId !== currentUserId)?.user.name
          || message.conversation.members.find((m) => m.userId !== currentUserId)?.user.email
          || 'Direct message'),
      sender: {
        id: message.sender.id,
        name: message.sender.name,
        image: message.sender.image,
      },
    })),
  };
}

export async function searchUsers(currentUserId: string, query?: string) {
  const normalized = query?.trim();

  const users = await prisma.user.findMany({
    where: {
      id: {
        not: currentUserId,
      },
      ...(normalized ? {
        OR: [
          {
            name: {
              contains: normalized,
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: normalized,
              mode: 'insensitive',
            },
          },
        ],
      } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
    },
    orderBy: {
      name: 'asc',
    },
    take: 25,
  });

  return users;
}

export async function searchUsersAndDirectory(
  currentUserId: string,
  query?: string,
): Promise<{ users: Awaited<ReturnType<typeof searchUsers>>; directoryPeople: DirectoryPerson[] }> {
  const [users, userCommunities] = await Promise.all([
    searchUsers(currentUserId, query),
    prisma.userCommunity.findMany({
      where: { userId: currentUserId },
      select: { communityId: true },
    }),
  ]);

  const communityIds = userCommunities.map((uc) => uc.communityId);

  if (communityIds.length === 0) {
    return { users, directoryPeople: [] };
  }

  const normalized = query?.trim();

  // Query Node table (has communityId) for person-type nodes, then join with Person data
  const nodes = await prisma.node.findMany({
    where: {
      communityId: { in: communityIds },
      type: 'person',
      ...(normalized ? {
        name: { contains: normalized, mode: 'insensitive' },
      } : {}),
    },
    select: {
      id: true,
      name: true,
      subtitle: true,
      imageUrl: true,
      metadata: true,
      community: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
    take: 30,
  });

  const activeEmails = new Set(users.map((u) => u.email.toLowerCase()));

  const directoryPeople: DirectoryPerson[] = nodes
    .map((n) => {
      const meta = n.metadata as Record<string, unknown> | null;
      const email = typeof meta?.email === 'string' ? meta.email : null;
      return {
        id: n.id,
        name: n.name,
        subtitle: n.subtitle ?? null,
        email,
        imageUrl: n.imageUrl ?? null,
        communityName: n.community?.name ?? null,
      };
    })
    .filter((p) => !p.email || !activeEmails.has(p.email.toLowerCase()));

  return { users, directoryPeople };
}
