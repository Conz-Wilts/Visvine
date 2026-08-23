/**
 * OAuth 2.1 Token Endpoint: `authorization_code` (PKCE), and nothing else.
 *
 * Public clients, so there is no client authentication — the security of the
 * code grant rests entirely on the PKCE verifier and the redirect_uri binding,
 * both checked below.
 *
 * There is no refresh grant. An access token is a stateless 30-day JWT and that
 * is the whole lifetime of a grant: when it expires the client runs the
 * authorization flow again. Locally none of this is on the path at all — see
 * lib/mcp/devIdentity.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  consumeAuthCode,
  verifyPkceS256,
  getUserIdentity,
  kindFromStored,
} from '@/lib/mcp/oauth'
import { isCanonicalResource, mcpResourceUrl, resourceKindOf } from '@/lib/mcp/config'
import { mintAccessToken } from '@/lib/mcp/tokens'
import { parseScopes, serializeScopes } from '@/lib/mcp/scopes'

export const runtime = 'nodejs'

function oauthError(error: string, description?: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/** Accept either form-encoded (the spec's default) or JSON bodies. */
async function readParams(req: NextRequest): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  }
  const form = await req.formData().catch(() => new FormData())
  const out: Record<string, string> = {}
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export async function POST(req: NextRequest) {
  const p = await readParams(req)

  // RFC 8707. Tokens from this server are minted for exactly one of the two MCP
  // resources (context / creator) — the one the grant was authorized for — so
  // a request naming anything else is refused rather than quietly satisfied
  // with a token the client would then send elsewhere. A `resource` here that
  // names OUR OTHER server is refused too: the user consented to one.
  if (p.resource !== undefined && !isCanonicalResource(p.resource)) {
    return oauthError(
      'invalid_target',
      `Tokens are only issued for ${mcpResourceUrl('context')} or ${mcpResourceUrl('creator')}`,
    )
  }
  const requestedKind = p.resource !== undefined ? resourceKindOf(p.resource) : null

  if (p.grant_type === 'authorization_code') {
    const row = await consumeAuthCode(p.code ?? '')
    if (!row) return oauthError('invalid_grant', 'Authorization code is invalid, expired or already used')
    // The code is bound to one client and one redirect_uri; both must match the
    // values presented here or the code is worthless to the presenter.
    if (row.clientId !== p.client_id) return oauthError('invalid_grant', 'Code was issued to another client')
    if (row.redirectUri !== p.redirect_uri) return oauthError('invalid_grant', 'redirect_uri mismatch')
    if (!p.code_verifier || !verifyPkceS256(p.code_verifier, row.codeChallenge)) {
      return oauthError('invalid_grant', 'PKCE verification failed')
    }

    const identity = await getUserIdentity(row.userId)
    if (!identity) return oauthError('invalid_grant', 'The authorizing user no longer exists')

    const kind = kindFromStored(row.resource)
    if (!kind) return oauthError('invalid_grant', 'Authorization code carries an unknown resource')
    if (requestedKind && requestedKind !== kind) {
      return oauthError('invalid_target', `This code was authorized for ${mcpResourceUrl(kind)}`)
    }
    const scopes = parseScopes(row.scope)
    const { token, expiresIn } = await mintAccessToken(identity, scopes, row.clientId, kind)

    return NextResponse.json(
      {
        access_token: token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope: serializeScopes(scopes),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return oauthError('unsupported_grant_type', `Unsupported grant_type '${p.grant_type ?? ''}'`)
}
