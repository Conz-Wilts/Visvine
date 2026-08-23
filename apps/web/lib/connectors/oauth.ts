/**
 * Visvine as an OAuth *client*.
 *
 * Everywhere else in this codebase Visvine is the authorization server — it
 * issues tokens to MCP clients (lib/mcp/oauth.ts). This module is the other
 * direction: going out to somebody else's server and coming back with a token
 * we hold on a member's behalf.
 *
 * Why it exists at all: a connector reaching Notion or Linear with a shared
 * `{{secret:}}` credential shows every member the same view — whatever the
 * credential's owner can see. That is either more than they should get or less
 * than they need. The only fix is a token per person, and getting one requires
 * a browser redirect, which a connector isolate does not have. So the host does
 * it and keeps the result.
 *
 * The flow is ordinary OAuth 2.1: discovery, PKCE, authorization code, refresh.
 * Three details are worth knowing:
 *
 *   • DYNAMIC REGISTRATION. Where the server offers it (RFC 7591), Visvine
 *     registers itself at first connect. That is what makes "add an MCP server"
 *     a URL rather than a signup — the per-vendor developer-account tax that
 *     makes connectors expensive simply does not apply.
 *   • PKCE ALWAYS, even where a client secret exists. Cheap, and it removes the
 *     authorization-code interception class outright.
 *   • THE SSRF GUARD APPLIES. Every URL reached here is checked, because the
 *     endpoints come out of a metadata document the note pointed us at, and a
 *     note is content. A discovery document naming 169.254.169.254 must not
 *     turn Visvine into a proxy for its own metadata server.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { assertPubliclyRoutable, SsrfError } from '@/lib/net/ssrf'
import { allowPrivateHosts, ConnectorError } from './config'
import type { ConnectorAuth } from './auth'

/** Endpoints resolved for one authorization server. */
export interface AuthServerEndpoints {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  /** Present only when the server supports dynamic client registration. */
  registrationEndpoint: string | null
  /** Advertised scopes, when the server publishes them. */
  scopesSupported: string[]
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  /** Absolute expiry, or null when the server declines to say. */
  expiresAt: Date | null
  scopes: string[]
  /** Best-effort human label for the account, for "acts as …". Never a secret. */
  accountLabel: string | null
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_METADATA_BYTES = 256 * 1024

/** A URL we are about to fetch, checked for shape and address space. */
async function assertSafeUrl(raw: string, what: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConnectorError('config', `${what} is not a valid URL`)
  }
  if (url.protocol !== 'https:') {
    throw new ConnectorError('config', `${what} must use https`)
  }
  try {
    await assertPubliclyRoutable(url.hostname, { allowPrivate: allowPrivateHosts() })
  } catch (e) {
    if (e instanceof SsrfError) {
      throw new ConnectorError('ssrf', `${what} resolves into private address space`)
    }
    throw e
  }
  return url
}

