import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { listDeployKeys, mintDeployKey } from '@/lib/tools/deployKeys'
import { bad, requireToolsAccess } from '@/lib/tools/route'

/**
 * `…/tools/authoring/<name>/keys` — a Tool's deploy keys, for whoever may
 * edit it (lib/tools/deployKeys.ts). GET lists them; POST makes one and
 * answers with the key, the one time it is ever shown.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const result = await listDeployKeys(ctx.principal, ctx.resolved, decodeURIComponent(name))
  if (!result.ok) return bad(result.error, result.status)
  return NextResponse.json({ keys: result.keys })
}

const MintBody = z.object({ label: z.string().max(200).optional() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const body = await parseBody(req, MintBody)
  if (body instanceof NextResponse) return body
  const result = await mintDeployKey(ctx.principal, ctx.resolved, decodeURIComponent(name), body.label)
  if (!result.ok) return bad(result.error, result.status)
  return NextResponse.json({ key: result.key, summary: result.summary }, { headers: { 'Cache-Control': 'no-store' } })
}
