/**
 * OAuth 2.1 Authorization Server primitives for the MCP server: dynamic client
 * registration, PKCE authorization codes, and rotating refresh tokens. Backed by
 * the OAuthClient / OAuthAuthCode / OAuthRefreshToken Prisma models.
 *
 * Access tokens are stateless JWTs (lib/mcp/tokens.ts) and are therefore not
 * stored; refresh tokens are persisted as SHA-256 hashes, never plaintext.
 */
import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { REFRESH_TTL_SECONDS } from '@/lib/mcp/tokens'
import { MCP_SERVER_KINDS, type McpServerKind } from '@/lib/mcp/config'

/**
 * A stored `resource` column back to a server kind. Fails CLOSED: an unknown
 * value yields null and the grant is refused (`invalid_grant`) rather than
 * quietly minting a token for the broader context server. The column carries a
 * CHECK constraint (migration 20260818150000), so null here means the schema and
 * MCP_SERVER_KINDS have drifted — a bug to surface, not paper over.
 */
export function kindFromStored(value: string | null | undefined): McpServerKind | null {
  return (MCP_SERVER_KINDS as readonly string[]).includes(value ?? '') ? (value as McpServerKind) : null
}

const AUTH_CODE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

function sha256Base64Url(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64url')
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** PKCE S256 check, compared in constant time. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const expected = Buffer.from(sha256Base64Url(verifier))
  const given = Buffer.from(challenge)
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

// ── Clients (Dynamic Client Registration, RFC 7591) ──

export async function registerClient(input: {
  redirectUris: string[]
  clientName?: string | null
  scope?: string | null
}) {
  return prisma.oAuthClient.create({
    data: {
      clientId: `mcp_${randomToken(16)}`,
      clientName: input.clientName ?? null,
      redirectUris: input.redirectUris,
      scope: input.scope ?? null,
    },
  })
}

export async function getClient(clientId: string) {
  if (!clientId) return null
  return prisma.oAuthClient.findUnique({ where: { clientId } })
}

// ── Authorization codes (PKCE, single-use) ──

export async function createAuthCode(input: {
  clientId: string
  userId: string
  redirectUri: string
  scope: string
  codeChallenge: string
  /** Which MCP server the resulting tokens are for (RFC 8707). */
  resource: McpServerKind
}): Promise<string> {
  const code = randomToken(32)
  await prisma.oAuthAuthCode.create({
    data: {
      code,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scope: input.scope,
      resource: input.resource,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  })
  return code
}

/** Returns the row and marks it consumed, or null if invalid/expired/already used. */
export async function consumeAuthCode(code: string) {
  if (!code) return null
  const row = await prisma.oAuthAuthCode.findUnique({ where: { code } })
  if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) return null
  await prisma.oAuthAuthCode.update({ where: { code }, data: { consumedAt: new Date() } })
  return row
}

// ── Refresh tokens (rotating, stored hashed) ──

export async function issueRefreshToken(input: {
  clientId: string
  userId: string
  scope: string
  resource: McpServerKind
}): Promise<string> {
  const token = randomToken(32)
  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: hashToken(token),
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      resource: input.resource,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    },
  })
  return token
}

/**
 * Validate and rotate a refresh token: revoke the presented one, mint a fresh
 * one. Returns the new token plus its grant, or null when the presented token is
 * invalid, expired or already revoked.
 *
 * `expectedResource` is the RFC 8707 `resource` the client named on this
 * refresh, if any. A grant for the other server is reported as
 * `{ wrongResource }` WITHOUT rotating — the client mis-addressed one request,
 * which is no reason to burn its grant.
 */
export async function rotateRefreshToken(
  token: string,
  expectedResource?: McpServerKind | null,
): Promise<{
  userId: string
  clientId: string
  scope: string
  resource: McpServerKind
  refreshToken: string
} | { wrongResource: McpServerKind } | null> {
  if (!token) return null
  const row = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
  })
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null
  const resource = kindFromStored(row.resource)
  if (!resource) return null
  if (expectedResource && resource !== expectedResource) return { wrongResource: resource }

  await prisma.oAuthRefreshToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  })
  const refreshToken = await issueRefreshToken({
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    resource,
  })
  return { userId: row.userId, clientId: row.clientId, scope: row.scope, resource, refreshToken }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  if (!token) return
  await prisma.oAuthRefreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

// ── Identity lookup for token minting ──

export async function getUserIdentity(userId: string): Promise<{
  userId: string
  name: string
  email: string
  personId: string | null
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, person: { select: { id: true } } },
  })
  if (!user) return null
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    personId: user.person?.id ?? null,
  }
}
