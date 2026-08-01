/**
 * OAuth 2.0 Token Revocation (RFC 7009).
 *
 * Only refresh tokens are revocable — access tokens are stateless JWTs with a
 * one-hour lifetime, so there is nothing to revoke server-side. Per the RFC this
 * always returns 200, including for tokens that were never valid, so a caller
 * can't use it to probe which tokens exist.
 */
import { NextRequest, NextResponse } from 'next/server'
import { revokeRefreshToken } from '@/lib/mcp/oauth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const type = req.headers.get('content-type') ?? ''
  let token = ''
  if (type.includes('application/json')) {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    if (typeof body.token === 'string') token = body.token
  } else {
    const form = await req.formData().catch(() => new FormData())
    const v = form.get('token')
    if (typeof v === 'string') token = v
  }

  await revokeRefreshToken(token)
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