async function getJson(url: string, what: string): Promise<Record<string, unknown> | null> {
  await assertSafeUrl(url, what)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const text = (await res.text()).slice(0, MAX_METADATA_BYTES)
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Resolve a server's endpoints.
 *
 * For `discover`, this walks the same two documents an MCP client walks:
 * RFC 9728 protected-resource metadata names the authorization server, and
 * RFC 8414 authorization-server metadata names its endpoints. Both paths are
 * tried because servers differ on which they publish — Visvine's own server
 * publishes both, at more than one path, for exactly this reason.
 */
export async function resolveEndpoints(auth: ConnectorAuth): Promise<AuthServerEndpoints> {
  if (auth.discovery.kind === 'explicit') {
    await assertSafeUrl(auth.discovery.authorizeUrl, 'auth.authorize_url')
    await assertSafeUrl(auth.discovery.tokenUrl, 'auth.token_url')
    return {
      issuer: new URL(auth.discovery.tokenUrl).origin,
      authorizationEndpoint: auth.discovery.authorizeUrl,
      tokenEndpoint: auth.discovery.tokenUrl,
      registrationEndpoint: null,
      scopesSupported: [],
    }
  }

  const resource = await assertSafeUrl(auth.discovery.url, 'auth.discover')

  // Step 1 — protected-resource metadata, to find WHICH authorization server.
  // Probed at both the path-suffixed location and the endpoint's own sub-path,
  // since implementations disagree about where it lives.
  const prCandidates = [
    `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname.replace(/\/$/, '')}`,
    `${resource.origin}${resource.pathname.replace(/\/$/, '')}/.well-known/oauth-protected-resource`,
    `${resource.origin}/.well-known/oauth-protected-resource`,
  ]
  let issuerBase: string | null = null
  for (const candidate of prCandidates) {
    const doc = await getJson(candidate, 'protected-resource metadata')
    const servers = strList(doc?.authorization_servers)
    if (servers[0]) {
      issuerBase = servers[0]
      break
    }
  }
  // No protected-resource document: many servers are their own issuer.
  if (!issuerBase) issuerBase = resource.origin

  // Step 2 — authorization-server metadata, for the endpoints themselves.
  const issuerUrl = new URL(issuerBase)
  const asCandidates = [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname.replace(/\/$/, '')}`,
    `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
    `${issuerUrl.origin}/.well-known/openid-configuration`,
  ]
  for (const candidate of asCandidates) {
    const doc = await getJson(candidate, 'authorization-server metadata')
    const authorization = str(doc?.authorization_endpoint)
    const token = str(doc?.token_endpoint)
    if (authorization && token) {
      await assertSafeUrl(authorization, 'authorization_endpoint')
      await assertSafeUrl(token, 'token_endpoint')
      const registration = str(doc?.registration_endpoint)
      if (registration) await assertSafeUrl(registration, 'registration_endpoint')
      return {
        issuer: str(doc?.issuer) ?? issuerUrl.origin,
        authorizationEndpoint: authorization,
        tokenEndpoint: token,
        registrationEndpoint: registration,
        scopesSupported: strList(doc?.scopes_supported),
      }
    }
  }

  throw new ConnectorError(
    'config',
    `Could not discover OAuth endpoints for ${resource.origin}. Add explicit \`authorize_url\` and \`token_url\` to the note's auth: block.`,
  )
}

/** PKCE pair. S256 only — `plain` is not offered and should not be. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function randomState(): string {
  return randomBytes(24).toString('base64url')
}

/** Constant-time compare for the state echo. */
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export interface RegisteredClient {
  clientId: string
  clientSecret: string | null
}

/**
 * Register Visvine with a server that supports RFC 7591.
 *
 * Requested as a PUBLIC client (`token_endpoint_auth_method: none`): the token
 * exchange happens server-side and is bound by PKCE, so a client secret adds a
 * thing to store and rotate without adding a guarantee. A server that insists
 * on one gives us its own and we keep it.
 */
export async function registerClient(
  endpoints: AuthServerEndpoints,
  redirectUri: string,
  scopes: string[],
): Promise<RegisteredClient> {
  if (!endpoints.registrationEndpoint) {
    throw new ConnectorError(
      'config',
      'This server does not support dynamic client registration. Register by hand and put the id in the note as `auth.client_id`.',
    )
  }
  await assertSafeUrl(endpoints.registrationEndpoint, 'registration_endpoint')

  const res = await fetch(endpoints.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Visvine',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(scopes.length > 0 ? { scope: scopes.join(' ') } : {}),
    }),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  const text = (await res.text()).slice(0, MAX_METADATA_BYTES)
  if (!res.ok) {
    throw new ConnectorError('upstream', `Client registration failed (${res.status}).`)
  }
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ConnectorError('upstream', 'Client registration returned a response we could not parse.')
  }
  const clientId = str(doc.client_id)
  if (!clientId) {
    throw new ConnectorError('upstream', 'Client registration returned no client_id.')
  }
  return { clientId, clientSecret: str(doc.client_secret) }
}

