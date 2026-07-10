// Promotion — moving a note from the CALLER's personal brain into the shared
// brain (blackbird-brain "how knowledge moves up").
//   POST { communityId, fromPath, toPath } → PromoteResult
//        { status: 'applied', path } | { status: 'proposed', proposalId } |
//        { status: 'denied', reason }
//   GET  ?communityId=                      → { proposals } (own + admined folders')
//   PUT  { communityId, proposalId, approve } → { proposal } (folder admin resolves)

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf, resolvePersonalBrain } from '@/lib/notes/brain'
import { promoteNote, listProposals, resolveProposal } from '@/lib/notes/promote'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const fromPath = typeof body.fromPath === 'string' ? body.fromPath : null
  const toPath = typeof body.toPath === 'string' ? body.toPath : null
  if (!fromPath || !toPath) return fail('fromPath and toPath are required')
  const p = await principalOf(brain)
  // Promotion always reads from the caller's PERSONAL COMMUNITY brain; the
  // destination is the resolved community's brain (a one-time shared copy).
  const personal = await resolvePersonalBrain({ userId: p.userId, name: p.name, email: p.email || null })
  try {
    return NextResponse.json(await promoteNote(p, personal, fromPath, toPath))
  } catch (err) {
    return failFromError(err)
  }
}

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  return NextResponse.json({ proposals: await listProposals(p) })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const proposalId = typeof body.proposalId === 'string' ? body.proposalId : null
  if (!proposalId) return fail('proposalId is required')
  const p = await principalOf(brain)
  try {
    return NextResponse.json({ proposal: await resolveProposal(p, proposalId, body.approve === true) })
  } catch (err) {
    // resolveProposal throws when the caller isn't a folder admin.
    if (err instanceof Error && err.message.startsWith('Only a folder admin')) {
      return fail(err.message, 403)
    }
    return failFromError(err)
  }
}
