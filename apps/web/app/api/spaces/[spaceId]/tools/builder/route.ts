import { NextRequest, NextResponse } from 'next/server'
import { clearChat, listChatMessages } from '@/lib/agents/chat'
import { BUILDER_THREAD, builderReadiness } from '@/lib/tools/builder'
import { mcpResourceUrl } from '@/lib/mcp/config'
import { requireToolsAccess } from '@/lib/tools/route'
import type { BuilderResponse } from '@/lib/tools/api'

/**
 * GET — the person's builder thread in this space (newest first, a page at a
 * time with `?cursor=`), and whether the space has a model to answer with.
 * With none, `ready.ok` is false and `mcp` is the address an AI client of the
 * person's own connects to instead — the same hand-off `run_agent` makes.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const cursor = req.nextUrl.searchParams.get('cursor')
  const [page, ready] = await Promise.all([
    listChatMessages(ctx.principal.userId, ctx.resolved.spaceId, BUILDER_THREAD, { cursor }),
    builderReadiness(ctx.resolved.spaceId),
  ])
  const body: BuilderResponse = { ...page, ready, mcp: mcpResourceUrl() }
  return NextResponse.json(body)
}

/** DELETE — start over: the person's own thread goes, and nothing they built with it. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  await clearChat(ctx.principal.userId, ctx.resolved.spaceId, BUILDER_THREAD)
  return NextResponse.json({ ok: true })
}
