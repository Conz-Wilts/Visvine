/**
 * Shared plumbing for every MCP tool: the `withCtx` wrapper (auth + scope gate +
 * uniform error handling) and community-membership helpers that enforce the
 * tenant boundary even on API routes that are only session-gated.
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { contextFromAuthInfo, type McpContext } from "@/lib/mcp/auth";
import { ok, err } from "@/lib/mcp/result";
import { callApi, ApiError } from "@/lib/mcp/apiClient";
import type { McpScope } from "@/lib/mcp/scopes";

/** The subset of the SDK's tool-handler `extra` we rely on. */
export interface ToolExtra {
  authInfo?: AuthInfo;
}

/**
 * Auth + scope gate around a tool body. Resolves the caller context from the
 * verified token, checks the required scope, runs `fn`, and maps any thrown
 * `ApiError` (incl. the route's own 401/403) into a clean tool error.
 */
export async function withCtx(
  extra: ToolExtra,
  scope: McpScope,
  fn: (ctx: McpContext) => Promise<unknown>,
): Promise<CallToolResult> {
  const ctx = contextFromAuthInfo(extra.authInfo);
  if (!ctx) return err("Unauthorized: no valid MCP access token");
  if (!ctx.scopes.includes(scope)) {
    return err(`Forbidden: this tool requires the '${scope}' scope`);
  }
  try {
    return ok(await fn(ctx));
  } catch (e) {
    if (e instanceof ApiError) return err(e.message);
    return err(e instanceof Error ? e.message : String(e));
  }
}

interface MyCommunity {
  id: string;
  role?: string;
  name?: string;
}

export interface MyCommunities {
  /** id → community row, for the communities the caller has joined. */
  communities: Map<string, MyCommunity>;
  /** Super-admins bypass membership entirely (mirrors the API routes). */
  isSuperAdmin: boolean;
}

/** The caller's communities + super-admin flag, from /api/user/communities. */
export async function getMyCommunities(ctx: McpContext): Promise<MyCommunities> {
  const data = await callApi<{ communities?: MyCommunity[]; isSuperAdmin?: boolean }>(
    ctx,
    "/api/user/communities",
  );
  const communities = new Map<string, MyCommunity>();
  for (const c of data.communities ?? []) communities.set(c.id, c);
  return { communities, isSuperAdmin: data.isSuperAdmin === true };
}

/**
 * Hard tenant boundary: throws 403 unless the caller is a member of
 * `communityId` (super-admins bypass, matching the routes). Use at the top of
 * tools whose backing route is only session-gated (context reads, node/profile
 * lookups, search, feed, analytics) so cross-community data can never leak.
 * Route-gated tools (events/CRM) may also call this for a clearer error, but
 * rely on the route as the source of truth.
 */
export async function assertMember(
  ctx: McpContext,
  communityId: string,
): Promise<void> {
  const { communities, isSuperAdmin } = await getMyCommunities(ctx);
  if (isSuperAdmin || communities.has(communityId)) return;
  throw new ApiError(403, `You are not a member of community '${communityId}'`);
}
