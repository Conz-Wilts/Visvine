/**
 * OAuth 2.1 Authorization Endpoint (authorization code + PKCE).
 *
 * GET  → validate the request, require a Visvine session (else bounce to
 *        /signin), then render the consent screen.
 * POST → the user's approve/deny decision. On approve, mint a single-use code
 *        bound to {user, client, redirect_uri, scope, code_challenge}.
 *
 * Every response that reaches the client — success or error — carries `iss`
 * (RFC 9207) so the client can detect a mix-up between authorization servers.
 * The client_id may be an opaque DCR identifier or a Client ID Metadata
 * Document URL; `resolveClient` handles both.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAuthCode } from '@/lib/mcp/oauth'
import { resolveClient, ClientResolutionError, type McpClient } from '@/lib/mcp/clients'
import { oauthIssuer, isCanonicalResource, mcpResourceUrl } from '@/lib/mcp/config'
import { negotiateScopes, serializeScopes, SCOPE_DESCRIPTIONS } from '@/lib/mcp/scopes'

export const runtime = 'nodejs'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlError(message: string, status = 400): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title>` +
      `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>Authorization error</h1><p>${esc(message)}</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

/**
 * Error responses are redirects too, and RFC 9207 requires `iss` on those as
 * well — a client that only validated the success path could still be walked
 * into acting on an attacker's error.
 */
function redirectError(redirectUri: string, error: string, state: string | null, description?: string): NextResponse {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (description) url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)
  url.searchParams.set('iss', oauthIssuer())
  // 303, not the 307 default: the consent form POSTs here, and a
  // method-preserving redirect would POST to the client's callback (405).
  return NextResponse.redirect(url, 303)
}

/**
 * Resolve the client, mapping a bad Client ID Metadata Document to a readable
 * page rather than a redirect — at this point we have no vetted redirect_uri to
 * send anything to.
 */
async function loadClient(clientId: string): Promise<{ client: McpClient } | { error: NextResponse }> {
  try {
    const client = await resolveClient(clientId)
    if (!client) return { error: htmlError('Unknown client_id.') }
    return { client }
  } catch (e) {
    if (e instanceof ClientResolutionError) return { error: htmlError(e.message) }
    throw e
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = url.searchParams
  const clientId = sp.get('client_id') ?? ''
  const redirectUri = sp.get('redirect_uri') ?? ''
  const state = sp.get('state')
  const codeChallenge = sp.get('code_challenge')
  const resource = sp.get('resource')

  const loaded = await loadClient(clientId)
  if ('error' in loaded) return loaded.error
  const { client } = loaded

  // Never redirect to an unregistered URI — that would make this an open
  // redirector, so the check has to happen before any redirect path below.
  if (!client.redirectUris.includes(redirectUri)) {
    return htmlError('Invalid redirect_uri for this client.')
  }
  if (sp.get('response_type') !== 'code') {
    return redirectError(redirectUri, 'unsupported_response_type', state)
  }
  if (!codeChallenge || sp.get('code_challenge_method') !== 'S256') {
    return redirectError(redirectUri, 'invalid_request', state, 'PKCE with S256 is required')
  }
  // RFC 8707: the token must be minted for one named resource. We serve exactly
  // one, so anything else is a request we cannot honour — and silently issuing a
  // token for the wrong audience is how confused-deputy attacks start.
  if (resource !== null && !isCanonicalResource(resource)) {
    return redirectError(
      redirectUri,
      'invalid_target',
      state,
      `This authorization server only issues tokens for ${mcpResourceUrl()}`,
    )
  }

  // The user must be signed in to Visvine to grant access as themselves.
  const session = await getSession()
  if (!session) {
    const signin = new URL('/signin', oauthIssuer())
    signin.searchParams.set('callbackUrl', url.pathname + url.search)
    return NextResponse.redirect(signin)
  }

  const scopes = negotiateScopes(sp.get('scope'), client.scope)
  const clientName = client.clientName || clientId
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`

  // A Client ID Metadata Document is self-asserted: the name is whatever that
  // URL says it is. Showing the origin lets the user judge it for themselves.
  const provenance =
    client.source === 'client-id-document'
      ? `<p style="color:#555;font-size:.9rem">Identified by <strong>${esc(
          new URL(client.clientId).origin,
        )}</strong>, which publishes this application's details.</p>`
      : ''

  const page = `<!doctype html><meta charset="utf-8"><title>Authorize ${esc(clientName)}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#14342b">
  <h1 style="font-size:1.4rem">Authorize access</h1>
  <p><strong>${esc(clientName)}</strong> wants to access Visvine as
     <strong>${esc(session.email)}</strong>.</p>
  ${provenance}
  <p>It will be able to:</p>
  <ul>${scopes.map((s) => `<li>${esc(SCOPE_DESCRIPTIONS[s])}</li>`).join('')}</ul>
  <p style="color:#555;font-size:.9rem">Only within the spaces you belong to, and only as far as your
     own access in each one allows.</p>
  <form method="post" action="/api/oauth/authorize" style="display:flex;gap:.75rem;margin-top:1.5rem">
    ${hidden('client_id', clientId)}
    ${hidden('redirect_uri', redirectUri)}
    ${hidden('scope', serializeScopes(scopes))}
    ${hidden('state', state ?? '')}
    ${hidden('code_challenge', codeChallenge)}
    ${hidden('resource', resource ?? '')}
    <button name="decision" value="approve" type="submit"
      style="background:#1f6f54;color:#fff;border:0;border-radius:8px;padding:.6rem 1.2rem;font-size:1rem;cursor:pointer">Approve</button>
    <button name="decision" value="deny" type="submit"
      style="background:#eee;color:#333;border:0;border-radius:8px;padding:.6rem 1.2rem;font-size:1rem;cursor:pointer">Deny</button>
  </form>
</body>`

  return new NextResponse(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const get = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' && v.length > 0 ? v : null
  }

  const clientId = get('client_id') ?? ''
  const redirectUri = get('redirect_uri') ?? ''
  const state = get('state')
  const codeChallenge = get('code_challenge')
  const resource = get('resource')

  const loaded = await loadClient(clientId)
  if ('error' in loaded) return loaded.error
  const { client } = loaded

  if (!client.redirectUris.includes(redirectUri)) {
    return htmlError('Invalid redirect_uri for this client.')
  }
  if (!codeChallenge) return redirectError(redirectUri, 'invalid_request', state)
  // Re-checked here, not just on GET: the form is a separate request and its
  // fields are attacker-controllable.
  if (resource !== null && !isCanonicalResource(resource)) {
    return redirectError(redirectUri, 'invalid_target', state)
  }

  const session = await getSession()
  if (!session) return htmlError('Your session expired. Please retry.', 401)

  if (get('decision') !== 'approve') {
    return redirectError(redirectUri, 'access_denied', state)
  }

  // Re-negotiated against the client's registration rather than trusted from the
  // form, so a tampered hidden field can't widen the grant.
  const scopes = negotiateScopes(get('scope'), client.scope)
  const code = await createAuthCode({
    clientId,
    userId: session.userId,
    redirectUri,
    scope: serializeScopes(scopes),
    codeChallenge,
  })

  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  url.searchParams.set('iss', oauthIssuer())
  // See redirectError: 303 so the client's callback is fetched with GET.
  return NextResponse.redirect(url, 303)
}
