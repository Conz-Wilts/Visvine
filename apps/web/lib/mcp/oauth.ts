/**
 * OAuth 2.1 Authorization Server primitives for the MCP server: client (DCR),
 * authorization-code (PKCE), and rotating refresh-token persistence + crypto.
 * Backed by the OAuthClient / OAuthAuthCode / OAuthRefreshToken Prisma models.
 */
import crypto from "node:crypto";
import prisma from "@/lib/prisma";
import { REFRESH_TTL_SECONDS } from "@/lib/mcp/tokens";

const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(input: string): string {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

/** Constant-time-ish PKCE S256 check. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const expected = sha256Base64Url(verifier);
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── Clients (Dynamic Client Registration) ──

export async function registerClient(input: {
  redirectUris: string[];
  clientName?: string | null;
  scope?: string | null;
}) {
  const clientId = `mcp_${randomToken(16)}`;
  return prisma.oAuthClient.create({
    data: {
      clientId,
      clientName: input.clientName ?? null,
      redirectUris: input.redirectUris,
      scope: input.scope ?? null,
    },
  });
}

export async function getClient(clientId: string) {
  return prisma.oAuthClient.findUnique({ where: { clientId } });
}

// ── Authorization codes ──

export async function createAuthCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
}): Promise<string> {
  const code = randomToken(32);
  await prisma.oAuthAuthCode.create({
    data: {
      code,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scope: input.scope,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return code;
}

/** Single-use: returns the row and marks it consumed, or null if invalid/expired/used. */
export async function consumeAuthCode(code: string) {
  const row = await prisma.oAuthAuthCode.findUnique({ where: { code } });
  if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) return null;
  await prisma.oAuthAuthCode.update({
    where: { code },
    data: { consumedAt: new Date() },
  });
  return row;
}

// ── Refresh tokens (rotating, stored hashed) ──

export async function issueRefreshToken(input: {
  clientId: string;
  userId: string;
  scope: string;
}): Promise<string> {
  const token = randomToken(32);
  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: hashToken(token),
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    },
  });
  return token;
}

/**
 * Validate + rotate a refresh token: revoke the presented one and mint a fresh
 * one. Returns the new token + its grant, or null if the presented token is
 * invalid/expired/revoked.
 */
export async function rotateRefreshToken(token: string): Promise<{
  userId: string;
  clientId: string;
  scope: string;
  refreshToken: string;
} | null> {
  const row = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;

  await prisma.oAuthRefreshToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  const refreshToken = await issueRefreshToken({
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
  });
  return { userId: row.userId, clientId: row.clientId, scope: row.scope, refreshToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.oAuthRefreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ── Identity lookup for token minting ──

export async function getUserIdentity(userId: string): Promise<{
  userId: string;
  name: string;
  email: string;
  personId: string | null;
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, person: { select: { id: true } } },
  });
  if (!user) return null;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    personId: user.person?.id ?? null,
  };
}
