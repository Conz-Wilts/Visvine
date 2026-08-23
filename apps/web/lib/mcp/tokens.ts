/**
 * MCP access-token minting + verification.
 *
 * Access tokens are HS256 JWTs signed with the same `AUTH_SECRET` as web
 * sessions, but with `typ: "mcp_access"`, an `aud` bound to ONE MCP resource
 * URL (the context server or the creator server — lib/mcp/config.ts), and a
 * `scope` claim. The `typ` guard in `verifyAccessToken` is what stops an
 * ordinary `auth_session` cookie JWT from being replayed as an MCP token — do
 * not relax it. The `aud` check is what stops a token minted for one server
 * from being presented to the other.
 */
import { SignJWT, jwtVerify } from 'jose'
import { mcpResourceUrl, type McpServerKind } from '@/lib/mcp/config'
import { serializeScopes } from '@/lib/mcp/scopes'

/**
 * 30 days — the whole life of a grant, since there is no refresh token behind
 * it. One authorization, one token, a month of access.
 *
 * The trade this makes: a token is a stateless JWT, so nothing can call it back
 * before it expires. There is no revocation endpoint and no stored row to flip.
 * What still stops a stale token is the layer below — every tool re-resolves the
 * user and their per-space authorization from the database on every call, so a
 * deleted account or a revoked space membership takes effect immediately even
 * though the token itself keeps verifying. Shortening this constant is the only
 * lever if that ever proves too loose.
 */
const ACCESS_TTL_SECONDS = 60 * 60 * 24 * 30

const TOKEN_TYPE = 'mcp_access'

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET environment variable is not set')
  return new TextEncoder().encode(s)
}

export interface McpIdentity {
  userId: string
  name: string
  email: string
  personId?: string | null
}

/** Every token gets the same 30-day life; there is no refresh grant behind it. */
export async function mintAccessToken(
  identity: McpIdentity,
  scopes: readonly string[],
  clientId: string,
  kind: McpServerKind,
): Promise<{ token: string; expiresIn: number }> {
  const ttlSeconds = ACCESS_TTL_SECONDS
  const token = await new SignJWT({
    name: identity.name,
    email: identity.email,
    personId: identity.personId ?? null,
    scope: serializeScopes(scopes),
    client_id: clientId,
    typ: TOKEN_TYPE,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.userId)
    .setAudience(mcpResourceUrl(kind))
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret())
  return { token, expiresIn: ttlSeconds }
}

export interface VerifiedAccessToken {
  userId: string
  name: string
  email: string
  personId: string | null
  scopes: string[]
  clientId: string
  expiresAt?: number
}

/** Verify a bearer for the server named by `kind` — a token for the other server is null here. */
export async function verifyAccessToken(
  token: string,
  kind: McpServerKind,
): Promise<VerifiedAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: mcpResourceUrl(kind) })
    if (payload.typ !== TOKEN_TYPE) return null
    if (!payload.sub) return null
    const scope = typeof payload.scope === 'string' ? payload.scope : ''
    return {
      userId: String(payload.sub),
      name: typeof payload.name === 'string' ? payload.name : '',
      email: typeof payload.email === 'string' ? payload.email : '',
      personId: typeof payload.personId === 'string' ? payload.personId : null,
      scopes: scope ? scope.split(/\s+/).filter(Boolean) : [],
      clientId: typeof payload.client_id === 'string' ? payload.client_id : '',
      expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
    }
  } catch {
    return null
  }
}
