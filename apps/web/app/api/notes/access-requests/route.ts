// Access requests for a community's shared brain (successor of
// /api/notes/join-requests — renamed because "join request" already means a
// pending community MEMBER in the console).
//   GET  ?communityId=                                   → { requests, pending }
//   POST { communityId, resourcePath, message? }          → { request }
//   PUT  { communityId, requestId, approve, level? }      → { request }
// All semantics live in lib/notes/accessRequests.ts + shared/accessRequests.ts.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import {
  createAccessRequest,
  listVisibleAccessRequests,
  resolveAccessRequest,
} from '@/lib/notes/accessRequests'
import { parseLevel } from '@/lib/notes/shared/authz'
import { logActivity } from '@/lib/activityLog'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  if (brain.isPersonalSpace) return NextResponse.json({ requests: [], pending: 0 })
  const p = await principalOf(brain)
  const requests = await listVisibleAccessRequests(p)
  return NextResponse.json({
    requests,
    // The console nav badge needs the count before the section is ever opened.
    pending: requests.filter((r) => r.status === 'pending' && r.userId !== p.userId).length,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (brain.isPersonalSpace) return fail('Personal spaces are private — there is nothing to request')
  // '' is the ROOT GATE (a request for brain access) and a valid resourcePath.
  const resourcePath = typeof body.resourcePath === 'string' ? body.resourcePath : null
  if (resourcePath === null) return fail('resourcePath is required')
  const message = typeof body.message === 'string' ? body.message : undefined
  const p = await principalOf(brain)
  try {
    return NextResponse.json({ request: await createAccessRequest(p, resourcePath, message) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const requestId = typeof body.requestId === 'string' ? body.requestId : null
  if (!requestId) return fail('requestId is required')
  const approve = body.approve === true
  const level = approve ? (parseLevel(body.level) ?? undefined) : undefined
  const p = await principalOf(brain)
  try {
    const request = await resolveAccessRequest(p, requestId, approve, level)
    await logActivity({
      communityId: brain.communityId,
      actorEmail: p.email,
      actorName: p.name,
      action: approve ? 'access_request.approved' : 'access_request.denied',
      targetName: request.requesterName ?? null,
      targetEmail: request.requesterEmail ?? null,
      details: { resourcePath: request.resourcePath, grantedLevel: request.grantedLevel ?? null },
    })
    return NextResponse.json({ request })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Only someone with full access')) {
      return fail(err.message, 403)
    }
    return failFromError(err)
  }
}
