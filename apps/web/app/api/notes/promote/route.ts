// Promotion — moving a note from the CALLER's personal context into the shared
// context — how knowledge moves up the tree.
//   POST { spaceId, fromPath, toPath } → PromoteResult
//        { status: 'applied', path } | { status: 'proposed', proposalId } |
//        { status: 'denied', reason }
//   GET  ?spaceId=                      → { proposals } (own + admined folders')
//   PUT  { spaceId, proposalId, approve } → { proposal } (folder admin resolves)

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf, resolvePersonalContext } from '@/lib/notes/resolve'
import { promoteNote, listProposals, resolveProposal } from '@/lib/notes/promote'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const fromPath = typeof body.fromPath === 'string' ? body.fromPath : null
  const toPath = typeof body.toPath === 'string' ? body.toPath : null
  if (!fromPath || !toPath) return fail('fromPath and toPath are required')
  const p = await principalOf(context)
  // Promotion always reads from the caller's PERSONAL SPACE context; the
  // destination is the resolved space's context (a one-time shared copy).
  const personal = await resolvePersonalContext({ userId: p.userId, name: p.name, email: p.email || null })
  try {
    return NextResponse.json(await promoteNote(p, personal, fromPath, toPath))
  } catch (err) {
    return failFromError(err)
  }
}

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const p = await principalOf(context)
  return NextResponse.json({ proposals: await listProposals(p) })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const proposalId = typeof body.proposalId === 'string' ? body.proposalId : null
  if (!proposalId) return fail('proposalId is required')
  const p = await principalOf(context)
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
