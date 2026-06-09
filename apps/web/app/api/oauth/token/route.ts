/**
 * OAuth 2.1 Token Endpoint. Supports `authorization_code` (with PKCE) and
 * `refresh_token` (rotating) grants. Issues an MCP access-token JWT + an opaque
 * rotating refresh token.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  consumeAuthCode,
  rotateRefreshToken,
  issueRefreshToken,
  verifyPkceS256,
  getUserIdentity,
} from "@/lib/mcp/oauth";
import { mintAccessToken } from "@/lib/mcp/tokens";
import { parseScopes } from "@/lib/mcp/scopes";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function tokenError(error: string, description?: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: CORS },
  );
}

/** Token endpoint accepts form-encoded (standard) or JSON bodies. */
async function readParams(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

async function issueTokens(
  userId: string,
  clientId: string,
  scope: string,
  refreshToken?: string,
) {
  const identity = await getUserIdentity(userId);
  if (!identity) return tokenError("invalid_grant", "User no longer exists");

  const scopes = parseScopes(scope);
  const { token, expiresIn } = await mintAccessToken(identity, scopes, clientId);
  const refresh =
    refreshToken ?? (await issueRefreshToken({ clientId, userId, scope }));

  return NextResponse.json(
    {
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refresh,
      scope,
    },
    {
      headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" },
    },
  );
}

export async function POST(req: NextRequest) {
  const p = await readParams(req);
  const grantType = p.grant_type;

  if (grantType === "authorization_code") {
    const { code, code_verifier, client_id, redirect_uri } = p;
    if (!code || !code_verifier || !client_id) {
      return tokenError("invalid_request", "Missing code, code_verifier, or client_id");
    }
    const row = await consumeAuthCode(code);
    if (!row) return tokenError("invalid_grant", "Code invalid, expired, or already used");
    if (row.clientId !== client_id) {
      return tokenError("invalid_grant", "client_id mismatch");
    }
    if (redirect_uri && row.redirectUri !== redirect_uri) {
      return tokenError("invalid_grant", "redirect_uri mismatch");
    }
    if (!verifyPkceS256(code_verifier, row.codeChallenge)) {
      return tokenError("invalid_grant", "PKCE verification failed");
    }
    return issueTokens(row.userId, row.clientId, row.scope);
  }

  if (grantType === "refresh_token") {
    const { refresh_token, client_id } = p;
    if (!refresh_token) return tokenError("invalid_request", "Missing refresh_token");
    const rotated = await rotateRefreshToken(refresh_token);
    if (!rotated) return tokenError("invalid_grant", "Refresh token invalid or expired");
    if (client_id && rotated.clientId !== client_id) {
      return tokenError("invalid_grant", "client_id mismatch");
    }
    return issueTokens(
      rotated.userId,
      rotated.clientId,
      rotated.scope,
      rotated.refreshToken,
    );
  }

  return tokenError("unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
