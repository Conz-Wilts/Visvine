// Cross-context publishing (lib/notes/publications.ts).
//   GET ?spaceId=&path=  → { asSource, asTarget } — how this path
//        participates in publishing, from this space's point of view, with
//        space names for the banner/panel. Requires read access to the path.
//   POST { spaceId, action, ... }:
//        'publish'   { fromSpaceId?, fromPath, toPath } — publish a note the
//             caller can READ (default source: their personal context) into THIS
//             space. Needs edit at the destination; otherwise the request
//             queues as a publish proposal for a folder manager to approve.
//        'unpublish' { id } — deactivate; the replica stays as a plain copy.
//             Allowed for the publication's creator, a manager of the target
//             path, or an admin of either space.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession } from '@/lib/session'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf, resolveContext, resolvePersonalContext } from '@/lib/notes/resolve'
import { personalPrincipal } from '@/lib/notes/principal'
import { personalSpaceId } from '@/lib/spaces/personalSpace'
import { writeDenial } from '@/lib/notes/contextService'
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
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { SessionPayload } from '@/lib/session'

/** Attach display names for every space a publication list references. */
async function withNames(rows: PublicationInfo[]): Promise<Array<PublicationInfo & {
  sourceSpaceName: string
  targetSpaceName: string
}>> {
  const ids = [...new Set(rows.flatMap((r) => [r.sourceSpaceId, r.targetSpaceId]))]
  const spaces = ids.length
    ? await prisma.space.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : []
  const nameOf = new Map(spaces.map((c) => [c.id, c.name]))
  return rows.map((r) => ({
    ...r,
    sourceSpaceName: nameOf.get(r.sourceSpaceId) ?? r.sourceSpaceId,
    targetSpaceName: nameOf.get(r.targetSpaceId) ?? r.targetSpaceId,
  }))
}

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(context)
  if (!context.isPersonalSpace && !principalCanRead(p, path)) {
    return fail(`Note not found: ${path}`, 404)
  }
  const state = await publicationStateFor(context.spaceId, path)
  const [asSource, asTarget] = await Promise.all([
    withNames(state.asSource),
    state.asTarget ? withNames([state.asTarget]).then((r) => r[0]) : Promise.resolve(null),
  ])
  return NextResponse.json({ asSource, asTarget })
}

/** The (principal, ok) pair for reading `path` inside the SOURCE space. */
async function resolveSourcePrincipal(
  session: SessionPayload,
  fromSpaceId: string,
): Promise<ContextPrincipal | Response> {
  if (fromSpaceId === personalSpaceId(session.userId)) {
    const identity = { userId: session.userId, name: session.name, email: session.email }
    await resolvePersonalContext(identity) // provisions on first use
    return personalPrincipal(identity)
  }
  const resolved = await resolveContext(session, fromSpaceId)
  if (resolved instanceof Response) return resolved
  return principalOf(resolved)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const session = await requireSession()
  if (session instanceof Response) return session
  const action = typeof body.action === 'string' ? body.action : null

  try {
    if (action === 'publish') {
      const fromPath = typeof body.fromPath === 'string' ? body.fromPath : null
      const toPath = typeof body.toPath === 'string' ? body.toPath : null
      if (!fromPath || !toPath) return fail('fromPath and toPath are required')
      if (context.isPersonalSpace) {
        return fail('Publish into a space context — your personal space is the source')
      }
      const fromSpaceId =
        typeof body.fromSpaceId === 'string' && body.fromSpaceId
          ? body.fromSpaceId
          : personalSpaceId(session.userId)

      const sourceP = await resolveSourcePrincipal(session, fromSpaceId)
      if (sourceP instanceof Response) return sourceP
      const sourcePersonal = fromSpaceId === personalSpaceId(session.userId)
      if (!sourcePersonal && !principalCanRead(sourceP, fromPath)) {
        return fail(`Note not found: ${fromPath}`, 404)
      }

      // Edit at the destination applies the publication now; anything less
      // queues it for a folder manager — same double door as promote.
      const targetP = await principalOf(context)
      const denial = writeDenial(targetP, { spaceId: context.spaceId, ownerKey: 'shared' }, toPath)
      if (denial) {
        const snapshot = await readNoteOrNull(
          { spaceId: fromSpaceId, ownerKey: 'shared' },
          fromPath,
        )
        if (snapshot === null) return fail(`Note not found: ${fromPath}`, 404)
        const proposal = await queuePublishProposal(targetP, fromPath, toPath, snapshot)
        return NextResponse.json({ status: 'proposed', proposalId: proposal.id })
      }

      const result = await publishNote(fromSpaceId, fromPath, context.spaceId, toPath, {
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
      const targetP = pub.targetSpaceId === context.spaceId ? await principalOf(context) : null
      const allowed =
        pub.createdBy === session.userId ||
        (targetP !== null && principalCanManage(targetP, pub.targetPath)) ||
        (await isAdmin(session.userId, pub.targetSpaceId, session.email)) ||
        (await isAdmin(session.userId, pub.sourceSpaceId, session.email))
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
