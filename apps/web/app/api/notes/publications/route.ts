// Cross-brain publishing (lib/notes/publications.ts).
//   GET ?communityId=&path=  → { asSource, asTarget } — how this path
//        participates in publishing, from this community's point of view, with
//        community names for the banner/panel. Requires read access to the path.
//   POST { communityId, action, ... }:
//        'publish'   { fromCommunityId?, fromPath, toPath } — publish a note the
//             caller can READ (default source: their personal brain) into THIS
//             community. Needs edit at the destination; otherwise the request
//             queues as a publish proposal for a folder manager to approve.
//        'unpublish' { id } — deactivate; the replica stays as a plain copy.
//             Allowed for the publication's creator, a manager of the target
//             path, or an admin of either community.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession } from '@/lib/session'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf, resolveBrain, resolvePersonalBrain } from '@/lib/notes/brain'
import { personalPrincipal } from '@/lib/notes/principal'
import { personalCommunityId } from '@/lib/onboarding/personalCommunity'
import { writeDenial } from '@/lib/notes/brainService'
import { readNoteOrNull } from '@/lib/notes/store'
import {
  getPublication,
  publicationStateFor,
  publishNote,
  unpublish,
  type PublicationInfo,
} from '@/lib/notes/publications'
import { queuePublishProposal } from '@/lib/notes/promote'
import { isAdmin } from '@/lib/auth'
import {
  principalCanManage,
  principalCanRead,
} from '@/lib/notes/shared/permissions'
import type { BrainPrincipal } from '@/lib/notes/shared/brainTypes'
import type { SessionPayload } from '@/lib/session'

/** Attach display names for every community a publication list references. */
async function withNames(rows: PublicationInfo[]): Promise<Array<PublicationInfo & {
  sourceCommunityName: string
  targetCommunityName: string
}>> {
  const ids = [...new Set(rows.flatMap((r) => [r.sourceCommunityId, r.targetCommunityId]))]
  const communities = ids.length
    ? await prisma.community.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : []
  const nameOf = new Map(communities.map((c) => [c.id, c.name]))
  return rows.map((r) => ({
    ...r,
    sourceCommunityName: nameOf.get(r.sourceCommunityId) ?? r.sourceCommunityId,
    targetCommunityName: nameOf.get(r.targetCommunityId) ?? r.targetCommunityId,
  }))
}

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  if (!brain.isPersonalSpace && !principalCanRead(p, path)) {
    return fail(`Note not found: ${path}`, 404)
  }
  const state = await publicationStateFor(brain.communityId, path)
  const [asSource, asTarget] = await Promise.all([
    withNames(state.asSource),
    state.asTarget ? withNames([state.asTarget]).then((r) => r[0]) : Promise.resolve(null),
  ])
  return NextResponse.json({ asSource, asTarget })
}

/** The (principal, ok) pair for reading `path` inside the SOURCE community. */
async function resolveSourcePrincipal(
  session: SessionPayload,
  fromCommunityId: string,
): Promise<BrainPrincipal | Response> {
  if (fromCommunityId === personalCommunityId(session.userId)) {
    const identity = { userId: session.userId, name: session.name, email: session.email }
    await resolvePersonalBrain(identity) // provisions if onboarding never did
    return personalPrincipal(identity)
  }
  const resolved = await resolveBrain(session, fromCommunityId)
  if (resolved instanceof Response) return resolved
  return principalOf(resolved)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const session = await requireSession()
  if (session instanceof Response) return session
  const action = typeof body.action === 'string' ? body.action : null

  try {
    if (action === 'publish') {
      const fromPath = typeof body.fromPath === 'string' ? body.fromPath : null
      const toPath = typeof body.toPath === 'string' ? body.toPath : null
      if (!fromPath || !toPath) return fail('fromPath and toPath are required')
      if (brain.isPersonalSpace) {
        return fail('Publish into a community brain — your personal space is the source')
      }
      const fromCommunityId =
        typeof body.fromCommunityId === 'string' && body.fromCommunityId
          ? body.fromCommunityId
          : personalCommunityId(session.userId)

      const sourceP = await resolveSourcePrincipal(session, fromCommunityId)
      if (sourceP instanceof Response) return sourceP
      const sourcePersonal = fromCommunityId === personalCommunityId(session.userId)
      if (!sourcePersonal && !principalCanRead(sourceP, fromPath)) {
        return fail(`Note not found: ${fromPath}`, 404)
      }

      // Edit at the destination applies the publication now; anything less
      // queues it for a folder manager — same double door as promote.
      const targetP = await principalOf(brain)
      const denial = writeDenial(targetP, { communityId: brain.communityId, ownerKey: 'shared' }, toPath)
      if (denial) {
        const snapshot = await readNoteOrNull(
          { communityId: fromCommunityId, ownerKey: 'shared' },
          fromPath,
        )
        if (snapshot === null) return fail(`Note not found: ${fromPath}`, 404)
        const proposal = await queuePublishProposal(targetP, fromPath, toPath, snapshot)
        return NextResponse.json({ status: 'proposed', proposalId: proposal.id })
      }

      const result = await publishNote(fromCommunityId, fromPath, brain.communityId, toPath, {
        id: session.userId,
        name: session.name,
        email: session.email,
      })
      if (result.status === 'denied') return fail(result.reason, 400)
      return NextResponse.json({ status: 'applied', publication: result.publication })
    }

    if (action === 'unpublish') {
      const id = typeof body.id === 'string' ? body.id : null
      if (!id) return fail('id is required')
      const pub = await getPublication(id)
      if (!pub) return fail('Unknown publication', 404)
      const targetP = pub.targetCommunityId === brain.communityId ? await principalOf(brain) : null
      const allowed =
        pub.createdBy === session.userId ||
        (targetP !== null && principalCanManage(targetP, pub.targetPath)) ||
        (await isAdmin(session.userId, pub.targetCommunityId, session.email)) ||
        (await isAdmin(session.userId, pub.sourceCommunityId, session.email))
      if (!allowed) {
        return fail('Only the publisher, a folder manager, or an admin can unlink this', 403)
      }
      const updated = await unpublish(id, { id: session.userId, name: session.name, email: session.email })
      return NextResponse.json({ publication: updated })
    }

    return fail('Unknown action')
  } catch (err) {
    return failFromError(err)
  }
}
