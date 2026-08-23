// Publish proposals — queued by POST /api/notes/publications when the caller
// lacks edit access at the destination (lib/notes/promote.ts). Space admins
// list and resolve them here.
//   GET  ?spaceId=                      → { proposals } (own; admins see all)
//   PUT  { spaceId, proposalId, approve } → { proposal } (space admin resolves)

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { listProposals, resolveProposal } from '@/lib/notes/promote'

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
    // resolveProposal throws when the caller isn't a space admin.
    if (err instanceof Error && err.message.startsWith('Only a space admin')) {
      return fail(err.message, 403)
    }
    return failFromError(err)
  }
}
