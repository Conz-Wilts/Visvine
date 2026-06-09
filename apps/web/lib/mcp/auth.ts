/**
 * Bridges MCP access tokens into (a) mcp-handler's `withMcpAuth` verifier and
 * (b) the per-tool-call `McpContext` derived from `extra.authInfo`.
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { verifyAccessToken } from "@/lib/mcp/tokens";

export interface McpContext {
  userId: string;
  name: string;
  email: string;
  personId: string | null;
  scopes: string[];
}

/**
 * `verifyToken` adapter for mcp-handler's `withMcpAuth`. Returns an `AuthInfo`
 * (with our identity stashed in `extra`) or `undefined` to reject the request.
 */
export async function verifyMcpBearer(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const v = await verifyAccessToken(bearerToken);
  if (!v) return undefined;
  return {
    token: bearerToken,
    clientId: v.clientId,
    scopes: v.scopes,
    expiresAt: v.expiresAt,
    extra: {
      userId: v.userId,
      name: v.name,
      email: v.email,
      personId: v.personId,
    },
  };
}

/** Build the per-call context from the SDK tool handler's `extra.authInfo`. */
export function contextFromAuthInfo(
  authInfo: AuthInfo | undefined,
): McpContext | null {
  const e = authInfo?.extra;
  if (!e || typeof e.userId !== "string") return null;
  return {
    userId: e.userId,
    name: typeof e.name === "string" ? e.name : "",
    email: typeof e.email === "string" ? e.email : "",
    personId: typeof e.personId === "string" ? e.personId : null,
    scopes: authInfo?.scopes ?? [],
  };
}