/** Build the URL the person's browser is sent to. */
export function authorizeUrl(args: {
  endpoints: AuthServerEndpoints
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
  challenge: string
  /** RFC 8707 — names the API the token is for, so it cannot be replayed elsewhere. */
  resource?: string | null
}): string {
  const url = new URL(args.endpoints.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('state', args.state)
  url.searchParams.set('code_challenge', args.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (args.scopes.length > 0) url.searchParams.set('scope', args.scopes.join(' '))
  if (args.resource) url.searchParams.set('resource', args.resource)
  return url.toString()
}

function toTokenSet(doc: Record<string, unknown>, requested: string[]): TokenSet {
  const accessToken = str(doc.access_token)
  if (!accessToken) {
    throw new ConnectorError('upstream', 'The token response contained no access_token.')
  }
  const expiresIn = typeof doc.expires_in === 'number' ? doc.expires_in : null
  const granted = str(doc.scope)
  return {
    accessToken,
    refreshToken: str(doc.refresh_token),
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    // A server that does not echo `scope` granted what we asked for (RFC 6749).
    scopes: granted ? granted.split(/\s+/).filter(Boolean) : requested,
    accountLabel: accountLabelFrom(doc),
  }
}

/**
 * Dig a human label out of the token response, for the "acts as …" line.
 *
 * Deliberately best-effort and non-standard: providers scatter this around
 * (`owner.user.person.email`, `authed_user`, `team.name`), and a missing label
 * is a cosmetic loss, not a failure. Never returns anything token-shaped.
 */
function accountLabelFrom(doc: Record<string, unknown>): string | null {
  const direct = str(doc.workspace_name) ?? str(doc.account_label) ?? str(doc.email)
  if (direct) return direct
  const owner = doc.owner
  if (owner && typeof owner === 'object') {
    const user = (owner as Record<string, unknown>).user
    if (user && typeof user === 'object') {
      const person = (user as Record<string, unknown>).person
      const email = person && typeof person === 'object' ? str((person as Record<string, unknown>).email) : null
      return email ?? str((user as Record<string, unknown>).name)
    }
  }
  const team = doc.team
  if (team && typeof team === 'object') return str((team as Record<string, unknown>).name)
  return null
}

async function postToken(
  endpoints: AuthServerEndpoints,
  body: URLSearchParams,
  clientSecret: string | null,
  requested: string[],
): Promise<TokenSet> {
  await assertSafeUrl(endpoints.tokenEndpoint, 'token_endpoint')
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  }
  // Confidential clients authenticate with HTTP Basic (RFC 6749 §2.3.1), which
  // is the form every server accepts; the secret never rides in the body.
  if (clientSecret) {
    const clientId = body.get('client_id') ?? ''
    const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')
    headers.authorization = `Basic ${basic}`
  }

  const res = await fetch(endpoints.tokenEndpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  const text = (await res.text()).slice(0, MAX_METADATA_BYTES)
  let doc: Record<string, unknown> = {}
  try {
    doc = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* fall through to the status check */
  }
  if (!res.ok) {
    // `error` is machine-readable and safe to pass on; `error_description` is
    // upstream prose and is the only thing that ever explains a bad scope name.
    const code = str(doc.error) ?? String(res.status)
    const detail = str(doc.error_description)
    throw new ConnectorError('upstream', detail ? `${code}: ${detail}` : `Token request failed (${code}).`)
  }
  return toTokenSet(doc, requested)
}

/** Swap an authorization code for tokens. */
export async function exchangeCode(args: {
  endpoints: AuthServerEndpoints
  clientId: string
  clientSecret: string | null
  redirectUri: string
  code: string
  verifier: string
  scopes: string[]
  resource?: string | null
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.verifier,
  })
  if (args.resource) body.set('resource', args.resource)
  return postToken(args.endpoints, body, args.clientSecret, args.scopes)
}

/**
 * Renew an access token.
 *
 * Note what the caller must do with the result: many providers ROTATE the
 * refresh token, returning a new one and invalidating the old. Persist
 * `refreshToken` whenever it comes back non-null, or the next renewal fails
 * with a token the server has already retired.
 */
export async function refreshTokens(args: {
  endpoints: AuthServerEndpoints
  clientId: string
  clientSecret: string | null
  refreshToken: string
  scopes: string[]
  resource?: string | null
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  })
  if (args.resource) body.set('resource', args.resource)
  const next = await postToken(args.endpoints, body, args.clientSecret, args.scopes)
  // A server that omits refresh_token on renewal means "keep using the old one".
  return { ...next, refreshToken: next.refreshToken ?? args.refreshToken }
}
