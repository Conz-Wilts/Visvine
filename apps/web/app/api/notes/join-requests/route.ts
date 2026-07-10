// Join requests for private folders.
//   GET  ?communityId=                        → { requests }  (own + admined folders')
//   POST { communityId, folderId, message? }  → { request }   (file / return pending)
//   PUT  { communityId, requestId, approve }  → { request }   (folder admin resolves)

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { requestJoin, listJoinRequests, resolveJoinRequest } from '@/lib/notes/joinRequests'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  return NextResponse.json({ requests: await listJoinRequests(p) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  // '' is the ROOT GATE (a brain-access request) and a valid folderId.
  const folderId = typeof body.folderId === 'string' ? body.folderId : null
  if (folderId === null) return fail('folderId is required')
  const message = typeof body.message === 'string' ? body.message : undefined
  const p = await principalOf(brain)
  try {
    return NextResponse.json({ request: await requestJoin(p, folderId, message) })
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
  const p = await principalOf(brain)
  try {
    return NextResponse.json({ request: await resolveJoinRequest(p, requestId, body.approve === true) })
  } catch (err) {
    // resolveJoinRequest throws when the caller isn't a folder admin.
    if (err instanceof Error && err.message.startsWith('Only a folder admin')) {
      return fail(err.message, 403)
    }
    return failFromError(err)
  }
}
