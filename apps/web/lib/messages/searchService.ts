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

  // Only surface people the caller shares a real (non-personal) space with.
  // Without this, the endpoint returned the entire platform's name+email roster
  // across every tenant to any signed-in user — a cross-tenant identity leak and
  // an email-existence oracle. Email stays in the projection for the directory
  // dedup in searchUsersAndDirectory; the HTTP route strips it from the response.
  const mySpaces = await prisma.spaceMember.findMany({
    where: { userId: currentUserId, status: 'active', space: { personalOwnerId: null } },
    select: { spaceId: true },
  });
  const spaceIds = mySpaces.map((c) => c.spaceId);
  if (spaceIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      id: {
        not: currentUserId,
      },
      memberships: { some: { spaceId: { in: spaceIds }, status: 'active' } },
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
  const [users, memberships] = await Promise.all([
    searchUsers(currentUserId, query),
    prisma.spaceMember.findMany({
      where: { userId: currentUserId },
      select: { spaceId: true },
    }),
  ]);

  const spaceIds = memberships.map((uc) => uc.spaceId);

  if (spaceIds.length === 0) {
    return { users, directoryPeople: [] };
  }

  const normalized = query?.trim();

  // Query Node table (has spaceId) for person-type nodes, then join with Person data
  const nodes = await prisma.node.findMany({
    where: {
      spaceId: { in: spaceIds },
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
      space: { select: { name: true } },
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
        spaceName: n.space?.name ?? null,
      };
    })
    .filter((p) => !p.email || !activeEmails.has(p.email.toLowerCase()));

  return { users, directoryPeople };
}
