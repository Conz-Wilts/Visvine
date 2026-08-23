/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591).
 *
 * **Deprecated by MCP 2026-07-28** in favour of Client ID Metadata Documents
 * (lib/mcp/clients.ts), and kept only for clients that predate them. Public
 * clients only — PKCE, no client secret. Open registration is what lets an MCP
 * client connect without a human pre-provisioning credentials; the real gate is
 * the consent screen at /api/oauth/authorize, where a signed-in user approves a
 * named client and the scopes it asked for.
 */
import { NextRequest, NextResponse } from 'next/server'
import { registerClient } from '@/lib/mcp/oauth'
import { inferApplicationType, validateRedirectUri, type ApplicationType } from '@/lib/mcp/clients'
import { MCP_SCOPES, parseScopes, serializeScopes } from '@/lib/mcp/scopes'

export const runtime = 'nodejs'

function registrationError(error: string, description: string): NextResponse {
  return NextResponse.json({ error, error_description: description }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>)

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
    : []
  if (redirectUris.length === 0) {
    return registrationError('invalid_redirect_uri', 'redirect_uris is required')
  }

  // SEP-837: honour a declared application_type, but *infer* rather than apply
  // OIDC's `web` default when it is omitted — that default rejects the loopback
  // URIs almost every MCP client registers with, which is the interop failure
  // the SEP was written to end.
  const declared = body.application_type
  if (declared !== undefined && declared !== 'web' && declared !== 'native') {
    return registrationError('invalid_client_metadata', "application_type must be 'web' or 'native'")
  }
  const applicationType: ApplicationType =
    (declared as ApplicationType | undefined) ?? inferApplicationType(redirectUris)

  for (const uri of redirectUris) {
    const check = validateRedirectUri(uri, applicationType)
    if (!check.ok) return registrationError('invalid_redirect_uri', check.reason)
  }

  // An unknown requested scope is dropped rather than rejected: clients written
  // against a different server's catalogue should still register successfully
  // and simply get less.
  const requested = typeof body.scope === 'string' ? parseScopes(body.scope) : [...MCP_SCOPES]
  const scope = serializeScopes(requested.length > 0 ? requested : MCP_SCOPES)

  const client = await registerClient({
    redirectUris,
    clientName: typeof body.client_name === 'string' ? body.client_name : null,
    scope,
  })

  return NextResponse.json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      scope: client.scope,
      application_type: applicationType,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    },
    { status: 201 },
  )
}
