import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { revokeDeployKey } from '@/lib/tools/deployKeys'
import { bad, requireToolsAccess } from '@/lib/tools/route'

/** `DELETE …/tools/authoring/<name>/keys/<keyId>` — revoke one deploy key. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string; keyId: string }> },
) {
  const { spaceId, name, keyId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const result = await revokeDeployKey(ctx.principal, ctx.resolved, decodeURIComponent(name), keyId)
  if (!result.ok) return bad(result.error, result.status)
  return NextResponse.json({ ok: true })
}
