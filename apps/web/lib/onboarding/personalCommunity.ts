// Provision a brand-new user's "personal space": a private, single-member
// Community (named after them) that hosts their personal context notes. Created
// at the end of onboarding. Everything here is idempotent — keyed by the user's
// id — so re-running on retry, skip, or re-login never duplicates rows.
//
// Why a whole Community per user: the notes engine scopes a private "personal
// brain" by (communityId, ownerKey=userId). Giving each user their own community
// gives them a clean, private home for that brain plus a directory/graph of their
// own — without polluting any shared community. The community is flagged
// `personalOwnerId` so it's hidden from Discover and other users' lists.

import prisma from '@/lib/prisma'
import { createNote, noteCount } from '@/lib/notes/store'
import { logger } from '@/lib/logger'

const WELCOME_PATH = 'welcome.md'

/** Deterministic id → exactly one personal community per user. */
export function personalCommunityId(userId: string): string {
  return `me:${userId}`
}

function welcomeNote(name: string): string {
  const first = name.split(' ')[0] || name
  return `---
title: Welcome
tags: [getting-started]
---

# Welcome to your space, ${first} 👋

This is **${name}** — your own private corner. Only you can see it.

## Two kinds of notes
- **My notes** (you're here now) — private context just for you: people you meet, ideas, reminders, anything.
- **Community brain** — shared notes inside any community you join.

Use the toggle at the top of the Context page to switch between them.

## Capture context fast
- Type \`[[\` to link a person or another note — e.g. \`[[Jane Doe]]\`.
- Add \`#tags\` to group related notes together.
- Search everything from the search box.

You can delete this note any time — it's yours.
`
}

export interface ProvisionResult {
  communityId: string
}

/**
 * Create (or return) the signed-in user's personal community, make them its
 * admin, place their person node in it, and seed a welcome note in their
 * personal brain. Safe to call repeatedly.
 */
export async function provisionPersonalCommunity(user: {
  userId: string
  name: string
  email?: string | null
}): Promise<ProvisionResult> {
  const communityId = personalCommunityId(user.userId)

  // The Person row is created at the OAuth callback and edited during onboarding;
  // it's the source of truth for the directory node's profile fields.
  const person = await prisma.person.findUnique({
    where: { userId: user.userId },
    select: { id: true, name: true, subtitle: true, location: true, imageUrl: true, tags: true },
  })

  const displayName = person?.name?.trim() || user.name

  // 1. The private community itself.
  await prisma.community.upsert({
    where: { id: communityId },
    create: {
      id: communityId,
      name: displayName,
      description: 'Your personal space',
      personalOwnerId: user.userId,
      dataFile: `${communityId}.json`,
      memberCount: 1,
    },
    update: {},
  })

  // 2. Membership as admin (so the user can edit notes/graph in their own space).
  await prisma.userCommunity.upsert({
    where: { userId_communityId: { userId: user.userId, communityId } },
    create: { userId: user.userId, communityId, role: 'admin' },
    update: {},
  })

  // 3. Put the user's person node in their own directory. Node.communityId is a
  //    single scalar (a node lives in one community), and the onboarding PATCH
  //    creates this node with communityId=null — so point it at this space here.
  if (person) {
    await prisma.node.upsert({
      where: { id: person.id },
      update: { communityId },
      create: {
        id: person.id,
        type: 'person',
        name: person.name,
        subtitle: person.subtitle,
        location: person.location,
        imageUrl: person.imageUrl,
        tags: person.tags ?? [],
        communityId,
      },
    })
  }

  // 4. Seed a welcome note in the personal brain (ownerKey = userId). Best-effort:
  //    a failed note write must never block the user from finishing onboarding.
  try {
    const brain = { communityId, ownerKey: user.userId }
    if ((await noteCount(brain)) === 0) {
      await createNote(brain, WELCOME_PATH, welcomeNote(displayName), {
        id: user.userId,
        name: displayName,
        email: user.email ?? null,
      })
    }
  } catch (err) {
    logger.warn('onboarding.personalCommunity.seed_failed', { communityId, err })
  }

  return { communityId }
}
