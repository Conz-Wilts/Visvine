/**
 * MCP access-token minting + verification.
 *
 * Access tokens are HS256 JWTs signed with the same `AUTH_SECRET` as web
 * sessions, but with `typ: "mcp_access"` + an `aud` bound to the MCP resource
 * URL and a `scope` claim. `verifyAccessToken` rejects anything that isn't a
 * genuine MCP token, so an ordinary `auth_session` JWT can never be replayed as
 * an MCP token (and vice-versa).
 */
import { SignJWT, jwtVerify } from "jose";
import { mcpResourceUrl } from "@/lib/mcp/config";
import { serializeScopes } from "@/lib/mcp/scopes";

const ACCESS_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET environment variable is not set");
  return new TextEncoder().encode(s);
}

export interface McpIdentity {
  userId: string;
  name: string;
  email: string;
  personId?: string | null;
}

export async function mintAccessToken(
  identity: McpIdentity,
  scopes: readonly string[],
  clientId: string,
): Promise<{ token: string; expiresIn: number }> {
  const token = await new SignJWT({
    name: identity.name,
    email: identity.email,
    personId: identity.personId ?? null,
    scope: serializeScopes(scopes),
    client_id: clientId,
    typ: "mcp_access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.userId)
    .setAudience(mcpResourceUrl())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret());
  return { token, expiresIn: ACCESS_TTL_SECONDS };
}

export interface VerifiedAccessToken {
  userId: string;
  name: string;
  email: string;
  personId: string | null;
  scopes: string[];
  clientId: string;
  expiresAt?: number;
}

export async function verifyAccessToken(
  token: string,
): Promise<VerifiedAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      audience: mcpResourceUrl(),
    });
    if (payload.typ !== "mcp_access") return null;
    if (!payload.sub) return null;
    const scope = typeof payload.scope === "string" ? payload.scope : "";
    return {
      userId: String(payload.sub),
      name: typeof payload.name === "string" ? payload.name : "",
      email: typeof payload.email === "string" ? payload.email : "",
      personId:
        typeof payload.personId === "string" ? payload.personId : null,
      scopes: scope ? scope.split(/\s+/).filter(Boolean) : [],
      clientId:
        typeof payload.client_id === "string" ? payload.client_id : "",
      expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}
