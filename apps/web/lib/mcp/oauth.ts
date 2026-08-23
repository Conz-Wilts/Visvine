/**
 * OAuth 2.1 Authorization Server primitives for the MCP server: dynamic client
 * registration and PKCE authorization codes. Backed by the OAuthClient /
 * OAuthAuthCode Prisma models.
 *
 * Access tokens are stateless JWTs (lib/mcp/tokens.ts) and are therefore not
 * stored. There are no refresh tokens: a grant is one 30-day access token, and a
 * client that wants another runs the authorization flow again.
 */
import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
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
