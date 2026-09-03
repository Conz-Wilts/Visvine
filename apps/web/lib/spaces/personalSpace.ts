// Provision a brand-new user's "personal space": a private, single-member
// Space (named after them) that hosts their personal context notes. Called
// lazily from resolvePersonalContext() the first time they touch their own notes.
// Everything here is idempotent — keyed by the user's id — so re-running on
// retry or re-login never duplicates rows.
//
// Why a whole Space per user: the notes engine scopes a private "personal
// context" by (spaceId, ownerKey=userId). Giving each user their own space
// gives them a clean, private home for that context plus a directory/context of their
// own — without polluting any shared space. The space is flagged
// `personalOwnerId` so it's hidden from Discover and other users' lists.

import prisma from '@/lib/prisma'
import { createNote, ensureRootIndex, noteCount } from '@/lib/notes/store'
import { connectNodeToUserSafe } from '@/lib/identity/connection'
import { logger } from '@/lib/logger'

const WELCOME_PATH = 'welcome.md'

// The id itself lives in the pure module beside this one, so a caller that
// only needs it doesn't pull in Prisma and the provisioning path.
import { personalSpaceId } from './personalSpaceAccess'
export { personalSpaceId }

function welcomeNote(name: string): string {
  const first = name.split(' ')[0] || name
  return `---
title: Welcome
tags: [getting-started]
---

# Welcome to your personal space, ${first} 👋

This is **${name}** — your own private corner. Only you can see it.

## Two kinds of notes
- **Your personal space** (you're here now) — private context just for you: people you meet, ideas, reminders, anything.
- **Shared spaces** — shared notes inside any space you join, on that space's Context page.

Share upward when something's worth it: promote a note from here into a shared space, or quick-capture from anywhere — captures always land in your personal space first.

## Capture context fast
- Type \`[[\` to link a person or another note — e.g. \`[[Jane Doe]]\`.
- Add \`#tags\` to group related notes together.
- Search everything from the search box.

You can delete this note any time — it's yours.
`
}

export interface ProvisionResult {
  spaceId: string
}

/**
 * Create (or return) the signed-in user's personal space, make them its
 * admin, place their person node in it, and seed a welcome note in their
 * personal context. Safe to call repeatedly.
 */
export async function provisionPersonalSpace(user: {
  userId: string
  name: string
  email?: string | null
}): Promise<ProvisionResult> {
  const spaceId = personalSpaceId(user.userId)

  // The profile lives on the user row; `nodeId` is minted at sign-in
  // (lib/auth/bootstrap.ts) and is the id the node below is placed under.
  const person = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { nodeId: true, name: true, subtitle: true, location: true, image: true, tags: true },
  })

  const displayName = person?.name?.trim() || user.name

  // 1. The private space itself.
  await prisma.space.upsert({
    where: { id: spaceId },
    create: {
      id: spaceId,
      name: displayName,
      description: 'Your personal space',
      personalOwnerId: user.userId,
      // Explicitly private: the column defaults to 'public', and a personal space
      // must never be discoverable or self-joinable.
      visibility: 'private',
    },
    // Repair rows provisioned before visibility was set on create.
    update: { visibility: 'private' },
  })

  // 2. Membership. No alias needed: a personal space's owner administers it by
  //    definition (lib/notes/resolve.ts#resolveContext) and grants never apply here.
  await prisma.spaceMember.upsert({
    where: { userId_spaceId: { userId: user.userId, spaceId } },
    create: { userId: user.userId, spaceId },
    update: {},
  })

  // 3. Put the user's person node in their own directory. Node.spaceId is a
  //    single scalar (a node lives in one space), and a person node may exist
  //    with spaceId=null — so point it at this space here.
  if (person?.nodeId) {
    await prisma.node.upsert({
      where: { id: person.nodeId },
      update: { spaceId },
      create: {
        id: person.nodeId,
        type: 'person',
        name: displayName,
        subtitle: person.subtitle,
        location: person.location,
        imageUrl: person.image,
        tags: person.tags,
        spaceId,
      },
    })
    // Connect the node to its owner through the identity bridge — the link the
    // Profile tab and userId-based ownership resolve through everywhere.
    await connectNodeToUserSafe(person.nodeId, user.userId, { reason: 'personal space owner' })
  }

  // 4. Seed a welcome note in the personal space's context (its shared context —
  //    the user is the only member). Best-effort: a failed note write must never
  //    block the user from reaching their notes.
  try {
    const context = { spaceId, ownerKey: 'shared' }
    const actor = {
      id: user.userId,
      name: displayName,
      email: user.email ?? null,
    }
    if ((await noteCount(context)) === 0) {
      await createNote(context, WELCOME_PATH, welcomeNote(displayName), actor)
    }
    // The root index is the space's home page — the Context tab routes to it.
    // Seeded outside the noteCount check so spaces provisioned before this
    // existed (which already hold a welcome note) still get one.
    await ensureRootIndex(context, displayName, actor)
  } catch (err) {
    logger.warn('personalSpace.seed_failed', { spaceId, err })
  }

  return { spaceId }
}
