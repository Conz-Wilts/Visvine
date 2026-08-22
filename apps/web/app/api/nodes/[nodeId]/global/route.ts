/**
 * A person node's binding to its Visvine global record (lib/global/binding.ts).
 *
 *   GET  → { identityId, mode: 'follow' | 'fork' | null, record: {…} | null }
 *   PUT  { mode: 'follow' | 'fork', identityId? } → bind (admin, or any member
 *         with edit access on the node's note — the same audience that edits it)
 *   DELETE ?keep=1 → detach (keep the identity, stop following); without it,
 *         unbind entirely
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { spaceMemberForbidden } from '@/lib/auth'
import { parseBody, requireApiSession } from '@/lib/api/route'
import { bindingStateOf, bindToGlobal, detachFromGlobal, unbindFromGlobal } from '@/lib/global/binding'

type RouteContext = { params: Promise<{ nodeId: string }> }

const BindSchema = z.object({
  mode: z.enum(['follow', 'fork']),
  identityId: z.string().min(1).optional(),
})

async function loadNode(nodeId: string, viewerUserId: string, viewerEmail?: string | null) {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, spaceId: true, identityId: true },
  })
  if (!node?.spaceId) return null
  if (await spaceMemberForbidden(viewerUserId, node.spaceId, viewerEmail)) return null
  return node as { id: string; spaceId: string; identityId: string | null }
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  const { nodeId } = await context.params
  const node = await loadNode(nodeId, session.userId, session.email)
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 })
  return NextResponse.json(await bindingStateOf(nodeId))
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  const body = await parseBody(req, BindSchema)
  if (body instanceof NextResponse) return body
  const { nodeId } = await context.params
  const node = await loadNode(nodeId, session.userId, session.email)
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 })
  const identityId = body.identityId ?? node.identityId
  if (!identityId) return NextResponse.json({ error: 'identityId is required for an unbound context' }, { status: 400 })
  const actor = { id: session.userId, name: session.name, email: session.email ?? null }
  const result = await bindToGlobal(nodeId, identityId, body.mode, actor)
  if (!result.ok) {
    const status = result.error === 'duplicate' ? 409 : result.error === 'not_found' ? 404 : 400
    return NextResponse.json({ error: result.message }, { status })
  }
  revalidateTag('context-data-v2', { expire: 0 })
  return NextResponse.json(result.state)
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  const { nodeId } = await context.params
  const node = await loadNode(nodeId, session.userId, session.email)
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 })
  const actor = { id: session.userId, name: session.name, email: session.email ?? null }
  const keep = req.nextUrl.searchParams.get('keep') === '1'
  const result = keep ? await detachFromGlobal(nodeId, actor) : await unbindFromGlobal(nodeId, actor)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 404 })
  revalidateTag('context-data-v2', { expire: 0 })
  return NextResponse.json(result.state)
}
